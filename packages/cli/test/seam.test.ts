/**
 * Seam plugins: the kinds that are a module rather than a spec fragment.
 *
 * Before this, `classifier` and `channel` were kinds you could declare, resolve, add to a spec and list
 * — and nothing read them. A plugin that installs cleanly and then does nothing is worse than one that
 * refuses to install, because the failure surfaces as "why is this not working" weeks later. So the
 * tests here are mostly about the ways it can go wrong, and whether each one says so by name.
 */
import { describe, expect, test, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateManifest, SEAM_KINDS, SEAM_EXPORT, type ResolvedPlugin, type PluginManifest } from "@fishtea/spec";
import { loadSeam, SeamError, seamsOfKind, withBudget, type Classifier, type Channel } from "@fishtea/core";
import { create } from "../src/plugin.ts";

const roots: string[] = [];
const scratch = () => { const d = mkdtempSync(join(tmpdir(), "fishtea-seam-")); roots.push(d); return d; };
afterAll(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });

/** A plugin on disk, as the resolver would hand it over. */
function onDisk(manifest: Partial<PluginManifest>, files: Record<string, string> = {}): ResolvedPlugin {
  const dir = join(scratch(), "plug");
  mkdirSync(dir, { recursive: true });
  const m = { name: "demo", version: "1.0.0", kind: "classifier", module: "seam.ts", ...manifest } as PluginManifest;
  writeFileSync(join(dir, "fishtea.plugin.json"), JSON.stringify(m));
  for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c);
  return { as: m.name, manifest: m, dir, use: { use: m.name }, from: "local" };
}

describe("a seam kind must carry a module", () => {
  test("every seam kind declares the export it needs", () => {
    for (const k of SEAM_KINDS) expect(typeof SEAM_EXPORT[k]).toBe("string");
  });

  test("declaring one without a module is refused, and says which export it wanted", () => {
    for (const kind of SEAM_KINDS) {
      const problems = validateManifest({ name: "x", version: "1.0.0", kind }, "x");
      expect(problems.join()).toContain(SEAM_EXPORT[kind]!);
    }
  });

  // The manifest is data from someone else's directory, so the path it names is treated as such.
  test("a module path that climbs out of the plugin is refused", () => {
    for (const bad of ["../../etc/passwd", "/etc/passwd", "nested/../../escape.ts"]) {
      expect(validateManifest({ name: "x", version: "1.0.0", kind: "classifier", module: bad }, "x").join())
        .toContain("must be a path inside the plugin");
    }
  });

  test("a kind with no seam is unaffected", () => {
    expect(validateManifest({ name: "x", version: "1.0.0", kind: "integration" }, "x")).toEqual([]);
    expect(validateManifest({ name: "x", version: "1.0.0", kind: "ui" }, "x")).toEqual([]);
  });
});

describe("loading says what is wrong, by name", () => {
  test("a module the manifest names but that is not there", async () => {
    const p = onDisk({ module: "missing.ts" });
    expect(loadSeam(p)).rejects.toThrow(/demo.*missing\.ts.*does not exist/s);
  });

  test("a module that exports the wrong thing lists what it does export", async () => {
    const p = onDisk({}, { "seam.ts": "export function nope() {}\nexport const alsoNope = 1;\n" });
    const err = await loadSeam(p).catch((e) => e as SeamError);
    expect(String(err)).toContain("must export createClassifier(), a function");
    for (const name of ["nope", "alsoNope"]) expect(String(err)).toContain(name);
  });

  test("a factory that throws is reported as the plugin's fault, not the framework's", async () => {
    const p = onDisk({}, { "seam.ts": 'export function createClassifier() { throw new Error("no key"); }\n' });
    expect(loadSeam(p)).rejects.toThrow(/demo.*createClassifier\(\) threw: no key/s);
  });

  test("a module that does not parse names the plugin", async () => {
    const p = onDisk({}, { "seam.ts": "export function createClassifier( {\n" });
    expect(loadSeam(p)).rejects.toThrow(/plugin "demo"/);
  });
});

describe("what a seam is handed", () => {
  test("its own answered config, with defaults filled in, and the environment", async () => {
    const p = onDisk(
      { config: [{ id: "floor", ask: "?", type: "number", default: 0.35 }, { id: "model", ask: "?", type: "string", default: "small" }] },
      { "seam.ts": "export function createClassifier(ctx) { return ctx; }\n" },
    );
    p.use.config = { model: "large" };                       // answered; floor is not
    const ctx = await loadSeam<any>(p, { SECRET: "s3cret" } as any);
    expect(ctx.config).toEqual({ floor: 0.35, model: "large" });
    expect(ctx.env.SECRET).toBe("s3cret");
    expect(ctx.as).toBe("demo");
    // The spec is deliberately not in there: a classifier is told its tools on reload, a channel is
    // told the notification. Neither needs the business.
    expect(ctx.spec).toBeUndefined();
  });

  test("only enabled plugins of the asked-for kind are seams", () => {
    const a = onDisk({ name: "a", kind: "classifier" });
    const b = onDisk({ name: "b", kind: "channel", module: "seam.ts" });
    const c = onDisk({ name: "c", kind: "classifier" });
    c.use.enabled = false;
    expect(seamsOfKind([a, b, c], "classifier").map((p) => p.as)).toEqual(["a"]);
    expect(seamsOfKind([a, b, c], "channel").map((p) => p.as)).toEqual(["b"]);
  });
});

describe("the scaffold is a working seam, not a stub to fill in", () => {
  test("a created classifier plugin loads and answers", async () => {
    const app = scratch();
    create("mybrain", "classifier", app);
    const p = onDisk({ name: "mybrain" });
    p.dir = join(app, "plugins", "mybrain");
    p.manifest.module = "classify.ts";

    const c = await loadSeam<Classifier>(p);
    expect(c.name).toBe("mybrain");
    expect(await c.health()).toEqual({ ok: true });
    // No calls is "ask", which is the honest answer from a classifier nobody has written yet.
    const r = await c.classify({ text: "hello", context: [], tools: [], budgetMs: 400 });
    expect(r.calls).toEqual([]);
    expect(r.classifier).toBe("mybrain");
  });

  test("a created channel plugin loads and refuses an unaddressable visitor", async () => {
    const app = scratch();
    create("mymail", "channel", app);
    const p = onDisk({ name: "mymail", kind: "channel" });
    p.dir = join(app, "plugins", "mymail");
    p.manifest.module = "deliver.ts";

    const ch = await loadSeam<Channel>(p);
    expect(ch.name).toBe("mymail");
    const out = { id: "n1", visitorId: "v1", text: "your order shipped", author: "system" as const, next: [], to: { email: null, customerId: null } };
    expect(await ch.deliver(out)).toEqual({ ok: false, detail: "no address for this visitor" });
    expect((await ch.deliver({ ...out, to: { email: "a@b.c", customerId: "c1" } })).ok).toBe(true);
  });
});

describe("a plugin classifier is still held to the budget", () => {
  const stub = (over: Partial<Classifier>): Classifier => ({
    name: "stub",
    classify: async () => ({ calls: [], confidence: 1, ms: 0, classifier: "stub" }),
    health: async () => ({ ok: true }),
    ...over,
  });

  test("one that overruns times out rather than holding the request", async () => {
    const slow = stub({ classify: () => new Promise(() => {}) });      // never resolves
    const t0 = performance.now();
    const r = await withBudget(slow, 50).classify({ text: "x", context: [], tools: [], budgetMs: 100 });
    expect(r.timedOut).toBe(true);
    expect(r.calls).toEqual([]);                                        // timed out means "ask", never a guess
    expect(r.error).toContain("100 ms budget");
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  test("one that throws becomes an unanswered turn, not a 500", async () => {
    const bad = stub({ classify: async () => { throw new Error("connection refused"); } });
    const r = await withBudget(bad).classify({ text: "x", context: [], tools: [], budgetMs: 100 });
    expect(r.error).toBe("connection refused");
    expect(r.calls).toEqual([]);
  });

  test("a well-behaved one is passed through untouched, including its optional methods", async () => {
    let reloaded = false;
    const good = stub({
      classify: async () => ({ calls: [{ name: "findProducts", arguments: { q: "linen" } }], confidence: 0.9, ms: 12, classifier: "stub" }),
      reload: async () => { reloaded = true; },
    });
    const w = withBudget(good);
    const r = await w.classify({ text: "x", context: [], tools: [], budgetMs: 400 });
    expect(r.calls[0].name).toBe("findProducts");
    expect(r.timedOut).toBeUndefined();
    await w.reload!([], []);
    expect(reloaded).toBe(true);
    expect(w.name).toBe("stub");
  });

  test("a classifier with no reload does not grow one", () => {
    expect(withBudget(stub({})).reload).toBeUndefined();
  });
});
