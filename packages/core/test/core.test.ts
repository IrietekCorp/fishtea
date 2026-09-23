import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { loadApp } from "@fishtea/spec";
import { connect, migrate, seed, reset, Engine, runScript, LexicalClassifier, type Response } from "../src/index.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const URL = process.env.FISHTEA_TEST_DATABASE_URL ?? "postgres://fishtea:fishtea@localhost:5434/fishtea";
const db = connect(URL);
const app = loadApp(resolve(ROOT, "templates/ecommerce"));
let engine: Engine;

beforeAll(async () => {
  await reset(db);
  const report = await migrate(db, app);
  expect(report.created.length).toBe(6);
  const counts = await seed(db, app);
  expect(counts.product).toBe(36);
  expect(counts.vendor).toBe(3);
  engine = new Engine({ app, db, classifier: new LexicalClassifier() });
  await engine.primeLexical();
});
afterAll(async () => { await db.end(); });

describe("phase 2: postgres", () => {
  test("business tables seeded and unmet view exists", async () => {
    const [{ count }] = await db`SELECT count(*)::int AS count FROM business.product`;
    expect(count).toBeGreaterThan(0);
    expect((await db`SELECT 1 FROM information_schema.views WHERE table_schema = 'conversation' AND table_name = 'unmet'`).length).toBe(1);
  });
  test("migration is idempotent and additive", async () => {
    const again = await migrate(db, app);
    expect(again.created).toEqual([]); expect(again.added).toEqual([]); expect(again.refused).toEqual([]);
  });
});

describe("phase 3: headless core", () => {
  const script = JSON.parse(readFileSync(resolve(import.meta.dir, "ecommerce.script.json"), "utf8"));
  let responses: Response[];
  const lines: string[] = [];
  test("runs the script", async () => {
    responses = (await runScript(engine, script, { envelope: { utm_campaign: "spring", coupon: "SPRING10" }, print: (l) => lines.push(l), pretty: true })).responses;
    expect(responses.length).toBeGreaterThanOrEqual(20);
  });
  const find = (pred: (r: Response) => boolean) => responses.find(pred)!;
  test("stranger greeting shaped by the envelope", () => {
    expect(responses[0].pour.kind).toBe("ask"); expect((responses[0].pour as any).reason).toBe("greeting"); expect(responses[0].persona).toBe("stranger");
  });
  test("bare 'check out' as stranger yields form for becomeKnown, not checkout", () => {
    const r = find((r) => r.pour.kind === "form" && (r.pour as any).shape === "becomeKnown");
    expect(r).toBeDefined(); expect(r.persona).toBe("stranger");
  });
  test("off-topic utterance is recorded as unmet", async () => {
    const rows = await db`SELECT asked FROM conversation.unmet`;
    expect(rows.map((r) => r.asked)).toContain("what's the weather in Lagos");
  });
  test("write shapes pour confirm-write; confirmed writes run and change persona", () => {
    expect(find((r) => r.pour.kind === "confirm-write" && (r.pour as any).shape === "becomeKnown")).toBeDefined();
    const done = find((r) => r.pour.kind === "answer" && (r.pour as any).shape === "becomeKnown");
    expect((done.pour as any).answer).toMatchObject({ ok: true, email: "jo@example.com" });
    expect((done.pour as any).provenance.wrote).toContain("business.customer");
    expect(responses[responses.indexOf(done) + 1].persona).toBe("customer");
  });
  test("compareProducts runs two calls, the second depending on the first; relatedProducts runs two in one wave", () => {
    const c = find((r) => r.pour.kind === "answer" && (r.pour as any).shape === "compareProducts");
    expect((c.pour as any).provenance.calls.map((x: any) => x.call)).toEqual(["products.byIds", "compare.facets"]);
    expect((c.pour as any).vessel).toBe("compare");
    expect((c.pour as any).answer.facets.length).toBeGreaterThan(3);
    const rel = find((r) => r.pour.kind === "answer" && (r.pour as any).shape === "relatedProducts");
    expect((rel.pour as any).vessel).toBe("detail");
    expect((rel.pour as any).answer.related.length).toBeGreaterThan(0);
  });
  test("cart add → mid-purchase persona, cart shows lines", () => {
    const cart = find((r) => r.pour.kind === "answer" && (r.pour as any).shape === "viewCart");
    expect((cart.pour as any).answer.lines.length).toBe(2); expect(cart.persona).toBe("mid-purchase"); expect((cart.pour as any).vessel).toBe("card");
  });
  test("checkout runs cart → tax → order in a transaction; stock decrements; cart is cleared", async () => {
    const co = find((r) => r.pour.kind === "answer" && (r.pour as any).shape === "checkout");
    expect((co.pour as any).provenance.calls.map((c: any) => c.call)).toEqual(["cart.get", "tax.quote", "order.place"]);
    expect((co.pour as any).answer.order.tax).toBeGreaterThan(0);
    expect((co.pour as any).next[0].shape).toBe("orderStatus");
    const [{ stock }] = await db`SELECT stock FROM business.product WHERE id = 'p_pearl_drop'`;
    expect(stock).toBe(11);
    expect((responses[responses.indexOf(co) + 1].pour as any).answer).toBeNull();
  });
  test("rewind to an earlier turn then a new utterance creates a branch; resume renders the branch", () => {
    const branched = responses.find((r) => (r.pour as any).phrase?.includes("playful") || (r.understood?.phrase ?? "").includes("playful"))!;
    expect(branched).toBeDefined();
    const parent = responses.find((r) => r.turn.id === branched.turn.parentId)!;
    expect(parent.turn.seq).toBe(14);
    expect(branched.turn.seq).toBeGreaterThan(15);
    const resumed = responses[responses.indexOf(branched) + 1];
    expect(resumed.pour.kind).toBe("answer"); expect((resumed.pour as any).shape).toBe("findProducts");
  });
  test("a second visit resumes from the previous head", () => {
    const i = lines.findIndex((l) => l.startsWith("# new trail"));
    expect(i).toBeGreaterThan(0);
    const after = responses.filter((r) => r.turn.trailId !== responses[0].turn.trailId);
    expect(after[0].pour.kind).toBe("answer");
    expect(after[0].persona).toBe("customer");
  });
  test("prints", () => { console.log(lines.join("\n")); });
});

/**
 * Channels: where a notification goes when nobody is watching the page.
 *
 * Before this, `channel` was a plugin kind with no consumer — a notification for a visitor who had
 * closed the tab simply waited on the trail. It still waits; what is new is that it can also be sent.
 */
describe("notification channels", () => {
  /** A channel that records rather than sends, so the test can assert on what it was handed. */
  const recorder = () => {
    const got: any[] = [];
    return { got, channel: { name: "recorder", async deliver(n: any) { got.push(n); return { ok: true }; } } };
  };

  test("a disconnected visitor's notification reaches the channel, with what it needs to address them", async () => {
    const { got, channel } = recorder();
    const e = new Engine({ app, db, classifier: new LexicalClassifier(), channels: [channel] });
    await e.primeLexical();

    // The engine issues visitor ids; a client cannot claim one, so the id to notify is the one it hands back.
    const { visitor } = await e.utter({ text: "hello" });
    const res = await e.notify(visitor.id, { text: "your order shipped", author: "operator" });

    expect(res.delivered).toBe(false);                    // nobody was connected
    expect(res.sent).toEqual([{ channel: "recorder", ok: true }]);
    expect(got.length).toBe(1);
    expect(got[0].text).toBe("your order shipped");
    expect(got[0].author).toBe("operator");
    expect(got[0].id).toBe(res.id);                       // the queued id, so a channel can be idempotent
    expect(got[0].to).toHaveProperty("email");            // null here: this visitor never became known
  });

  test("a connected visitor is told once, over SSE, and the channel is not used", async () => {
    const { got, channel } = recorder();
    const e = new Engine({ app, db, classifier: new LexicalClassifier(), channels: [channel] });
    await e.primeLexical();

    const { visitor } = await e.utter({ text: "hello" });
    const visitorId = visitor.id;
    const seen: any[] = [];
    const off = e.hub.subscribe(visitorId, (ev) => seen.push(ev));

    const res = await e.notify(visitorId, { text: "your order shipped", author: "operator" });
    off();

    expect(res.delivered).toBe(true);
    expect(res.sent).toEqual([]);                         // not the same notification twice
    expect(got).toEqual([]);
    expect(seen.some((ev) => ev.type === "notification")).toBe(true);
  });

  test("a channel that throws is absorbed: the notification still waits on the trail", async () => {
    const boom = { name: "boom", async deliver() { throw new Error("smtp down"); } };
    const e = new Engine({ app, db, classifier: new LexicalClassifier(), channels: [boom] });
    await e.primeLexical();

    const { visitor } = await e.utter({ text: "hello" });
    const visitorId = visitor.id;
    const res = await e.notify(visitorId, { text: "your order shipped", author: "operator" });

    expect(res.sent).toEqual([{ channel: "boom", ok: false, detail: "smtp down" }]);
    expect(res.id).toBeTruthy();                          // queued regardless, which is the point

    // And it is genuinely still there for them: the next visit pours it.
    const back = await e.utter({ text: "hello again" }, { visitorId });
    expect(JSON.stringify(back)).toContain("your order shipped");
  });

  test("with no channels at all, nothing changes", async () => {
    const e = new Engine({ app, db, classifier: new LexicalClassifier() });
    await e.primeLexical();
    const { visitor } = await e.utter({ text: "hello" });
    const res = await e.notify(visitor.id, { text: "hi", author: "operator" });
    expect(res.delivered).toBe(false);
    expect(res.sent).toEqual([]);
  });
});
