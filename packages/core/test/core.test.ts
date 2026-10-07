import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { loadApp } from "@fishtea/spec";
import { connect, migrate, seed, reset, ensureConversationSchema, Engine, runScript, LexicalClassifier, type Response } from "../src/index.ts";

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

/**
 * Access control: the gate is after classification, never on the classifier.
 *
 * The classifier is a router. It is fed attacker-controlled text, it can be a third-party plugin since
 * §6 of the work list, and — most simply — the chip path does not go through it at all: the client
 * posts `{shape, args}` directly. So filtering needle's tool list by persona is a quality measure, not
 * a security one, and every one of these asserts the same invariant from a different direction.
 */
describe("the gate", () => {
  test("a chip for a shape this persona may not ask is refused, though it never touches the classifier", async () => {
    const e = new Engine({ app, db, classifier: new LexicalClassifier() });
    await e.primeLexical();
    const { visitor } = await e.utter({ text: "hello" });

    // A stranger may not check out. This arrives as a direct shape, exactly as a forged chip would.
    const r = await e.utter({ shape: "checkout", args: { email: "a@b.c", shipTo: {} } }, { visitorId: visitor.id });
    expect(r.persona).toBe("stranger");
    expect(r.pour.kind).not.toBe("confirm-write");
    expect((r.pour as any).shape).not.toBe("checkout");

    // And nothing was written on the way to refusing.
    const orders = await db`SELECT count(*)::int AS n FROM business."order" WHERE visitor_id = ${visitor.id}`;
    expect(orders[0].n).toBe(0);
  });

  test("an operator shape cannot be reached from the visitor surface at all", async () => {
    const e = new Engine({ app, db, classifier: new LexicalClassifier() });
    await e.primeLexical();
    const { visitor } = await e.utter({ text: "hello" });
    const r = await e.utter({ shape: "op.unmetReport", args: {} }, { visitorId: visitor.id });
    expect(r.pour.kind).toBe("ask");
    // The visitor is told "not a thing I can do"; the *operator* log records why (reasonUnmet).
    expect((r.pour as any).reason).toBe("no-match");
    expect(JSON.stringify(r.pour)).not.toContain("unmet");
  });

  test("a shape nobody declared is refused rather than planned", async () => {
    const e = new Engine({ app, db, classifier: new LexicalClassifier() });
    await e.primeLexical();
    const { visitor } = await e.utter({ text: "hello" });
    const r = await e.utter({ shape: "dropEverything", args: {} }, { visitorId: visitor.id });
    expect(r.pour.kind).toBe("ask");
    expect((r.pour as any).reason).toBe("no-match");
  });

  test("a read is scoped to its owner: another visitor's order id yields nothing", async () => {
    const e = new Engine({ app, db, classifier: new LexicalClassifier() });
    await e.primeLexical();
    // An order that exists and belongs to somebody else.
    const [row] = await db`SELECT id, visitor_id FROM business."order" LIMIT 1`;
    if (!row) return;                                   // no orders seeded in this run: nothing to assert

    const { visitor } = await e.utter({ text: "hello" });
    expect(visitor.id).not.toBe(row.visitor_id);
    const r = await e.utter({ shape: "orderStatus", args: { orderId: row.id } }, { visitorId: visitor.id });
    // Either the persona gate refuses it, or the SQL returns no row. Both are correct; leaking is not.
    expect(JSON.stringify(r.pour)).not.toContain(row.id);
  });

  test("a visitor id is unguessable, because presenting one is how you become that visitor", async () => {
    const e = new Engine({ app, db, classifier: new LexicalClassifier() });
    await e.primeLexical();
    const ids = new Set<string>();
    for (let i = 0; i < 12; i++) ids.add((await e.utter({ text: "hello" })).visitor.id);
    expect(ids.size).toBe(12);

    // The entropy itself comes from the platform CSPRNG and is not something a test can measure. What
    // this can catch is the regression that matters: an id short enough to be a guessable bearer token.
    // v_ + ~8 chars of base36 time + 16 chars of base64url from 96 random bits.
    for (const id of ids) expect({ id, long: id.length >= 24 }).toEqual({ id, long: true });
  });
});

describe("the framework's own schema reaches an existing database", () => {
  test("a pour kind added after a database was created still widens its CHECK", async () => {
    // The trap: conversation.sql is CREATE TABLE IF NOT EXISTS, and migrate() runs only when the
    // *business* entities drifted. An application whose spec has not changed in months would never
    // receive a change to the framework's own tables, and would fail on the first turn of the new kind.
    await db.unsafe(`ALTER TABLE conversation.turn DROP CONSTRAINT turn_kind_check`);
    await db.unsafe(`ALTER TABLE conversation.turn ADD CONSTRAINT turn_kind_check
      CHECK (kind IN ('ask','form','confirm-write','answer','notification'))`);

    const before = await db`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'turn_kind_check'`;
    expect(before[0].def).not.toContain("composite");

    await ensureConversationSchema(db);

    const after = await db`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'turn_kind_check'`;
    expect(after[0].def).toContain("composite");

    await ensureConversationSchema(db);                        // and again: it has to be idempotent
    const twice = await db`SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'turn_kind_check'`;
    expect(twice[0].n).toBe(1);
  });
});

/**
 * Composite pours: several vessels, composed for one turn.
 *
 * The encoding is borrowed from json-render — a flat `id → part` map rather than a nested tree, so a
 * part can be patched without its siblings and can be named. What is not borrowed is the idea that a
 * model composes it: `compose` is declared in the spec, each part is planned in its own right, and a
 * part is an ordinary pour so every vessel keeps its contract.
 */
describe("call budgets", () => {
  /**
   * `trending` is replanned onto a compute call that takes 50ms (test/fixtures/sleep.ts), so the budget
   * decides the outcome rather than how fast Postgres happens to be. Only the spec is cloned (an App
   * carries a function, which structuredClone refuses).
   */
  const slow = (edit: (spec: any) => void) => {
    const spec = structuredClone(app.spec) as any;
    spec.calls["test.sleep"] = { kind: "compute", in: {}, out: "json", impl: { module: resolve(import.meta.dir, "fixtures/sleep.ts") } };
    spec.shapes.trending.plan = [{ call: "test.sleep", with: {} }];
    spec.rules.calls = { timeoutMs: 10 };
    edit(spec);
    return { ...app, spec } as typeof app;
  };
  const ask = async (a: typeof app) => {
    const e = new Engine({ app: a, db, classifier: new LexicalClassifier() });
    await e.primeLexical();
    const { visitor } = await e.utter({ text: "hello" });
    return e.utter({ shape: "trending", args: {} }, { visitorId: visitor.id });
  };

  test("a call past the global budget fails the plan", async () => {
    const r = await ask(slow(() => {}));
    expect(r.pour.kind).not.toBe("answer");
    expect(JSON.stringify(r.pour)).toContain("test.sleep exceeded 10 ms");
  });
  test("a call's own timeoutMs replaces the global budget, for that call only", async () => {
    const r = await ask(slow((s) => { s.calls["test.sleep"].timeoutMs = 1000; }));
    expect(r.pour.kind).toBe("answer");
    expect((r.pour as any).shape).toBe("trending");
  });
});

describe("composite pours", () => {
  /**
   * The ecommerce archetype does not compose anything — whether a shop's product search also shows
   * trending is that shop's decision. So these build an app whose spec declares it.
   *
   * `structuredClone` cannot be used on an App: it carries a `resolve` function and would throw. Only
   * the spec is cloned, and the rest of the App is reused by reference.
   */
  const composing = (edit: (spec: any) => void = () => {}) => {
    const spec = structuredClone(app.spec) as any;
    spec.shapes.findProducts.compose = ["trending"];
    edit(spec);
    return { ...app, spec } as typeof app;
  };

  test("a shape with compose pours its lead and its parts, each keeping its own vessel", async () => {
    const e = new Engine({ app: composing(), db, classifier: new LexicalClassifier() });
    await e.primeLexical();
    const { visitor } = await e.utter({ text: "hello" });
    const r = await e.utter({ shape: "findProducts", args: { tag: "wedding" } }, { visitorId: visitor.id });

    expect(r.pour.kind).toBe("composite");
    const p = r.pour as any;
    expect(p.root).toBe("findProducts");
    expect(Object.keys(p.parts).sort()).toEqual(["findProducts", "trending"]);
    expect(p.parts.findProducts.children).toEqual(["trending"]);

    // Each part is a whole pour, not a fragment: it kept its kind, its vessel and its own answer.
    for (const id of ["findProducts", "trending"]) {
      expect(p.parts[id].of.kind).toBe("answer");
      expect(p.parts[id].of.vessel).toBeTruthy();
      expect(p.parts[id].from).toBe(id);
    }
    expect(p.parts.findProducts.of.answer).not.toEqual(p.parts.trending.of.answer);
  });

  test("provenance is per part, so a composite can still be taken apart", async () => {
    const e = new Engine({ app: composing(), db, classifier: new LexicalClassifier() });
    await e.primeLexical();
    const { visitor } = await e.utter({ text: "hello" });
    const p = (await e.utter({ shape: "findProducts", args: { tag: "wedding" } }, { visitorId: visitor.id })).pour as any;

    expect(Array.isArray(p.provenance)).toBe(true);
    expect(p.provenance.map((x: any) => x.shape)).toEqual(["findProducts", "trending"]);
    for (const prov of p.provenance) expect(prov.calls.length).toBeGreaterThan(0);
  });

  test("next is the union of every part's chips, each once", async () => {
    const e = new Engine({ app: composing(), db, classifier: new LexicalClassifier() });
    await e.primeLexical();
    const { visitor } = await e.utter({ text: "hello" });
    const p = (await e.utter({ shape: "findProducts", args: { tag: "wedding" } }, { visitorId: visitor.id })).pour as any;

    const keys = p.next.map((c: any) => `${c.shape}:${JSON.stringify(c.args ?? {})}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(p.next.length).toBeGreaterThan(0);
  });

  test("a composite is persisted and comes back on resume", async () => {
    const e = new Engine({ app: composing(), db, classifier: new LexicalClassifier() });
    await e.primeLexical();
    const { visitor } = await e.utter({ text: "hello" });
    await e.utter({ shape: "findProducts", args: { tag: "wedding" } }, { visitorId: visitor.id });

    // The turn table has a CHECK on kind; "composite" had to be added to it, and a pour that cannot be
    // appended is a turn that never happened.
    const resumed = await e.resume({ visitorId: visitor.id, hadToken: true, envelope: {} });
    expect(resumed.pour.kind).toBe("composite");
    expect((resumed.pour as any).parts.trending).toBeTruthy();
  });

  test("a part the persona may not ask is dropped, not smuggled in", async () => {
    // The loader refuses a part that widens access, so this asserts the *runtime* half of the same rule:
    // personas are derived per request, and composeParts re-checks rather than trusting the load-time
    // check it already passed.
    const narrowed = composing((spec) => { spec.shapes.trending.allow = ["customer"]; });
    const e = new Engine({ app: narrowed, db, classifier: new LexicalClassifier() });
    await e.primeLexical();
    const { visitor } = await e.utter({ text: "hello" });        // a stranger
    const r = await e.utter({ shape: "findProducts", args: { tag: "wedding" } }, { visitorId: visitor.id });

    expect(r.persona).toBe("stranger");
    expect(r.pour.kind).toBe("answer");                          // no parts survived, so no composite
    expect(r.pour).not.toHaveProperty("parts");

    // The *chip* for trending is still offered and still marked gated — that is the gate showing the
    // way in, which is existing behaviour and the opposite of a leak. What must not appear is trending's
    // data, and the only way to have that is to have planned it.
    const chip = (r.pour as any).next.find((c: any) => c.shape === "trending");
    expect(chip?.gated).toBe(true);
    expect(chip).not.toHaveProperty("answer");
  });
});

/**
 * Streaming a composite: the lead answers immediately, the parts follow over SSE.
 *
 * What is streamed is the *plan resolving*, not a model emitting — "the products are here, the
 * recommendations are still running". Only for a visitor who is actually connected; everything else
 * plans the composite whole, because you cannot stream to something that is not listening.
 */
describe("streamed composites", () => {
  const composing = () => {
    const spec = structuredClone(app.spec) as any;
    spec.shapes.findProducts.compose = ["trending"];
    return { ...app, spec } as typeof app;
  };

  /** Subscribe like the SSE endpoint does, and collect what the hub publishes. */
  const listen = (e: Engine, visitorId: string) => {
    const events: { type: string; data: any }[] = [];
    const off = e.hub.subscribe(visitorId, (ev) => events.push({ type: ev.type, data: ev.data as any }));
    return { events, off };
  };

  const settled = async (events: { type: string }[], ms = 4000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && !events.some((x) => x.type === "settled")) await Bun.sleep(25);
    return events.some((x) => x.type === "settled");
  };

  test("a connected visitor gets the lead first, then each part, then settled", async () => {
    const e = new Engine({ app: composing(), db, classifier: new LexicalClassifier() });
    await e.primeLexical();
    const { visitor } = await e.utter({ text: "hello" });
    const { events, off } = listen(e, visitor.id);

    const r = await e.utter({ shape: "findProducts", args: { tag: "wedding" } }, { visitorId: visitor.id });

    // The response already came back, and it does not have the part yet — that is the point.
    expect(r.pour.kind).toBe("composite");
    expect((r.pour as any).pending).toEqual(["trending"]);
    expect(Object.keys((r.pour as any).parts)).toEqual(["findProducts"]);

    expect(await settled(events)).toBe(true);
    off();

    const part = events.find((x) => x.type === "part");
    expect(part?.data.id).toBe("trending");
    expect(part?.data.turnId).toBe(r.turn.id);
    expect(part?.data.part.of.kind).toBe("answer");
    expect(events.at(-1)?.type).toBe("settled");
    expect(events.at(-1)?.data.parts).toEqual(["trending"]);
  });

  test("the settled turn is what was on screen, so a resume shows the whole composite", async () => {
    const e = new Engine({ app: composing(), db, classifier: new LexicalClassifier() });
    await e.primeLexical();
    const { visitor } = await e.utter({ text: "hello" });
    const { events, off } = listen(e, visitor.id);
    await e.utter({ shape: "findProducts", args: { tag: "wedding" } }, { visitorId: visitor.id });
    expect(await settled(events)).toBe(true);
    off();

    // Without settle() the stored turn would be the lead alone, and reloading would lose the part that
    // the visitor had actually been looking at.
    const resumed = await e.resume({ visitorId: visitor.id, hadToken: true, envelope: {} });
    expect(resumed.pour.kind).toBe("composite");
    expect(Object.keys((resumed.pour as any).parts).sort()).toEqual(["findProducts", "trending"]);
    expect((resumed.pour as any).pending ?? []).toEqual([]);
  });

  test("nobody listening means no streaming: the composite comes back whole", async () => {
    const e = new Engine({ app: composing(), db, classifier: new LexicalClassifier() });
    await e.primeLexical();
    const { visitor } = await e.utter({ text: "hello" });        // no subscriber
    const r = await e.utter({ shape: "findProducts", args: { tag: "wedding" } }, { visitorId: visitor.id });

    expect(r.pour.kind).toBe("composite");
    expect(r.pour).not.toHaveProperty("pending");
    expect(Object.keys((r.pour as any).parts).sort()).toEqual(["findProducts", "trending"]);
  });
});
