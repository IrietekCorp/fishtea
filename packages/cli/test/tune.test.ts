/**
 * The corpus a spec can derive about itself, and knowing when it has gone out of date.
 *
 * The point of all this is the one lever that moves the accuracy/latency curve rather than sliding
 * along it: everything else measured in packages/classifier/contract.md trades one for the other, and a
 * rung fine-tuned on one application's own tools is the only thing that buys both. What makes it
 * FishTea's job rather than the operator's is that the spec already declares the material.
 */
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadApp } from "@fishtea/spec";
import { TUNE_SYSTEM, corpusDigest, deriveCorpus, installModel, modelStaleness, personaSubsets, readCact, readManifest, readModelRecord, seedValues, staleness, writeCorpus } from "../src/tune.ts";

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

  test("re-deriving a corpus does not disturb an installed model", () => {
    // They are separate records on purpose. The corpus lives in .fishtea/, which is derived and
    // git-ignored; the model lives in models/, which is committed because it has to reach the server.
    const dir = copy();
    const app = loadApp(dir);
    writeCorpus(app, deriveCorpus(app));
    installModel(app, cact({ layers: 8, probeHeads: 2 }));
    writeCorpus(app, deriveCorpus(app, { perShape: 2 }));
    expect(readModelRecord(loadApp(dir))?.layers).toBe(8);
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

/**
 * A minimal but structurally honest `.cact`: the real 49-field header, with the tensor count that a
 * given depth and probe-head count imply. Nothing reads past the header, so the body is a stub.
 *
 * The engram-site counts match the needle3 family, where depth drags the sites down with it (five at
 * twenty layers, two at eight, one at four) — that is why `structural` is not just a multiple of depth.
 */
function cact(o: { layers: number; probeHeads: number; sites?: number; body?: number } = { layers: 20, probeHeads: 9 }): string {
  const sites = o.sites ?? (o.layers >= 20 ? 5 : o.layers >= 8 ? 2 : 1);
  const tensors = 12 + o.layers * 27 + sites * 4 + o.probeHeads;
  const buf = Buffer.alloc(48 * 4 + 4 + (o.body ?? 64));
  buf.writeUInt32LE(0x05e12a84, 0);        // tag
  buf.writeUInt32LE(tensors, 1 * 4);
  buf.writeUInt32LE(8192, 5 * 4);          // vocab
  buf.writeUInt32LE(768, 7 * 4);           // d_model
  buf.writeUInt32LE(o.layers, 10 * 4);
  buf.writeUInt32LE(3, 19 * 4);            // qkv conv taps
  buf.writeUInt32LE(sites, 31 * 4);
  const p = join(mkdtempSync(join(tmpdir(), "fishtea-cact-")), "tuned.cact");
  writeFileSync(p, buf);
  return p;
}

describe("reading a model out of its own archive", () => {
  test("depth, tensors and probe heads come from the header, not from a flag", () => {
    const facts = readCact(readFileSync(cact({ layers: 8, probeHeads: 2 })));
    expect(facts).toEqual({ layers: 8, tensors: 238, engramSites: 2, vocab: 8192, dModel: 768, probeHeads: 2 });
  });

  test("a stock archive has nine probe heads and a LoRA build has two", () => {
    // Measured across six real archives at three depths: the separation is exact, which is what lets
    // `install` say "this has no confidence head" without running the model.
    expect(readCact(readFileSync(cact({ layers: 20, probeHeads: 9 }))).probeHeads).toBe(9);
    expect(readCact(readFileSync(cact({ layers: 20, probeHeads: 2 }))).probeHeads).toBe(2);
  });

  test("something that is not a .cact is refused by name", () => {
    const p = join(mkdtempSync(join(tmpdir(), "fishtea-cact-")), "notes.cact");
    writeFileSync(p, Buffer.alloc(400));                       // right size, wrong tag
    expect(() => readCact(readFileSync(p), p)).toThrow(/not a \.cact archive/);
  });

  test("a truncated file is refused rather than read as zeroes", () => {
    expect(() => readCact(Buffer.alloc(8), "stub")).toThrow(/too small/);
  });
});

describe("installing a model trained somewhere else", () => {
  test("it lands in models/ with a record of what it is", () => {
    const dir = copy();
    const app = loadApp(dir);
    const { record, dest } = installModel(app, cact({ layers: 8, probeHeads: 2 }), { framework: "9.9.9" });
    expect(dest).toBe(join(dir, "models", "tuned.cact"));
    expect(existsSync(dest)).toBe(true);
    expect(record.layers).toBe(8);
    expect(record.framework).toBe("9.9.9");
    expect(record.sha256).toHaveLength(64);
    expect(record.bytes).toBe(statSync(dest).size);
  });

  test("the record says what the model cannot do, derived from the archive", () => {
    // Both of these are real consequences a person has to know about before serving it: the floor
    // cannot gate a model with no confidence head, and familiarity needs embeddings.
    const app = loadApp(copy());
    expect(installModel(app, cact({ layers: 8, probeHeads: 2 })).record).toMatchObject({ confidence: "none", embeddings: false });
    const stock = loadApp(copy());
    expect(installModel(stock, cact({ layers: 20, probeHeads: 9 })).record).toMatchObject({ confidence: "head", embeddings: true });
  });

  test("it records the spec it was trained against, which is the whole point", () => {
    const dir = copy();
    const app = loadApp(dir);
    const { record } = installModel(app, cact({ layers: 8, probeHeads: 2 }));
    expect(record.hashes).toEqual({ shapes: app.hashes.shapes, personas: app.hashes.personas });
    expect(modelStaleness(loadApp(dir))).toEqual({ state: "fresh", moved: [] });
  });

  test("a spec edit that changes the tools makes it stale", () => {
    const dir = copy();
    installModel(loadApp(dir), cact({ layers: 8, probeHeads: 2 }));
    const specPath = join(dir, "spec.json");
    const spec = JSON.parse(readFileSync(specPath, "utf8"));
    spec.shapes.trending.triggers.push("hot right now");
    writeFileSync(specPath, JSON.stringify(spec, null, 2));
    expect(modelStaleness(loadApp(dir))).toEqual({ state: "stale", moved: ["shapes"] });
  });

  test("changing who may ask what makes it stale too", () => {
    const dir = copy();
    installModel(loadApp(dir), cact({ layers: 8, probeHeads: 2 }));
    const specPath = join(dir, "spec.json");
    const spec = JSON.parse(readFileSync(specPath, "utf8"));
    spec.personas.customer.when = "identity.email != null && identity.cookie != null";
    writeFileSync(specPath, JSON.stringify(spec, null, 2));
    expect(modelStaleness(loadApp(dir))).toEqual({ state: "stale", moved: ["personas"] });
  });

  test("a change that cannot reach the prompt does not make it stale", () => {
    const dir = copy();
    installModel(loadApp(dir), cact({ layers: 8, probeHeads: 2 }));
    const specPath = join(dir, "spec.json");
    const spec = JSON.parse(readFileSync(specPath, "utf8"));
    spec.business.version = "2099.01.01-9";
    spec.rules.classify = { ...(spec.rules.classify ?? {}), budgetMs: 1234 };
    writeFileSync(specPath, JSON.stringify(spec, null, 2));
    expect(modelStaleness(loadApp(dir)).state).toBe("fresh");
  });

  test("a record whose file has gone is not quietly fresh", () => {
    // The record is committed and the archive is large; somebody will commit one without the other.
    const dir = copy();
    const app = loadApp(dir);
    const { dest } = installModel(app, cact({ layers: 8, probeHeads: 2 }));
    rmSync(dest);
    expect(modelStaleness(loadApp(dir)).state).toBe("missing");
  });

  test("no model installed is not an error", () => {
    expect(modelStaleness(loadApp(copy()))).toEqual({ state: "none", moved: [] });
  });

  test("--as renames it, and anything but a .cact is refused", () => {
    const app = loadApp(copy());
    expect(installModel(app, cact({ layers: 4, probeHeads: 2 }), { as: "shop-l4.cact" }).record.file).toBe("shop-l4.cact");
    expect(() => installModel(app, cact({ layers: 4, probeHeads: 2 }), { as: "model.bin" })).toThrow(/\.cact archive/);
  });

  test("a missing source names the path rather than throwing ENOENT", () => {
    expect(() => installModel(loadApp(copy()), "/nope/tuned.cact")).toThrow(/no such model/);
  });

  test("installing again replaces both the archive and the record", () => {
    const dir = copy();
    installModel(loadApp(dir), cact({ layers: 4, probeHeads: 2 }), { as: "m.cact" });
    installModel(loadApp(dir), cact({ layers: 20, probeHeads: 9 }), { as: "m.cact" });
    expect(readModelRecord(loadApp(dir))).toMatchObject({ layers: 20, confidence: "head" });
  });
});

describe("where a model's provenance comes from", () => {
  test("the corpus manifest, which is what the model actually learned", () => {
    const dir = copy();
    const app = loadApp(dir);
    writeCorpus(app, deriveCorpus(app));
    const r = installModel(loadApp(dir), cact({ layers: 8, probeHeads: 2 }));
    expect(r.trainedAgainst).toBe("corpus");
    expect(r.drifted).toEqual([]);
    expect(r.record.hashes).toEqual(readManifest(app)!.hashes);
  });

  test("a spec edit between deriving and installing is reported, not absorbed", () => {
    // Otherwise the record would claim the model matches today's spec and the staleness check would
    // never fire for the one edit most likely to have been forgotten.
    const dir = copy();
    writeCorpus(loadApp(dir), deriveCorpus(loadApp(dir)));
    const specPath = join(dir, "spec.json");
    const spec = JSON.parse(readFileSync(specPath, "utf8"));
    spec.shapes.trending.triggers.push("hot right now");
    writeFileSync(specPath, JSON.stringify(spec, null, 2));

    const r = installModel(loadApp(dir), cact({ layers: 8, probeHeads: 2 }));
    expect(r.trainedAgainst).toBe("corpus");
    expect(r.drifted).toEqual(["shapes"]);
    expect(modelStaleness(loadApp(dir)).state).toBe("stale");
  });

  test("with no corpus on this machine it falls back to the spec and says so", () => {
    // The install may run on a server that never derived anything. Claiming a match is the honest
    // second best, as long as it is labelled.
    const r = installModel(loadApp(copy()), cact({ layers: 8, probeHeads: 2 }));
    expect(r.trainedAgainst).toBe("spec");
    expect(r.drifted).toEqual([]);
  });
});
