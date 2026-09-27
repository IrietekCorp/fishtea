/** Phase 5 acceptance: envelope → greeting, cart → resume, operator notification over SSE as a turn. */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { resolve } from "node:path";
import { loadApp } from "@fishtea/spec";
import { connect, migrate, seed, reset, Engine, LexicalClassifier, createServer } from "../src/index.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const URL = process.env.FISHTEA_TEST_DATABASE_URL ?? "postgres://fishtea:fishtea@localhost:5434/fishtea";
const db = connect(URL);
const app = loadApp(resolve(ROOT, "templates/ecommerce"));
let engine: Engine;
let server: ReturnType<typeof Bun.serve>;
let base = "";
const OP = "test-operator-token";

beforeAll(async () => {
  await reset(db); await migrate(db, app); await seed(db, app);
  engine = new Engine({ app, db, classifier: new LexicalClassifier() });
  await engine.primeLexical();
  const hono = createServer({ engine, operatorToken: OP, cors: { hosts: ["10.0.0.7"] } });
  server = Bun.serve({ port: 0, fetch: hono.fetch });
  base = `http://localhost:${server.port}`;
});
afterAll(async () => { server.stop(true); await db.end(); });

const cookieOf = (res: Response) => res.headers.get("set-cookie")?.match(/fishtea_visitor=([^;]+)/)?.[1] ?? "";

describe("cors", () => {
  // the browser rejects a wildcard Access-Control-Allow-Origin on a credentialed request, so the origin is
  // reflected instead; reflecting anything would let any site make credentialed calls
  const preflight = (origin: string) => fetch(`${base}/utter`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });

  test("a browser on a host this core answers on is allowed, on any port", async () => {
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173", "http://10.0.0.7:5173"]) {
      const r = await preflight(origin);
      expect(r.headers.get("access-control-allow-origin"), origin).toBe(origin);
      expect(r.headers.get("access-control-allow-credentials")).toBe("true");
    }
  });
  test("the wildcard is never sent, because it cannot carry credentials", async () => {
    const r = await preflight("http://localhost:5173");
    expect(r.headers.get("access-control-allow-origin")).not.toBe("*");
  });
  test("an unrelated origin is refused", async () => {
    const r = await preflight("https://evil.example");
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });
  test("a real GET carries the reflected origin", async () => {
    const r = await fetch(`${base}/`, { headers: { origin: "http://10.0.0.7:5173" } });
    expect(r.headers.get("access-control-allow-origin")).toBe("http://10.0.0.7:5173");
  });
  test("an explicit list overrides the host rule, and \"*\" reflects anything", async () => {
    const listed = Bun.serve({ port: 0, fetch: createServer({ engine, cors: { origins: ["https://shop.example"] } }).fetch });
    const l = `http://localhost:${listed.port}`;
    expect((await fetch(`${l}/`, { headers: { origin: "https://shop.example" } })).headers.get("access-control-allow-origin")).toBe("https://shop.example");
    expect((await fetch(`${l}/`, { headers: { origin: "http://localhost:5173" } })).headers.get("access-control-allow-origin")).toBeNull();
    listed.stop(true);
    const any = Bun.serve({ port: 0, fetch: createServer({ engine, cors: { origins: "*" } }).fetch });
    expect((await fetch(`http://localhost:${any.port}/`, { headers: { origin: "https://anywhere.example" } })).headers.get("access-control-allow-origin")).toBe("https://anywhere.example");
    any.stop(true);
  });
});

describe("http", () => {
  let visitor = "";
  test("GET / with an envelope returns the stranger greeting and sets the visitor cookie", async () => {
    const res = await fetch(`${base}/?utm_campaign=spring&coupon=SPRING10`, { headers: { referer: "https://instagram.com/x" } });
    const j: any = await res.json();
    visitor = cookieOf(res);
    expect(visitor).toMatch(/^v_/);
    expect(j.pour.kind).toBe("ask");
    expect(j.pour.reason).toBe("greeting");
    expect(j.persona).toBe("stranger");
    const trail = await engine.trails.latest(visitor);
    expect(trail!.envelope).toMatchObject({ utm_campaign: "spring", coupon: "SPRING10", referrer: "https://instagram.com/x" });
  });
  test("envelope keys not in accept[] or failing validation are dropped", async () => {
    const res = await fetch(`${base}/?coupon=<script>&utm_source=ok&evil=1`);
    const v = cookieOf(res);
    const trail = await engine.trails.latest(v);
    expect(trail!.envelope).toMatchObject({ utm_source: "ok" });
    expect(trail!.envelope).not.toHaveProperty("coupon");
    expect(trail!.envelope).not.toHaveProperty("evil");
  });
  test("after a cart add, GET / returns the cart answer (homepage = resume)", async () => {
    const h = { "content-type": "application/json", "x-fishtea-visitor": visitor };
    await fetch(`${base}/utter`, { method: "POST", headers: h, body: JSON.stringify({ shape: "becomeKnown", args: { email: "h@example.com" }, confirm: true }) });
    const add = await (await fetch(`${base}/utter`, { method: "POST", headers: h, body: JSON.stringify({ shape: "addToCart", args: { productId: "p_coral_hoops" }, confirm: true }) })).json() as any;
    expect(add.pour.kind).toBe("answer");
    expect(add.persona).toBe("customer");
    const home = await (await fetch(`${base}/`, { headers: { "x-fishtea-visitor": visitor } })).json() as any;
    expect(home.pour.kind).toBe("answer");
    expect(home.pour.shape).toBe("addToCart");
    expect(home.pour.answer.lines[0].productId).toBe("p_coral_hoops");
    expect(home.persona).toBe("mid-purchase");
    expect(home.pour.next.map((c: any) => c.shape)).toContain("checkout");
  });
  test("operator notification arrives on the visitor's SSE stream as a turn", async () => {
    const ctl = new AbortController();
    const res = await fetch(`${base}/events`, { headers: { "x-fishtea-visitor": visitor }, signal: ctl.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const readUntil = async (needle: string, ms = 4000) => {
      const t0 = Date.now();
      while (!buf.includes(needle) && Date.now() - t0 < ms) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value); }
      return buf.includes(needle);
    };
    expect(await readUntil("event: ping")).toBe(true);
    const r = await fetch(`${base}/op/notify`, { method: "POST", headers: { "content-type": "application/json", "x-fishtea-operator": OP }, body: JSON.stringify({ visitorId: visitor, text: "Your order shipped early!" }) });
    expect((await r.json() as any).delivered).toBe(true);
    expect(await readUntil("event: notification")).toBe(true);
    expect(buf).toContain("Your order shipped early!");
    ctl.abort();
    const trail = await engine.trail(visitor);
    const last = trail!.turns.at(-1)!;
    expect(last.kind).toBe("notification");
    expect(last.author).toBe("operator");
  });
  test("operator surface is gated by token; op.unmetReport works", async () => {
    expect((await fetch(`${base}/op/unmet`)).status).toBe(403);
    const r = await fetch(`${base}/op/utter`, { method: "POST", headers: { "content-type": "application/json", "x-fishtea-operator": OP }, body: JSON.stringify({ shape: "op.unmetReport", args: { since: "1d" } }) });
    const j: any = await r.json();
    expect(j.kind).toBe("answer");
    expect(j.vessel).toBe("list");
  });
  test("rate limit returns 429 past the per-visitor budget", async () => {
    const h = { "content-type": "application/json", "x-fishtea-visitor": "v_ratelimit" };
    let last = 200;
    for (let i = 0; i < 130 && last !== 429; i++) last = (await fetch(`${base}/utter`, { method: "POST", headers: h, body: JSON.stringify({ arrive: true }) })).status;
    expect(last).toBe(429);
  });
  test("bad utterance → 400; rewind endpoint moves head", async () => {
    const h = { "content-type": "application/json", "x-fishtea-visitor": visitor };
    expect((await fetch(`${base}/utter`, { method: "POST", headers: h, body: "{}" })).status).toBe(400);
    const t = (await (await fetch(`${base}/trail`, { headers: h })).json()) as any;
    const first = t.turns[0];
    const r = (await (await fetch(`${base}/trail/rewind`, { method: "POST", headers: h, body: JSON.stringify({ turnId: first.id }) })).json()) as any;
    expect(r.head).toBe(first.id);
  });
});

describe("the action log", () => {
  test("every turn appears, with the refusals marked", async () => {
    const h = { "content-type": "application/json", "x-fishtea-visitor": "" };
    // A turn that answers, and one the gate refuses — the second is the interesting row.
    const first = await (await fetch(`${base}/utter`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "something for a wedding" }) })).json() as any;
    const v = first.visitor.id;
    await fetch(`${base}/utter`, { method: "POST", headers: { ...h, "x-fishtea-visitor": v }, body: JSON.stringify({ shape: "checkout", args: {} }) });

    const res = await fetch(`${base}/op/actions?since=1h&visitor=${v}`, { headers: { "x-fishtea-operator": OP } });
    expect(res.status).toBe(200);
    const { actions } = await res.json() as any;

    expect(actions.length).toBeGreaterThanOrEqual(2);
    for (const a of actions) {
      expect(a.visitorId).toBe(v);
      expect(a).toHaveProperty("kind");
      expect(a).toHaveProperty("latencyMs");
    }
    // The refusal carries why, which is the whole reason to keep a log rather than a success counter.
    expect(actions.some((a: any) => a.answered === false && a.unmet)).toBe(true);
  });

  test("it is behind the operator token like everything else under /op", async () => {
    expect((await fetch(`${base}/op/actions`)).status).toBe(403);   // 403 throughout /op, not 401
  });
});

describe("EventSource cannot set headers", () => {
  test("/events identifies the visitor from the query string", async () => {
    // The browser's only option. Without this the stream answered 400 to every connection that had no
    // cookie — which is every cross-origin one — so notifications, streamed parts and reload all died
    // silently, visible only as repeating 400s in the console.
    const first = await (await fetch(`${base}/utter`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hello" }) })).json() as any;
    const v = first.visitor.id;

    const ctl = new AbortController();
    const res = await fetch(`${base}/events?visitor=${v}`, { signal: ctl.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    ctl.abort();
  });

  test("a stream with no visitor at all is still refused", async () => {
    const res = await fetch(`${base}/events`);
    expect(res.status).toBe(400);
  });
});
