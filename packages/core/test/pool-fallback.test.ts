/**
 * When the classifier pool cannot answer (a 503, a timeout), a turn the keyword classifier is sure about
 * still lands; a vague one still asks — and what it offers are only shapes a chip can start.
 */
import { expect, test, beforeAll, afterAll } from "bun:test";
import { resolve } from "node:path";
import { loadApp } from "@fishtea/spec";
import { connect, migrate, seed, reset, Engine, type Classifier } from "../src/index.ts";

const db = connect(process.env.FISHTEA_TEST_DATABASE_URL ?? "postgres://fishtea:fishtea@localhost:5434/fishtea");
const app = loadApp(resolve(import.meta.dir, "../../../templates/ecommerce"));
const down: Classifier = {
  name: "needle3",
  classify: async () => ({ calls: [], confidence: 0, ms: 5, classifier: "needle3", error: "pool 503" }),
  health: async () => ({ ok: true }),
};
let engine: Engine;
beforeAll(async () => { await reset(db); await migrate(db, app); await seed(db, app); engine = new Engine({ app, db, classifier: down }); });
afterAll(async () => { await db.end(); });

test("a trigger phrase lands on its shape while the pool is down", async () => {
  const r = await engine.utter({ text: "what's trending right now" }, {});
  expect(r.pour.kind).not.toBe("ask");
  expect((r.pour as any).shape).toBe("trending");
  expect(String((r.pour as any).classifier?.reasoning)).toContain("keyword fallback");
});

test("a vague turn still asks, and offers nothing that needs an id", async () => {
  const r = await engine.utter({ text: "hmm" }, {});
  expect(r.pour.kind).toBe("ask");
  const offered = ((r.pour as any).options ?? []).map((o: any) => o.shape);
  for (const s of ["relatedProducts", "compareProducts", "react", "removeFromCart", "orderStatus"]) expect(offered).not.toContain(s);
});

test("rules.classify.fallback answers what the classifier left unchosen with the visitor's words", async () => {
  const spec = JSON.parse(JSON.stringify(app.spec));
  spec.rules.classify = { ...(spec.rules.classify ?? {}), fallback: { shape: "findProducts", arg: "text" } };
  const silent: Classifier = { name: "needle3", classify: async () => ({ calls: [], confidence: 0.01, ms: 5, classifier: "needle3" }), health: async () => ({ ok: true }) };
  const e = new Engine({ app: { ...app, spec }, db, classifier: silent });
  const r = await e.utter({ text: "linen trousers" }, {});
  expect((r.pour as any).shape).toBe("findProducts");
  expect(String((r.pour as any).classifier?.reasoning)).toContain("fallback");
});
