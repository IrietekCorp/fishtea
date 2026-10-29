/**
 * The corpus a spec can derive about itself, and knowing when it has gone out of date.
 *
 * The point of all this is the one lever that moves the accuracy/latency curve rather than sliding
 * along it: everything else measured in packages/classifier/contract.md trades one for the other, and a
 * rung fine-tuned on one application's own tools is the only thing that buys both. What makes it
 * FishTea's job rather than the operator's is that the spec already declares the material.
 */
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadApp } from "@fishtea/spec";
import { TUNE_SYSTEM, corpusDigest, deriveCorpus, personaSubsets, readManifest, seedValues, staleness, writeCorpus } from "../src/tune.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const shop = loadApp(join(ROOT, "templates/ecommerce"));

/**
 * A throwaway copy of an archetype, so a test may edit its spec.
 *
 * `.fishtea/` is skipped deliberately: it is derived, git-ignored, and present on the disk of anyone who
 * has run `fishtea tune data` against a template. Copying it would make these tests pass or fail
 * depending on what the developer did last, which is the opposite of a fixture.
 */
function copy(template = "ecommerce") {
  const dir = mkdtempSync(join(tmpdir(), "fishtea-tune-"));
  cpSync(join(ROOT, "templates", template), dir, { recursive: true, filter: (src) => !src.includes("/.fishtea") });
  return dir;
}

describe("the subsets a model has to be good at", () => {
  test("one per persona, deduplicated, because the pool binds a subset and not a persona", () => {
    const subsets = personaSubsets(shop.spec);
    expect([...subsets.keys()]).toContain("stranger");
    // customer and mid-purchase allow the same shapes in this archetype, so they are one subset.
    const keys = [...subsets.values()].map((v) => [...v].sort().join(","));
    expect(new Set(keys).size).toBe(keys.length);
    expect(subsets.get("stranger")).not.toContain("checkout");
  });

  test("a stranger's subset is what a stranger may ask, and nothing else", () => {
    const stranger = personaSubsets(shop.spec).get("stranger")!;
    for (const name of stranger) {
      expect((shop.spec.shapes as any)[name].allow).toContain("stranger");
    }
  });
});

describe("the seed supplies the values", () => {
  test("real ids, so the model learns to lift one out of a sentence", () => {
    const { ids } = seedValues(shop);
    expect(ids.product?.length ?? 0).toBeGreaterThan(5);
    expect(ids.product[0]).toMatch(/^p_/);
  });

  test("an application with no seed directory still derives a corpus", () => {
    const dir = copy();
    writeFileSync(join(dir, "seed", "product.json"), "[]");
    const app = loadApp(dir);
    expect(seedValues(app).ids.product ?? []).toEqual([]);
    expect(deriveCorpus(app).examples.length).toBeGreaterThan(0);
  });
});

describe("the corpus", () => {
  const corpus = deriveCorpus(shop, { perShape: 4 });

  test("every example is a prompt needle can train on", () => {
    for (const e of corpus.examples) {
      expect(e.query.length).toBeGreaterThan(0);
      expect(e.tools.length).toBeGreaterThan(0);
      expect(e.system).toBe(TUNE_SYSTEM);
      for (const a of e.answers) expect(e.tools.map((t) => t.name)).toContain(a.name);
    }
  });

  test("an answer is only ever a shape that subset actually offers", () => {
    // Training a subset to call a tool it will never be given teaches a prompt that cannot occur.
    for (const e of corpus.examples) {
      const offered = new Set(e.tools.map((t) => t.name));
      for (const a of e.answers) expect(offered.has(a.name)).toBe(true);
    }
  });

  const requiredOf = (shape: string) =>
    Object.entries(((shop.spec.shapes as any)[shape]?.input ?? {}) as Record<string, unknown>)
      .filter(([, t]) => !/[?]|=/.test(typeof t === "string" ? t : String((t as any)?.type ?? "")))
      .map(([k]) => k);

  test("an argument example fills every required argument, never some of them", () => {
    // A half-filled call is the one thing that is neither behaviour: it teaches the model to drop a
    // value it did extract.
    for (const e of corpus.examples.filter((x) => x.source === "argument")) {
      for (const a of e.answers) {
        for (const k of requiredOf(a.name)) {
          expect({ q: e.query, k, has: k in a.arguments }).toEqual({ q: e.query, k, has: true });
        }
      }
    }
  });

  test("a bare trigger names the shape with no arguments, so the engine can pour a form", () => {
    // "check out" must reach checkout even though it carries no address; missingRequired then pours
    // the form that collects one. Saying nothing would lose the turn.
    const intents = corpus.examples.filter((e) => e.source === "intent");
    expect(intents.length).toBeGreaterThan(0);
    for (const e of intents) {
      expect(e.answers).toHaveLength(1);
      expect(e.answers[0].arguments).toEqual({});
      expect(requiredOf(e.answers[0].name).length).toBeGreaterThan(0);
    }
    expect(intents.some((e) => e.answers[0].name === "checkout")).toBe(true);
  });

  test("a shape that needs nothing is never an intent example", () => {
    for (const e of corpus.examples.filter((x) => x.source === "trigger")) {
      expect({ q: e.query, required: requiredOf(e.answers[0].name) }).toEqual({ q: e.query, required: [] });
    }
  });

  test("it teaches refusal, not only recognition", () => {
    const empty = corpus.examples.filter((e) => !e.answers.length);
    expect(empty.length).toBeGreaterThan(0);
    expect(empty.every((e) => e.source === "off-topic" || e.source === "unmet")).toBe(true);
  });

  test("it is deterministic, so a rebuild of an unchanged spec is a no-op", () => {
    expect(corpusDigest(deriveCorpus(shop, { perShape: 4 }))).toBe(corpusDigest(corpus));
  });

  test("real utterances are labelled against the subsets that allow their shape", () => {
    const withTrail = deriveCorpus(shop, {
      perShape: 1,
      trail: [{ text: "got any hoops under 40", shape: "findProducts", persona: null },
              { text: "i'm done, let's pay", shape: "checkout", persona: null }],
    });
    const trail = withTrail.examples.filter((e) => e.source === "trail");
    expect(trail.map((e) => e.query)).toContain("got any hoops under 40");
    // checkout is customer-only, so it must never appear in a stranger's subset
    for (const e of trail.filter((x) => x.answers[0]?.name === "checkout")) {
      expect(e.tools.map((t) => t.name)).toContain("checkout");
    }
  });

  test("questions nobody could answer become negatives", () => {
    const c = deriveCorpus(shop, { perShape: 1, unmet: ["do you ship to Mars"] });
    const u = c.examples.filter((e) => e.source === "unmet");
    expect(u.length).toBeGreaterThan(0);
    expect(u[0].answers).toEqual([]);
  });

  test("every archetype derives one", () => {
    for (const t of ["ecommerce", "portfolio", "program", "verification"]) {
      const c = deriveCorpus(loadApp(join(ROOT, "templates", t)));
      expect({ t, enough: c.examples.length > 20 }).toEqual({ t, enough: true });
    }
  });
});

describe("knowing when the model is about a spec that no longer exists", () => {
  test("no corpus is not an error", () => {
    expect(staleness(loadApp(copy()))).toEqual({ state: "none", moved: [] });
  });

  test("fresh after deriving, stale once a trigger moves", () => {
    const dir = copy();
    writeCorpus(loadApp(dir), deriveCorpus(loadApp(dir)));
    expect(staleness(loadApp(dir)).state).toBe("fresh");

    const specPath = join(dir, "spec.json");
    const spec = JSON.parse(readFileSync(specPath, "utf8"));
    spec.shapes.trending.triggers.push("hot right now");
    writeFileSync(specPath, JSON.stringify(spec, null, 2));

    const after = staleness(loadApp(dir));
    expect(after).toEqual({ state: "stale", moved: ["shapes"] });
  });

  test("changing who may ask what is also stale, because a subset is what a worker binds", () => {
    const dir = copy();
    writeCorpus(loadApp(dir), deriveCorpus(loadApp(dir)));
    const specPath = join(dir, "spec.json");
    const spec = JSON.parse(readFileSync(specPath, "utf8"));
    spec.personas.customer.when = "identity.email != null && identity.cookie != null";
    writeFileSync(specPath, JSON.stringify(spec, null, 2));
    expect(staleness(loadApp(dir))).toEqual({ state: "stale", moved: ["personas"] });
  });

  test("a change that cannot make a model wrong does not make it stale", () => {
    // The tools come from shapes and the subsets from personas. A call's SQL, a layout, a notification
    // — none of them reach the prompt the model was trained against.
    const dir = copy();
    writeCorpus(loadApp(dir), deriveCorpus(loadApp(dir)));
    const specPath = join(dir, "spec.json");
    const spec = JSON.parse(readFileSync(specPath, "utf8"));
    spec.business.version = "2099.01.01-9";
    spec.rules.classify = { ...(spec.rules.classify ?? {}), budgetMs: 1234 };
    writeFileSync(specPath, JSON.stringify(spec, null, 2));
    expect(staleness(loadApp(dir)).state).toBe("fresh");
  });

  test("writing a corpus keeps what is known about a model already trained", () => {
    const dir = copy();
    const app = loadApp(dir);
    writeCorpus(app, deriveCorpus(app));
    const path = join(dir, ".fishtea", "tune", "manifest.json");
    const m = JSON.parse(readFileSync(path, "utf8"));
    m.model = { path: "tuned.cact", layers: 8, at: "2026-10-29T00:00:00Z", confidence: "none" };
    writeFileSync(path, JSON.stringify(m, null, 2));
    writeCorpus(app, deriveCorpus(app, { perShape: 2 }));
    expect(readManifest(app)?.model?.layers).toBe(8);
  });

  test("the corpus file is exactly what needle finetune reads", () => {
    const dir = copy();
    const app = loadApp(dir);
    const { corpus } = writeCorpus(app, deriveCorpus(app, { perShape: 2 }));
    expect(existsSync(corpus)).toBe(true);
    for (const line of readFileSync(corpus, "utf8").trim().split("\n")) {
      const row = JSON.parse(line);
      expect(Object.keys(row).sort()).toEqual(["answers", "query", "system", "tools"]);
      expect(row).not.toHaveProperty("source");       // ours, not needle's
    }
  });
});
