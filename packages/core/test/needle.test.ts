/**
 * Phase 4 acceptance against the real needle3 pool. Skips when no pool answers at CLASSIFIER_URL.
 * Run alone (it resets the database): bun test packages/core/test/needle.test.ts
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { loadApp } from "@fishtea/spec";
import { connect, migrate, seed, reset, Engine, runScript, NeedleClient, type Response } from "../src/index.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const URL = process.env.FISHTEA_TEST_DATABASE_URL ?? "postgres://fishtea:fishtea@localhost:5434/fishtea";
const POOL = process.env.CLASSIFIER_URL ?? "http://localhost:8081";
const pool = new NeedleClient(POOL);
const up = (await pool.health()).ok;
const db = connect(URL);
const app = loadApp(resolve(ROOT, "templates/ecommerce"));
let engine: Engine;
let responses: Response[] = [];
const lines: string[] = [];

describe.skipIf(!up)("needle3 pool", () => {
  beforeAll(async () => {
    await reset(db); await migrate(db, app); await seed(db, app);
    engine = new Engine({ app, db, classifier: pool });
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
    const budget = Number(app.spec.rules.classify?.budgetMs ?? 400);
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
