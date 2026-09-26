/**
 * Phase 4 acceptance against the real needle3 pool.
 *
 * **This test reconfigures the pool it talks to.** `pool.reload()` replaces the tool set and the persona
 * subsets with this archetype's, so pointing it at a pool somebody is using swaps that application's
 * brain underneath it — silently, and until the container is restarted. It used to default to
 * `CLASSIFIER_URL` and then `localhost:8081`, which is the *production* port, so a plain `bun test` while
 * any stack was up did exactly that.
 *
 * So it follows the same convention the database already had: a test-only variable, and a default port
 * that is deliberately not the real one. Nothing runs there unless somebody started it on purpose.
 *
 *   docker run -d --name fishtea-test-classifier -p 8082:8081 <classifier image>
 *   # or: NEEDLE_PORT=8082 python3 packages/classifier/needle_service.py
 *   bun test packages/core/test/needle.test.ts        # run alone: it resets the database
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { loadApp } from "@fishtea/spec";
import { connect, migrate, seed, reset, Engine, runScript, NeedleClient, type Response } from "../src/index.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const URL = process.env.FISHTEA_TEST_DATABASE_URL ?? "postgres://fishtea:fishtea@localhost:5434/fishtea";
const POOL = process.env.FISHTEA_TEST_CLASSIFIER_URL ?? "http://localhost:8082";
const pool = new NeedleClient(POOL);
const up = (await pool.health()).ok;
const db = connect(URL);
const loaded = loadApp(resolve(ROOT, "templates/ecommerce"));

/**
 * The same archetype, with room to answer.
 *
 * The shipped budget is 400 ms, which is the right number for production — past it the pour is `ask`,
 * and that rule is not up for negotiation. It makes a poor *test* fixture though: on a machine sharing
 * CPU with anything else, a persona-subset switch alone costs 0.7–1.2 s, so turns time out, a timed-out
 * classify returns no embedding, nothing is stored, and the recall assertion below fails for a reason
 * that has nothing to do with recall. Measured here: every turn of the script's second trail timed out
 * and not one of them stored an embedding.
 *
 * So the budget is raised for the fixture only. What is being tested is whether classification and
 * recall are *correct*, not whether this machine is fast; latency has its own home in packages/bench.
 */
const app = loaded;
const roomy = { ...loaded, spec: { ...loaded.spec, rules: { ...loaded.spec.rules, classify: { ...(loaded.spec.rules.classify ?? {}), budgetMs: 8000 } } } };
let engine: Engine;
let responses: Response[] = [];
const lines: string[] = [];

describe.skipIf(!up)("needle3 pool", () => {
  beforeAll(async () => {
    await reset(db); await migrate(db, app); await seed(db, app);
    engine = new Engine({ app: roomy, db, classifier: pool });
    await pool.reload(engine.toolSpecs, engine.personaSubsets);
    // wait for the background warm, then pin one worker per persona subset (a cold switch costs 0.7–3.7 s)
    while (((await pool.health()).detail as any)?.warming) await Bun.sleep(1000);
    for (const names of engine.personaSubsets) await pool.classify({ text: "hello", context: [], tools: engine.toolSpecs.filter((t) => names.includes(t.name)), budgetMs: 10000 });
    const script = JSON.parse(readFileSync(resolve(ROOT, "templates/ecommerce/scripts/walkthrough.json"), "utf8"));
    responses = (await runScript(engine, script, { print: (l) => lines.push(l), pretty: true, envelope: { utm_campaign: "needle" } })).responses;
  }, 300000);
  afterAll(async () => { console.log(lines.join("\n")); await db.end(); });

  const answers = (shape: string) => responses.filter((r) => r.pour.kind === "answer" && (r.pour as any).shape === shape && r.classifier === "needle3" && r.understood && (r as any).pour.classifier?.name === "needle3");
  test("text utterances classify to the right shapes with confidence above the floor", () => {
    for (const shape of ["findProducts", "compareProducts", "relatedProducts", "trending"]) expect(answers(shape).length, shape).toBeGreaterThan(0);
    const cmp = answers("compareProducts")[0];
    expect((cmp.pour as any).provenance.calls.map((c: any) => c.call)).toEqual(["products.byIds", "compare.facets"]);
    expect(cmp.understood!.confidence).toBeGreaterThan(Number(app.spec.rules.classify?.floor ?? 0.35));
  });
  test("off-topic yields an empty call list → ask, recorded unmet", async () => {
    const r = responses.find((r) => (r as any).pour?.classifier?.calls?.length === 0 && r.pour.kind === "ask");
    expect(r).toBeDefined();
    const rows = await db`SELECT asked FROM conversation.unmet`;
    expect(rows.length).toBeGreaterThan(0);
  });
  test("every classify stays within budget; timeouts pour ask, never lexical", () => {
    // The budget the script actually ran under. What is asserted is that a classify is *bounded* and
    // that overrunning pours ask rather than falling back to lexical — not what the number is.
    const budget = Number(roomy.spec.rules.classify?.budgetMs ?? 400);
    for (const r of responses) {
      expect(r.classifier).toBe("needle3");
      if ((r.pour as any).classifier?.timedOut) { expect(r.pour.kind).toBe("ask"); expect((r.pour as any).reason).toBe("budget"); }
      expect(r.timings.classifyMs).toBeLessThan(budget * 2 + 100); // one pass, or a recall re-classify; each pass is cut at budget
    }
  });
  test("a second trail gets a recalled turn in classifier context when the utterance resonates", () => {
    const again = responses.find((r) => (r as any).pour?.classifier?.recalled > 0);
    expect(again).toBeDefined();
    expect(again!.turn.trailId).not.toBe(responses[0].turn.trailId);
  });
  test("a dead pool pours ask (pool-down) within budget; a slow pool is cut at budget", async () => {
    const dead = new Engine({ app, db, classifier: new NeedleClient("http://127.0.0.1:1") });
    const t0 = performance.now();
    const r = await dead.utter({ text: "something bold" }, { visitorId: null });
    expect(r.pour.kind).toBe("ask");
    expect((r.pour as any).reason).toBe("pool-down");
    expect(performance.now() - t0).toBeLessThan(1500);
    const slow = Bun.serve({ port: 0, fetch: async () => { await Bun.sleep(3000); return Response.json({ function_calls: [] }); } });
    const slowEngine = new Engine({ app, db, classifier: new NeedleClient(`http://localhost:${slow.port}`) });
    const t1 = performance.now();
    const s = await slowEngine.utter({ text: "something bold" }, { visitorId: null });
    slow.stop(true);
    expect(s.pour.kind).toBe("ask");
    expect((s.pour as any).reason).toBe("budget");
    expect(performance.now() - t1).toBeLessThan(Number(app.spec.rules.classify?.budgetMs ?? 400) + 400);
  });
  test("strict mode: unhealthy pool → 'one moment' notification turn with a retry affordance, never lexical", async () => {
    const strict = new Engine({ app, db, classifier: new NeedleClient("http://127.0.0.1:1"), strict: true });
    const r = await strict.utter({ text: "something bold" }, { visitorId: null });
    expect(r.pour.kind).toBe("notification");
    expect((r.pour as any).next[0].shape).toBe("__retry");
  });
});
