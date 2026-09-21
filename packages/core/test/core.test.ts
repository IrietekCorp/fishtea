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
