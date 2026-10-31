/**
 * Echoes end to end (docs/ECHOES.md): GET /echo (redirect) and POST /echo (beacon) against a real Postgres,
 * with a handler module in a fixture application. A turn whose answer carries the URLs under test is
 * appended to a real visitor's trail: an echo reads nothing but a turn's stored pour, so that is the
 * whole of what it depends on.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadApp } from "@fishtea/spec";
import { connect, migrate, seed, reset, Engine, LexicalClassifier, createServer } from "../src/index.ts";
import { locate } from "../src/echo.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const URL_ = process.env.FISHTEA_TEST_DATABASE_URL ?? "postgres://fishtea:fishtea@localhost:5434/fishtea";
const OP = "echo-operator-token";

const dir = mkdtempSync(join(tmpdir(), "fishtea-echo-"));
cpSync(resolve(ROOT, "templates/ecommerce"), dir, { recursive: true });
const specPath = join(dir, "spec.json");
const spec = JSON.parse(readFileSync(specPath, "utf8"));
spec.fishtea = "1.2";
spec.calls["echo.outbound"] = { kind: "compute", doc: "test handler", in: { to: "string", echoId: "string", record: "json?", persona: "string?", shared: "boolean?" }, out: "json", impl: { module: "echo_outbound.ts" }, timeoutMs: 200 };
spec.echoes = {
  version: spec.business.version,
  outbound: {
    handler: "echo.outbound",
    analytics: "outbound_click",
    cases: [{ hosts: ["*.amazon.com"], via: "beacon", handler: false }],
  },
  members: { allow: ["known", "customer"] },
};
writeFileSync(specPath, JSON.stringify(spec, null, 2));
writeFileSync(join(dir, "calls/echo_outbound.ts"), `
export default async function echoOutbound(i: { to: string; echoId: string; record: any; persona: string; shared: boolean }) {
  const host = new URL(i.to).hostname;
  if (host === "fail.example") throw new Error("the network is down");
  if (host === "bad.example") return { location: "javascript:alert(1)" };
  if (host === "slow.example") { await Bun.sleep(1000); return { location: "https://slow.example/late" }; }
  const u = new URL(i.to); u.searchParams.set("sub", i.echoId);
  return { location: u.toString(), data: { productId: i.record?.id ?? null, persona: i.persona, shared: i.shared } };
}
`);

const db = connect(URL_);
const app = loadApp(dir);
let engine: Engine, server: ReturnType<typeof Bun.serve>, base = "";

beforeAll(async () => {
  await reset(db); await migrate(db, app); await seed(db, app);
  engine = new Engine({ app, db, classifier: new LexicalClassifier() });
  server = Bun.serve({ port: 0, fetch: createServer({ engine, operatorToken: OP }).fetch });
  base = `http://localhost:${server.port}`;
});
afterAll(async () => { server.stop(true); await db.end(); rmSync(dir, { recursive: true, force: true }); });

const cookieOf = (r: Response) => r.headers.get("set-cookie")?.match(/fishtea_visitor=([^;]+)/)?.[1] ?? "";

/** A real visitor with a trail, and a turn on it whose answer published `urls` (one product each). */
async function visitorWithAnswer(urls: string[]) {
  const r = await fetch(`${base}/`);
  const visitor = cookieOf(r);
  const trail = (await engine.trails.latest(visitor))!;
  const products = urls.map((u, i) => ({ id: `p${i}`, name: `Product ${i}`, price: 40 + i, affiliateUrl: u }));
  const turn = await engine.trails.append(trail.id, {
    author: "visitor", shape: "findProducts", kind: "answer", confidence: 1, answered: true, latencyMs: 1,
    utterance: { shape: "findProducts", args: {} }, pour: { kind: "answer", shape: "findProducts", answer: products, next: [] }, provenance: {},
  });
  return { visitor, trailId: trail.id, turnId: turn.id };
}

const echoUrl = (q: Record<string, string>) => `${base}/echo?${new URLSearchParams(q)}`;
const rows = (turnId: string) => engine.trails.echoes([turnId]);

describe("locate", () => {
  test("finds the innermost object that published the URL, exactly", () => {
    const pour = { answer: { products: [{ id: "a", links: { shop: "https://s.example/1" } }, { id: "b", affiliateUrl: "https://s.example/2" }] } };
    expect(locate(pour, "https://s.example/2")).toEqual({ id: "b", affiliateUrl: "https://s.example/2" });
    expect(locate(pour, "https://s.example/1")).toEqual({ shop: "https://s.example/1" });
    expect(locate(pour, "https://s.example/1?x=1")).toBeNull();
  });
});

describe("GET /echo — the redirect transport", () => {
  test("records the echo, runs the handler with the record that published the link, and redirects to its rewrite", async () => {
    const { visitor, turnId, trailId } = await visitorWithAnswer(["https://shop.example/p/1", "https://shop.example/p/2"]);
    const r = await fetch(echoUrl({ echo: "outbound", turn: turnId, to: "https://shop.example/p/2" }), { headers: { cookie: `fishtea_visitor=${visitor}` }, redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const [e] = await rows(turnId);
    expect(r.headers.get("location")).toBe(`https://shop.example/p/2?sub=${e!.id}`);
    expect(e).toMatchObject({
      kind: "outbound", via: "redirect", shared: false, visitorId: visitor, trailId, shape: "findProducts", persona: "stranger",
      destination: "https://shop.example/p/2", location: `https://shop.example/p/2?sub=${e!.id}`, note: null,
      data: { productId: "p1", persona: "stranger", shared: false },
    });
    expect(e!.handlerMs).toBeGreaterThanOrEqual(0);
  });

  test("refuses what the conversation never published — so it is not an open redirect", async () => {
    const { visitor, turnId } = await visitorWithAnswer(["https://shop.example/p/1"]);
    const h = { headers: { cookie: `fishtea_visitor=${visitor}` }, redirect: "manual" as const };
    for (const q of [
      { echo: "outbound", turn: turnId, to: "https://evil.example/phish" },
      { echo: "outbound", turn: turnId, to: "https://shop.example/p/1?tampered=1" },
      { echo: "outbound", turn: turnId, to: "javascript:alert(1)" },
      { echo: "nope", turn: turnId, to: "https://shop.example/p/1" },
      { echo: "outbound", turn: "t_missing", to: "https://shop.example/p/1" },
      { echo: "outbound", turn: "", to: "https://shop.example/p/1" },
    ]) {
      const r = await fetch(echoUrl(q), h);
      expect(r.status, JSON.stringify(q)).toBe(404);
      expect(r.headers.get("location")).toBeNull();
    }
    expect(await rows(turnId)).toEqual([]);
  });

  test("a link passed to someone else still works, and is recorded as shared under the new visitor", async () => {
    const { visitor, turnId } = await visitorWithAnswer(["https://shop.example/p/9"]);
    const r = await fetch(echoUrl({ echo: "outbound", turn: turnId, to: "https://shop.example/p/9" }), { redirect: "manual" });
    expect(r.status).toBe(302);
    const stranger = cookieOf(r);
    expect(stranger).toMatch(/^v_/);
    expect(stranger).not.toBe(visitor);
    const [e] = await rows(turnId);
    expect(e).toMatchObject({ shared: true, visitorId: stranger, data: { shared: true } });
  });

  test("a handler that throws, overruns or answers a non-web location never strands the visitor", async () => {
    const urls = ["https://fail.example/a", "https://bad.example/b", "https://slow.example/c"];
    const { visitor, turnId } = await visitorWithAnswer(urls);
    for (const to of urls) {
      const r = await fetch(echoUrl({ echo: "outbound", turn: turnId, to }), { headers: { cookie: `fishtea_visitor=${visitor}` }, redirect: "manual" });
      expect(r.status, to).toBe(302);
      expect(r.headers.get("location"), to).toBe(to);
    }
    const notes = (await rows(turnId)).map((e) => e.note);
    expect(notes[0]).toContain("the network is down");
    expect(notes[1]).toContain("non-web location");
    expect(notes[2]).toContain("over its 200 ms budget");
  });

  test("a persona the echo does not allow is sent on as published, and nothing is recorded", async () => {
    const { visitor, turnId } = await visitorWithAnswer(["https://shop.example/members"]);
    const r = await fetch(echoUrl({ echo: "members", turn: turnId, to: "https://shop.example/members" }), { headers: { cookie: `fishtea_visitor=${visitor}` }, redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://shop.example/members");
    expect(await rows(turnId)).toEqual([]);
  });

  test("a stale turn id on the page: the destination is found on the same trail's recent turns", async () => {
    const { visitor, trailId, turnId: older } = await visitorWithAnswer(["https://shop.example/older"]);
    const newer = await engine.trails.append(trailId, {
      author: "visitor", shape: "viewCart", kind: "answer", confidence: 1, answered: true, latencyMs: 1,
      utterance: { shape: "viewCart" }, pour: { kind: "answer", shape: "viewCart", answer: [], next: [] }, provenance: {},
    });
    const r = await fetch(echoUrl({ echo: "outbound", turn: newer.id, to: "https://shop.example/older" }), { headers: { cookie: `fishtea_visitor=${visitor}` }, redirect: "manual" });
    expect(r.status).toBe(302);
    expect((await rows(older)).length).toBe(1);
    expect(await rows(newer.id)).toEqual([]);
  });
});

describe("POST /echo — the beacon transport", () => {
  test("a case can keep a destination off the redirect: reported beside the link, no handler, 204", async () => {
    const { visitor, turnId } = await visitorWithAnswer(["https://www.amazon.com/dp/B0TEST?tag=shop-20"]);
    // what navigator.sendBeacon sends: text/plain, no custom headers; the visitor named in the body
    const r = await fetch(`${base}/echo`, { method: "POST", headers: { "content-type": "text/plain;charset=UTF-8" }, body: JSON.stringify({ echo: "outbound", turn: turnId, to: "https://www.amazon.com/dp/B0TEST?tag=shop-20", visitor }) });
    expect(r.status).toBe(204);
    const [e] = await rows(turnId);
    expect(e).toMatchObject({ via: "beacon", visitorId: visitor, shared: false, location: null, handlerMs: null, data: {} });
  });

  test("a fetch that asks for JSON gets the outcome; a refusal is a 404 with the reason", async () => {
    const { visitor, turnId } = await visitorWithAnswer(["https://shop.example/json"]);
    const ok = await fetch(`${base}/echo`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", cookie: `fishtea_visitor=${visitor}` }, body: JSON.stringify({ echo: "outbound", turn: turnId, to: "https://shop.example/json" }) });
    expect(ok.status).toBe(200);
    const j: any = await ok.json();
    expect(j).toMatchObject({ status: "followed", via: "beacon", analytics: "outbound_click", recorded: true });
    expect(j.visitorId).toBeUndefined();
    const no = await fetch(`${base}/echo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ echo: "outbound", turn: turnId, to: "https://elsewhere.example" }) });
    expect(no.status).toBe(404);
    expect(((await no.json()) as any).reason).toContain("did not publish");
    expect((await fetch(`${base}/echo`, { method: "POST", body: "not json" })).status).toBe(400);
  });
});

describe("the operator's view", () => {
  test("/op/echoes lists them, /op/turns/:id carries a turn's own, and pruning a visitor takes theirs too", async () => {
    const { visitor, turnId } = await visitorWithAnswer(["https://shop.example/op"]);
    await fetch(echoUrl({ echo: "outbound", turn: turnId, to: "https://shop.example/op" }), { headers: { cookie: `fishtea_visitor=${visitor}` }, redirect: "manual" });
    const op = { headers: { "x-fishtea-operator": OP } };
    expect((await fetch(`${base}/op/echoes`)).status).toBe(403);   // the operator surface refuses without a token or session
    const list: any = await (await fetch(`${base}/op/echoes?echo=outbound&since=1 hour`, op)).json();
    expect(list.echoes.some((e: any) => e.turnId === turnId)).toBe(true);
    expect((await fetch(`${base}/op/echoes?since=whenever`, op)).status).toBe(400);
    const t: any = await (await fetch(`${base}/op/turns/${turnId}`, op)).json();
    expect(t.echoes).toHaveLength(1);
    expect(await engine.trails.deleteVisitors([visitor])).toBe(1);
    expect(await rows(turnId)).toEqual([]);
  });
});
