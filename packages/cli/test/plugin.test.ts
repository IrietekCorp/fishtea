/**
 * The plugin system.
 *
 * Two invariants carry most of the weight and are asserted from several angles:
 *
 *   the spec stays yours   adding a plugin writes one line naming it. Nothing is inlined, so removing it
 *                          takes everything with it and there is no generated code to reconcile later.
 *   the application wins   if your spec and a plugin both define a name, yours stands. Two plugins
 *                          claiming one name is an error, because silently picking one is a bug you
 *                          would find months later.
 *
 * The lifecycle test (create → add → run → promote) is the social model: a plugin is local or core only
 * by where it sits, so promoting is a move and the application that had it keeps working untouched.
 */
import { describe, expect, test, afterAll } from "bun:test";
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadApp, mergePlugins, interpolate, validateManifest, resolvePlugin, resolvePlugins, discoverPlugins,
  candidates, missingEnv, pluginCompatible, PluginError, PLUGIN_KINDS, type ResolvedPlugin, type PluginManifest,
} from "@fishtea/spec";
import { scaffold } from "../src/new.ts";
import { add, create, generateUiAssets, info, installed, list, promote, remove } from "../src/plugin.ts";

const HOME = join(import.meta.dir, "../../..");
const roots: string[] = [];
const scratch = () => { const d = mkdtempSync(join(tmpdir(), "fishtea-plugin-")); roots.push(d); return d; };
afterAll(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });

/** A scratch framework (its own plugins/ and templates/) plus an application scaffolded from it. */
async function world(template = "ecommerce") {
  const root = scratch();
  const home = join(root, "framework");
  cpSync(join(HOME, "templates"), join(home, "templates"), { recursive: true });
  cpSync(join(HOME, "plugins"), join(home, "plugins"), { recursive: true });
  mkdirSync(join(home, "packages/ui/src"), { recursive: true });
  const app = join(root, "app");
  await scaffold({ id: "scratchapp", template, dir: app, fishteaHome: home, force: true });
  return { root, home, app };
}

const manifest = (over: Partial<PluginManifest> = {}): PluginManifest =>
  ({ name: "demo", version: "1.0.0", kind: "integration", ...over });

const resolved = (m: PluginManifest, over: Partial<ResolvedPlugin> = {}): ResolvedPlugin =>
  ({ as: m.name, manifest: m, dir: "/plugins/" + m.name, use: { use: m.name }, from: "builtin", ...over });

describe("manifests", () => {
  test("a good manifest has no problems", () => {
    expect(validateManifest(manifest(), "x")).toEqual([]);
  });

  test("bad names, versions and kinds are each reported", () => {
    expect(validateManifest(manifest({ name: "Not Valid" }), "x")[0]).toContain("name");
    expect(validateManifest(manifest({ version: "one" }), "x")[0]).toContain("version");
    expect(validateManifest(manifest({ kind: "nonsense" as any }), "x")[0]).toContain("kind");
  });

  test("a plugin may not contribute business or envelope", () => {
    const problems = validateManifest(manifest({ provides: { business: {} } as any }), "x");
    expect(problems[0]).toContain("may not contribute");
  });

  test("compatibility is checked against the framework version", () => {
    expect(pluginCompatible(manifest({ fishtea: "^1.0.0" }), "1.5.0")).toBe(true);
    expect(pluginCompatible(manifest({ fishtea: "^2.0.0" }), "1.5.0")).toBe(false);
    expect(pluginCompatible(manifest(), "1.5.0")).toBe(true); // silence means any
  });
});

describe("interpolation", () => {
  test("config values reach nested strings, and unknown keys are left alone", () => {
    const out = interpolate(
      { a: "{{config.model}}", b: ["{{name}}", "{{config.n}}"], c: { d: "{{nope}}" }, e: 7 },
      { config: { model: "claude-opus-5", n: 3 }, name: "ai" },
    );
    expect(out).toEqual({ a: "claude-opus-5", b: ["ai", "3"], c: { d: "{{nope}}" }, e: 7 });
  });
});

describe("merge", () => {
  const withCall = manifest({ provides: { calls: { "x.ping": { kind: "compute", in: {}, out: "string", impl: { module: "p.ts" } } } } });

  test("a contribution lands in the merged spec and is tagged with its origin", () => {
    const r = mergePlugins({ business: { version: "1" }, calls: { version: "1" } }, [resolved(withCall)]);
    expect(r.spec.calls["x.ping"]).toBeTruthy();
    expect(r.provenance["calls.x.ping"]).toBe("demo");
  });

  test("the input spec is never mutated", () => {
    const raw = { business: { version: "1" }, calls: { version: "1" } };
    mergePlugins(raw, [resolved(withCall)]);
    expect((raw as any).calls["x.ping"]).toBeUndefined();
  });

  test("the application always wins, with a warning", () => {
    const mine = { kind: "compute", in: {}, out: "string", impl: { module: "mine.ts" } };
    const r = mergePlugins({ business: { version: "1" }, calls: { version: "1", "x.ping": mine } }, [resolved(withCall)]);
    expect(r.spec.calls["x.ping"].impl.module).toBe("mine.ts");
    expect(r.warnings[0]).toContain("your spec defines this");
  });

  test("two plugins claiming one name is an error, not a coin flip", () => {
    const other = resolved({ ...withCall, name: "rival" }, { as: "rival" });
    expect(() => mergePlugins({ business: { version: "1" }, calls: { version: "1" } }, [resolved(withCall), other]))
      .toThrow(PluginError);
  });

  test("a disabled plugin contributes nothing", () => {
    const off = resolved(withCall, { use: { use: "demo", enabled: false } });
    const r = mergePlugins({ business: { version: "1" }, calls: { version: "1" } }, [off]);
    expect(r.spec.calls["x.ping"]).toBeUndefined();
  });

  test("a contributed call's impl becomes an absolute path into the plugin", () => {
    const r = mergePlugins({ business: { version: "1" }, calls: { version: "1" } }, [resolved(withCall)]);
    expect(r.spec.calls["x.ping"].impl.module).toBe("/plugins/demo/p.ts");
    expect(r.spec.calls["x.ping"].impl.plugin).toBeUndefined();   // consumed at merge

  });
});

describe("resolution", () => {
  test("local beats node_modules beats builtin", () => {
    const order = candidates("thing", "/app", "/home").map((c) => c.from);
    expect(order).toEqual(["local", "node_modules", "builtin"]);
  });

  test("a missing plugin names every place it looked", async () => {
    const w = await world();
    try {
      resolvePlugin("nope", { use: "nope" }, w.app, w.home);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as PluginError).message).toContain("plugins/nope");
      expect((e as PluginError).message).toContain("node_modules");
    }
  });

  test("a version range that cannot be satisfied is refused", async () => {
    const w = await world();
    expect(() => resolvePlugin("boutique", { use: "boutique", version: "^9.0.0" }, w.app, w.home)).toThrow(/does not satisfy/);
  });

  test("asking for the wrong kind is refused", async () => {
    const w = await world();
    expect(() => resolvePlugin("boutique", { use: "boutique", kind: "auth" }, w.app, w.home)).toThrow(/is "ui"/);
  });

  test("a local plugin shadows a builtin of the same name", async () => {
    const w = await world();
    create("boutique", "ui", w.app);                               // same name as the shipped one
    const p = resolvePlugin("boutique", { use: "boutique" }, w.app, w.home);
    expect(p.from).toBe("local");
    expect(p.manifest.version).toBe("0.1.0");
  });

  test("discovery finds the framework's plugins", async () => {
    const w = await world();
    const names = discoverPlugins(w.app, w.home).map((p) => p.manifest.name);
    expect(names).toContain("boutique");
    expect(names).toContain("anthropic");
  });
});

describe("add and remove leave the spec yours", () => {
  test("add writes one line and inlines nothing", async () => {
    const w = await world();
    const before = JSON.parse(readFileSync(join(w.app, "spec.json"), "utf8"));
    add("anthropic", w.app, { home: w.home, config: { effort: "low" } });
    const after = JSON.parse(readFileSync(join(w.app, "spec.json"), "utf8"));

    expect(after.plugins.anthropic).toMatchObject({ use: "anthropic", kind: "integration", config: { effort: "low" } });
    expect(after.plugins.anthropic.version).toMatch(/^\^/);
    // Not one contributed call was written into the file.
    expect(Object.keys(after.calls)).toEqual(Object.keys(before.calls));
    // ...but the loaded spec has it.
    expect(loadApp(w.app, { fishteaHome: w.home }).spec.calls["ai.ask"]).toBeTruthy();
  });

  test("config reaches the contributed call as a default", async () => {
    const w = await world();
    add("anthropic", w.app, { home: w.home, config: { effort: "low", model: "claude-haiku-4-5" } });
    const app = loadApp(w.app, { fishteaHome: w.home });
    const ask = app.spec.calls["ai.ask"] as any;
    expect(ask.in.effort).toBe("string=low");
    expect(ask.in.model).toBe("string=claude-haiku-4-5");
  });

  test("remove takes the contribution with it", async () => {
    const w = await world();
    add("anthropic", w.app, { home: w.home });
    expect(loadApp(w.app, { fishteaHome: w.home }).spec.calls["ai.ask"]).toBeTruthy();
    remove("anthropic", w.app);
    expect(loadApp(w.app, { fishteaHome: w.home }).spec.calls["ai.ask"]).toBeUndefined();
    expect(JSON.parse(readFileSync(join(w.app, "spec.json"), "utf8")).plugins).toBeUndefined();
  });

  test("adding the same plugin twice is refused", async () => {
    const w = await world();
    add("anthropic", w.app, { home: w.home });
    expect(() => add("anthropic", w.app, { home: w.home })).toThrow(/already exists/);
  });

  test("an unresolvable plugin fails at add time, not at serve time", async () => {
    const w = await world();
    expect(() => add("nonexistent", w.app, { home: w.home })).toThrow(PluginError);
  });

  test("a contributed call is validated as strictly as your own", async () => {
    const w = await world();
    // Break the plugin's module reference; the loader must refuse the whole spec.
    const mf = join(w.home, "plugins/anthropic/fishtea.plugin.json");
    const m = JSON.parse(readFileSync(mf, "utf8"));
    m.provides.calls["ai.ask"].impl.module = "does-not-exist.ts";
    writeFileSync(mf, JSON.stringify(m));
    add("anthropic", w.app, { home: w.home });
    expect(() => loadApp(w.app, { fishteaHome: w.home })).toThrow(/not found/);
  });
});

describe("the plugin lifecycle", () => {
  test("create → add → run → promote, and the application never notices the move", async () => {
    const w = await world();

    const dir = create("loyalty", "integration", w.app);
    expect(existsSync(join(dir, "fishtea.plugin.json"))).toBe(true);

    add("loyalty", w.app, { home: w.home, config: { greeting: "welcome back" } });
    let app = loadApp(w.app, { fishteaHome: w.home });
    expect(app.plugins.find((p) => p.as === "loyalty")!.from).toBe("local");

    // It is a real call: the module loads and runs.
    const mod = await import((app.spec.calls["loyalty.ping"] as any).impl.module as string);
    expect(await mod.default({ echo: "friend", greeting: "welcome back" })).toEqual({ said: "welcome back friend" });

    const moved = promote("loyalty", w.app, w.home);
    expect(existsSync(moved.from)).toBe(false);                    // a move, not a copy
    expect(existsSync(moved.to)).toBe(true);

    app = loadApp(w.app, { fishteaHome: w.home });
    expect(app.plugins.find((p) => p.as === "loyalty")!.from).toBe("builtin");
    expect(app.spec.calls["loyalty.ping"]).toBeTruthy();           // still works, unchanged
  });

  test("--copy leaves the local one in place", async () => {
    const w = await world();
    create("loyalty", "integration", w.app);
    const moved = promote("loyalty", w.app, w.home, { copy: true });
    expect(existsSync(moved.from)).toBe(true);
  });

  test("promoting over an existing core plugin is refused", async () => {
    const w = await world();
    create("boutique", "ui", w.app);
    expect(() => promote("boutique", w.app, w.home)).toThrow(/already exists/);
  });

  test("every kind scaffolds into something that validates", async () => {
    const w = await world();
    for (const kind of PLUGIN_KINDS) {
      const dir = create(`k-${kind}`, kind, w.app);
      const m = JSON.parse(readFileSync(join(dir, "fishtea.plugin.json"), "utf8"));
      expect({ kind, problems: validateManifest(m, dir) }).toEqual({ kind, problems: [] });
    }
  });
});

describe("ui plugins", () => {
  test("tokens are emitted with the answered values substituted", async () => {
    const w = await world();
    add("boutique", w.app, { home: w.home, config: { accentHue: 340, radius: "1.25rem" } });
    const r = generateUiAssets(w.app, w.home);
    expect(r.plugins).toEqual(["boutique"]);
    expect(r.css).toContain("--boutique-accent-hue: 340;");
    expect(r.css).toContain("--boutique-radius: 1.25rem;");
    expect(r.warnings).toEqual([]);
    expect(existsSync(r.path)).toBe(true);
  });

  test("a question for the views is not a stylesheet knob, so it is neither substituted nor reported", async () => {
    const w = await world();
    const mf = join(w.home, "plugins/boutique/fishtea.plugin.json");
    const m = JSON.parse(readFileSync(mf, "utf8"));
    m.config.push({ id: "heroTitle", ask: "The home page's heading", type: "string", default: "Welcome", for: "views" });
    writeFileSync(mf, JSON.stringify(m));
    add("boutique", w.app, { home: w.home });
    const r = generateUiAssets(w.app, w.home);
    expect(r.warnings).toEqual([]);
    expect(r.css).not.toContain("hero-title");
  });

  test("defaults are used for questions left unanswered", async () => {
    const w = await world();
    add("boutique", w.app, { home: w.home });
    expect(generateUiAssets(w.app, w.home).css).toContain("--boutique-accent-hue: 25;");
  });

  test("a knob that matches no declaration is reported, not silently ignored", async () => {
    const w = await world();
    const mf = join(w.home, "plugins/boutique/fishtea.plugin.json");
    const m = JSON.parse(readFileSync(mf, "utf8"));
    m.config.push({ id: "nothingMatchesThis", ask: "?", type: "int", default: 1 });
    writeFileSync(mf, JSON.stringify(m));
    add("boutique", w.app, { home: w.home });
    const r = generateUiAssets(w.app, w.home);
    expect(r.warnings.join()).toContain("--boutique-nothing-matches-this");
  });

  test("no ui plugin still writes a valid, importable stylesheet and an empty registry", async () => {
    const w = await world();
    const r = generateUiAssets(w.app, w.home);
    expect(r.plugins).toEqual([]);
    expect(existsSync(r.path)).toBe(true);
    // The registry is imported unconditionally by container.tsx, so "no plugins" must still be a module.
    expect(r.vessels).toEqual([]);
    const mod = await import(r.registryPath);
    expect(mod.vesselOverrides).toEqual({});
  });
});

/**
 * Vessel overrides: a design system that replaces a component rather than restyling one.
 *
 * Declarable since the first pass, and until now completely inert — `plugin info` would list a vessel
 * the browser bundle had never heard of.
 */
describe("vessel overrides", () => {
  /** A ui plugin in the application's own plugins/, with the given manifest bits and files. */
  function uiPlugin(app: string, name: string, over: Record<string, unknown>, files: Record<string, string> = {}) {
    const dir = join(app, "plugins", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "fishtea.plugin.json"), JSON.stringify({
      name, version: "1.0.0", kind: "ui", tokens: "tokens.css", ...over,
    }));
    writeFileSync(join(dir, "tokens.css"), ":root { --radius: 0.5rem; }\n");
    for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c);
    const spec = JSON.parse(readFileSync(join(app, "spec.json"), "utf8"));
    spec.plugins = { ...(spec.plugins ?? {}), [name]: { use: name } };
    writeFileSync(join(app, "spec.json"), JSON.stringify(spec, null, 2));
    return dir;
  }

  const component = (label: string) => `export function Vessel({ pour }: any) { return { label: ${JSON.stringify(label)}, pour }; }\n`;

  test("a declared vessel lands in the registry, importing the plugin's own component", async () => {
    const w = await world();
    uiPlugin(w.app, "shopfront", { vessels: { list: "List.tsx", card: "Card.tsx" } },
      { "List.tsx": component("list"), "Card.tsx": component("card") });

    const r = generateUiAssets(w.app, w.home);
    expect(r.vessels.sort()).toEqual(["card", "list"]);
    expect(r.warnings).toEqual([]);

    const mod = await import(r.registryPath);
    expect(Object.keys(mod.vesselOverrides).sort()).toEqual(["card", "list"]);
    // And it is the plugin's component, not a name in a table: call it.
    expect(mod.vesselOverrides.list({ pour: { kind: "answer" } }).label).toBe("list");
  });

  test("a vessel nobody claims is simply absent, so the built-in stands", async () => {
    const w = await world();
    uiPlugin(w.app, "shopfront", { vessels: { list: "List.tsx" } }, { "List.tsx": component("list") });
    const mod = await import(generateUiAssets(w.app, w.home).registryPath);
    expect(mod.vesselOverrides.timeline).toBeUndefined();
    expect(mod.vesselOverrides.confirm).toBeUndefined();
  });

  test("a vessel name that is not a vessel is refused at validation", () => {
    const problems = validateManifest({ name: "x", version: "1.0.0", kind: "ui", vessels: { lsit: "L.tsx" } }, "x");
    expect(problems.join()).toContain('"lsit" is not a vessel');
  });

  test("a vessel file outside the plugin is refused, and so is a non-ui plugin claiming one", () => {
    expect(validateManifest({ name: "x", version: "1.0.0", kind: "ui", vessels: { list: "../../evil.tsx" } }, "x").join())
      .toContain("must name a file inside the plugin");
    expect(validateManifest({ name: "x", version: "1.0.0", kind: "integration", vessels: { list: "L.tsx" } }, "x").join())
      .toContain("only a ui plugin may override vessels");
  });

  test("a vessel file the manifest names but that is not there fails loudly at generate time", async () => {
    const w = await world();
    uiPlugin(w.app, "shopfront", { vessels: { list: "Missing.tsx" } });
    expect(() => generateUiAssets(w.app, w.home)).toThrow(/vessel "list" names Missing\.tsx/);
  });

  test("two design systems claiming one vessel: the later wins, and says so", async () => {
    const w = await world();
    uiPlugin(w.app, "base", { vessels: { list: "List.tsx" } }, { "List.tsx": component("base") });
    uiPlugin(w.app, "shopfront", { vessels: { list: "List.tsx" } }, { "List.tsx": component("shopfront") });

    const r = generateUiAssets(w.app, w.home);
    expect(r.warnings.join()).toContain("shopfront");
    const mod = await import(r.registryPath);
    expect(mod.vesselOverrides.list({ pour: {} }).label).toBe("shopfront");
  });
});

/**
 * Views and shells: an application's page for one shape, and its whole front end. Both land in the
 * registry the UI bundle imports, which is written into the application — never the framework install.
 */
describe("views and shells", () => {
  function plugin(app: string, name: string, manifest: Record<string, unknown>, files: Record<string, string>) {
    const dir = join(app, "plugins", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "fishtea.plugin.json"), JSON.stringify({ name, version: "1.0.0", ...manifest }));
    for (const [f, c] of Object.entries(files)) writeFileSync(join(dir, f), c);
    const spec = JSON.parse(readFileSync(join(app, "spec.json"), "utf8"));
    spec.plugins = { ...(spec.plugins ?? {}), [name]: { use: name } };
    writeFileSync(join(app, "spec.json"), JSON.stringify(spec, null, 2));
  }
  const view = (label: string) => `export function View() { return ${JSON.stringify(label)}; }\n`;

  test("views are keyed by shape, a shell is exported, and it is all written into the application", async () => {
    const w = await world();
    plugin(w.app, "brand", { kind: "ui", views: { findProducts: "Find.tsx" } }, { "Find.tsx": view("find") });
    plugin(w.app, "frontdoor", { kind: "shell", module: "Shell.tsx" }, { "Shell.tsx": "export function Shell() { return \"shell\"; }\n" });
    const r = generateUiAssets(w.app, w.home);
    expect(r.registryPath.startsWith(join(w.app, ".fishtea", "ui"))).toBe(true);
    expect(r.path.startsWith(join(w.app, ".fishtea", "ui"))).toBe(true);
    expect(r.views).toEqual(["findProducts"]);
    expect(r.shell).toBe("frontdoor");
    // an application's own plugin is scanned for classes from the generated stylesheet
    expect(r.css).toContain('@source "../../plugins/brand";');
    const mod = await import(r.registryPath);
    expect(mod.views.findProducts()).toBe("find");
    expect(mod.shell()).toBe("shell");
  });

  test("a view for a shape the application does not have is refused", async () => {
    const w = await world();
    plugin(w.app, "brand", { kind: "ui", views: { nosuchShape: "X.tsx" } }, { "X.tsx": view("x") });
    expect(() => generateUiAssets(w.app, w.home)).toThrow(/view "nosuchShape" is not a shape/);
  });

  test("two shells is an error, and none is the framework's container", async () => {
    const w = await world();
    expect((await import(generateUiAssets(w.app, w.home).registryPath)).shell).toBeNull();
    plugin(w.app, "one", { kind: "shell", module: "S.tsx" }, { "S.tsx": "export function Shell() {}\n" });
    plugin(w.app, "two", { kind: "shell", module: "S.tsx" }, { "S.tsx": "export function Shell() {}\n" });
    expect(() => generateUiAssets(w.app, w.home)).toThrow(/two shell plugins/);
  });

  test("a shell without a module, or views on a plugin that is not ui, is refused at validation", () => {
    expect(validateManifest({ name: "x", version: "1.0.0", kind: "shell" }, "x").join()).toContain('needs "module"');
    expect(validateManifest({ name: "x", version: "1.0.0", kind: "shell", module: "S.tsx", views: { a: "A.tsx" } }, "x").join()).toContain("only a ui plugin may carry views");
  });
});

describe("reporting", () => {
  test("missing environment variables are found per plugin", async () => {
    const w = await world();
    add("anthropic", w.app, { home: w.home });
    const missing = missingEnv(installed(w.app, w.home), {});
    expect(missing).toEqual([{ plugin: "anthropic", vars: ["ANTHROPIC_API_KEY"] }]);
    // ...and satisfied when it is set.
    expect(missingEnv(installed(w.app, w.home), { ANTHROPIC_API_KEY: "sk-test" })).toEqual([]);
  });

  test("list and info describe what is there without throwing", async () => {
    const w = await world();
    add("boutique", w.app, { home: w.home });
    expect(list(w.app, w.home)).toContain("boutique");
    expect(info("boutique", w.app, w.home)).toContain("design system");
    expect(() => info("nope", w.app, w.home)).toThrow();
  });

  test("list survives an application whose plugin cannot be resolved", async () => {
    const w = await world();
    const spec = JSON.parse(readFileSync(join(w.app, "spec.json"), "utf8"));
    spec.plugins = { version: "1", ghost: { use: "ghost" } };
    writeFileSync(join(w.app, "spec.json"), JSON.stringify(spec));
    expect(list(w.app, w.home)).toContain("ghost");                // reports, does not crash
  });
});
