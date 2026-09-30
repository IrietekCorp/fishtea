/**
 * `fishtea plugin` — the lifecycle of a plugin, from an idea to something shipped with the framework.
 *
 *   create    a new plugin in this application's plugins/ directory, from a skeleton for its kind
 *   list      what this application uses, and what it could
 *   info      one plugin's manifest, config and contributions
 *   add       start using one: a line in spec.plugins, nothing inlined
 *   remove    stop using one: that line goes, and so does everything it contributed
 *   promote   move a local plugin into the framework checkout, so every application can use it
 *
 * `promote` is the whole social loop in one verb. A plugin is a directory with a manifest; it is "local"
 * or "core" only by where it sits, and resolution looks local-first — so promoting is a move, the
 * application keeps working, and nothing about the plugin has to change.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { isInside } from "./env.ts";
import pc from "picocolors";
import {
  FISHTEA_VERSION, PLUGIN_KINDS, bumpVersion, defaultsOf, discoverPlugins, missingEnv, readManifestAt,
  resolvePlugins, SHELL_EXPORT, VIEW_EXPORT, type PluginKind, type PluginManifest, type ResolvedPlugin,
} from "@fishtea/spec";

const specPath = (appDir: string) => join(appDir, "spec.json");
const readSpec = (appDir: string) => JSON.parse(readFileSync(specPath(appDir), "utf8"));
const writeSpec = (appDir: string, spec: any) => writeFileSync(specPath(appDir), JSON.stringify(spec, null, 2) + "\n");

/** Plugins the application asks for, resolved. */
export function installed(appDir: string, home: string): ResolvedPlugin[] {
  return resolvePlugins(readSpec(appDir), appDir, home);
}

export function list(appDir: string, home: string): string {
  const L: string[] = [];
  let inUse: ResolvedPlugin[] = [];
  try { inUse = installed(appDir, home); } catch (e) { L.push(pc.red((e as Error).message)); }

  L.push(pc.bold("in use"));
  if (!inUse.length) L.push(pc.dim("  none — fishtea plugin add <name>"));
  for (const p of inUse) {
    const off = p.use.enabled === false ? pc.dim(" (disabled)") : "";
    const as = p.as === p.manifest.name ? "" : pc.dim(` as ${p.as}`);
    L.push(`  ${pc.bold(p.manifest.name.padEnd(16))} ${p.manifest.version.padEnd(8)} ${pc.dim(p.manifest.kind.padEnd(11))} ${pc.dim(p.from)}${as}${off}`);
    L.push(`  ${" ".repeat(16)} ${pc.dim(p.manifest.doc ?? "")}`);
  }

  const usedDirs = new Set(inUse.map((p) => p.dir));
  const available = discoverPlugins(appDir, home).filter((p) => !usedDirs.has(p.dir));
  if (available.length) {
    L.push("\n" + pc.bold("available"));
    for (const p of available) {
      L.push(`  ${pc.bold(p.manifest.name.padEnd(16))} ${p.manifest.version.padEnd(8)} ${pc.dim(p.manifest.kind.padEnd(11))} ${pc.dim(p.from)}`);
      L.push(`  ${" ".repeat(16)} ${pc.dim(p.manifest.doc ?? "")}`);
    }
  }

  const missing = missingEnv(inUse);
  if (missing.length) {
    L.push("\n" + pc.yellow("needs configuration"));
    for (const m of missing) L.push(pc.yellow(`  ${m.plugin}: ${m.vars.join(", ")} not set`));
  }
  return L.join("\n");
}

export function info(name: string, appDir: string, home: string): string {
  const all = [...installed(appDir, home), ...discoverPlugins(appDir, home)];
  const p = all.find((x) => x.as === name || x.manifest.name === name);
  if (!p) throw new Error(`no plugin "${name}" — fishtea plugin list`);
  const m = p.manifest;
  const L = [
    `${pc.bold(m.name)} ${m.version}  ${pc.dim(m.kind)}`,
    m.doc ? pc.dim(`  ${m.doc}`) : "",
    `  ${pc.dim("directory")}  ${p.dir} ${pc.dim(`(${p.from})`)}`,
    m.fishtea ? `  ${pc.dim("requires")}   fishtea ${m.fishtea} ${pc.dim(`(this is ${FISHTEA_VERSION})`)}` : "",
  ].filter(Boolean);
  if (m.env?.length) L.push(`  ${pc.dim("environment")} ${m.env.join(", ")}`);
  if (m.tokens) L.push(`  ${pc.dim("tokens")}     ${m.tokens}`);
  if (m.vessels) L.push(`  ${pc.dim("vessels")}    ${Object.keys(m.vessels).join(", ")}`);
  if (m.config?.length) {
    L.push(`  ${pc.bold("config")}`);
    for (const q of m.config) L.push(`    ${q.id.padEnd(14)} ${pc.dim(q.ask)}${q.default !== undefined ? pc.dim(` [${q.default}]`) : ""}`);
  }
  for (const [section, frag] of Object.entries(m.provides ?? {})) {
    const keys = Object.keys(frag).filter((k) => k !== "version" && k !== "doc");
    if (keys.length) L.push(`  ${pc.bold(section)}\n    ${keys.join("\n    ")}`);
  }
  return L.join("\n");
}

export interface AddOptions { as?: string; config?: Record<string, unknown>; home: string }

export function add(use: string, appDir: string, o: AddOptions): { as: string; manifest: PluginManifest } {
  const spec = readSpec(appDir);
  spec.plugins ??= { version: bumpVersion(undefined) };
  const as = o.as ?? use.replace(/^.*[/\\]/, "");
  if (spec.plugins[as]) throw new Error(`plugins.${as} already exists — remove it first, or --as <another name>`);

  spec.plugins[as] = { use, ...(o.config && Object.keys(o.config).length ? { config: o.config } : {}) };
  spec.plugins.version = bumpVersion(spec.plugins.version);

  // Resolve before writing: an unresolvable plugin should fail here, not on the next `serve`.
  const resolved = resolvePlugins(spec, appDir, o.home).find((p) => p.as === as)!;
  spec.plugins[as].version = `^${resolved.manifest.version}`;
  spec.plugins[as].kind = resolved.manifest.kind;
  writeSpec(appDir, spec);
  return { as, manifest: resolved.manifest };
}

export function remove(as: string, appDir: string): void {
  const spec = readSpec(appDir);
  if (!spec.plugins?.[as]) throw new Error(`plugins.${as} is not in this spec`);
  delete spec.plugins[as];
  spec.plugins.version = bumpVersion(spec.plugins.version);
  // An empty plugins section is noise; drop it rather than leave a husk behind.
  if (Object.keys(spec.plugins).filter((k) => k !== "version" && k !== "doc").length === 0) delete spec.plugins;
  writeSpec(appDir, spec);
}

/** Skeletons per kind: enough to run, and shaped so the next edit is obvious. */
function skeleton(name: string, kind: PluginKind): Record<string, string> {
  const manifest: PluginManifest = {
    name, version: "0.1.0", kind,
    doc: `A ${kind} plugin`,
    fishtea: `^${FISHTEA_VERSION}`,
  };
  const files: Record<string, string> = {};
  if (kind === "ui") {
    manifest.tokens = "tokens.css";
    manifest.config = [{ id: "accentHue", ask: "Accent hue (0-360)", type: "int", default: 260 }];
    // Each config question needs a matching --<plugin>-<kebab-id> declaration, or answering it does
    // nothing; `fishtea ui-assets` reports the mismatch, but starting correct is better.
    files["tokens.css"] = `/* ${name} — a design system. Every value is a token packages/ui/src/index.css defines,\n   so a design system is a stylesheet: no vessel is rewritten and the base accessibility is inherited. */\n:root {\n  --${name}-accent-hue: 260;\n\n  --accent: oklch(0.68 0.17 var(--${name}-accent-hue));\n  --ring: var(--accent);\n  --radius: 0.75rem;\n}\n`;
  } else if (kind === "integration") {
    manifest.config = [{ id: "greeting", ask: "What should it say?", type: "string", default: "hello" }];
    manifest.provides = {
      calls: {
        [`${name}.ping`]: {
          kind: "compute",
          doc: `Prove the ${name} plugin is wired up`,
          in: { echo: "string?", greeting: "string={{config.greeting}}" },
          out: { said: "string" },
          impl: { module: "ping.ts" },
        },
      },
    };
    files["ping.ts"] = `/** A compute call contributed by the ${name} plugin. Input shapes come from the manifest. */\nexport default async function ping(input: { echo?: string | null; greeting: string }) {\n  return { said: [input.greeting, input.echo].filter(Boolean).join(" ") };\n}\n`;
  } else if (kind === "classifier") {
    // A classifier plugin *is* its module, so the skeleton is a working one: this answers every
    // utterance with "ask", which is exactly what the engine pours when nothing is understood. It runs,
    // it is honest, and replacing the body is the whole job.
    manifest.module = "classify.ts";
    manifest.config = [{ id: "floor", ask: "Confidence below which it should not guess", type: "number", default: 0.35 }];
    files["classify.ts"] = [
      'import type { ClassifyRequest, ClassifyResult, Classifier } from "@fishtea/core";',
      "",
      "/**",
      " * Called once, when the engine is built. Return something that satisfies Classifier.",
      " *",
      " * `config` is the answers to this plugin's own questions; `env` is the process environment, which is",
      " * where a key belongs — a config question with an `env` is prompted but never written to spec.json.",
      " */",
      "export function createClassifier({ config, env }: { config: Record<string, unknown>; env: Record<string, string | undefined> }): Classifier {",
      "  return {",
      `    name: ${JSON.stringify(name)},`,
      "",
      "    async classify(req: ClassifyRequest): Promise<ClassifyResult> {",
      "      // req.tools is the persona-filtered tool list: the only shapes this visitor may ask for.",
      '      // Returning no calls pours "ask", which is the right answer until you write a real one.',
      `      return { calls: [], confidence: 0, ms: 0, classifier: ${JSON.stringify(name)} };`,
      "    },",
      "",
      "    // Optional. The engine calls this on load and on hot-reload, with every tool and the",
      "    // per-persona subsets, so a pool can warm one agent per persona.",
      "    async reload(tools, subsets) {},",
      "",
      "    async health() { return { ok: true }; },",
      "  };",
      "}",
      "",
    ].join("\n");
  } else if (kind === "channel") {
    manifest.module = "deliver.ts";
    manifest.config = [{ id: "from", ask: "Who does a notification come from?", type: "string", default: "hello@example.com" }];
    files["deliver.ts"] = [
      'import type { Channel, Outbound } from "@fishtea/core";',
      "",
      "/**",
      " * Called once, when the engine is built. Return something that satisfies Channel.",
      " *",
      " * deliver() runs only when the visitor is **not** connected: a visitor watching the page already got",
      " * the turn over SSE, and sending it again would be the same notification twice. The notification stays",
      " * queued on the trail whatever you return, so failing here loses nothing — they see it on their next",
      " * visit exactly as they would with no channel at all.",
      " */",
      "export function createChannel({ config, env }: { config: Record<string, unknown>; env: Record<string, string | undefined> }): Channel {",
      "  return {",
      `    name: ${JSON.stringify(name)},`,
      "",
      "    async deliver(n: Outbound) {",
      '      if (!n.to.email) return { ok: false, detail: "no address for this visitor" };',
      "      // Send n.text to n.to.email, from config.from. n.next are the chips the page would have offered.",
      `      console.log("[${name}] would send to " + n.to.email + ": " + n.text);`,
      "      return { ok: true };",
      "    },",
      "  };",
      "}",
      "",
    ].join("\n");
  } else if (kind === "shell") {
    manifest.module = "Shell.tsx";
    files["Shell.tsx"] = [
      "/**",
      " * The whole front end a visitor sees, in place of the framework's container. The UI bundle imports it",
      " * through `fishtea ui-assets`; it is browser code, and the core never loads it.",
      " *",
      " * `@fishtea/ui/*` is packages/ui/src: its client (utter, resume, sessions…), the Present renderer for",
      " * `pour.present`, and the vessels. `views` is the application's per-shape views from its ui plugins.",
      " * Start from the container and change what you need.",
      " */",
      'import type { ComponentType } from "react";',
      'import { Container } from "@fishtea/ui/container";',
      "",
      "export function Shell({ views }: { views: Partial<Record<string, ComponentType<any>>> }) {",
      "  void views;",
      "  return <Container />;",
      "}",
      "",
    ].join("\n");
  } else {
    manifest.provides = {};
    files["README.md"] = `# ${name}\n\nA \`${kind}\` plugin. Declare what it contributes under \`provides\` in fishtea.plugin.json.\n`;
  }
  files["fishtea.plugin.json"] = JSON.stringify(manifest, null, 2) + "\n";
  return files;
}

export function create(name: string, kind: PluginKind, appDir: string): string {
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(name)) throw new Error("a plugin name is lowercase letters, digits and dashes");
  if (!PLUGIN_KINDS.includes(kind)) throw new Error(`kind must be one of ${PLUGIN_KINDS.join(", ")}`);
  const dir = join(appDir, "plugins", name);
  if (existsSync(dir)) throw new Error(`${dir} already exists`);
  mkdirSync(dir, { recursive: true });
  for (const [f, content] of Object.entries(skeleton(name, kind))) writeFileSync(join(dir, f), content);
  return dir;
}

/**
 * Move a local plugin into the framework, where every application can resolve it. A move, not a copy:
 * leaving both would mean the local one always shadows the promoted one, and the next person to change
 * the core copy would wonder why nothing happened.
 */
export function promote(name: string, appDir: string, home: string, opts: { copy?: boolean } = {}): { from: string; to: string } {
  const from = join(appDir, "plugins", name);
  if (!readManifestAt(from)) throw new Error(`${from} is not a plugin (no fishtea.plugin.json)`);
  const to = join(home, "plugins", name);
  if (existsSync(to)) throw new Error(`${to} already exists — bump the core one, or rename yours`);
  mkdirSync(join(home, "plugins"), { recursive: true });
  cpSync(from, to, { recursive: true });
  if (!opts.copy) rmSync(from, { recursive: true, force: true });
  return { from, to };
}

/**
 * Generate what the browser bundle needs from the application's ui and shell plugins: one stylesheet of
 * each design system's tokens with its configured values substituted, and one registry of the components
 * plugins contribute — vessel overrides, per-shape views, and at most one shell.
 *
 * Generated rather than dynamic because the UI is a Vite build and has to know its modules at build time.
 * Both files are written into the *application* (`.fishtea/ui/`, git-ignored — derived like everything
 * else), never into the framework install, which several applications share. packages/ui reads them
 * through the `#generated` alias, pointed at `FISHTEA_APP_DIR/.fishtea/ui` when that exists.
 *
 * Imports have to resolve on the host and in the ui container, where the paths differ. A file in the
 * application is imported relative to the registry (the application's own layout is the same in both);
 * a builtin plugin's file through the `@fishtea/plugins` alias, which each side points at its own
 * framework. Anything else — a plugin outside both — keeps an absolute path and a warning, because a
 * container will not see it.
 */
export const VESSEL_EXPORT = "Vessel";

export interface UiAssets { plugins: string[]; css: string; path: string; warnings: string[]; vessels: string[]; views: string[]; shell: string | null; registryPath: string }

export function generateUiAssets(appDir: string, home: string): UiAssets {
  const all = installed(appDir, home).filter((p) => p.use.enabled !== false);
  const ui = all.filter((p) => p.manifest.kind === "ui");
  const shells = all.filter((p) => p.manifest.kind === "shell");
  const warnings: string[] = [];
  const out = join(appDir, ".fishtea", "ui");
  mkdirSync(out, { recursive: true });
  const builtin = join(home, "plugins");

  /** How the registry (in `out`) imports a plugin's file, and how the stylesheet points Tailwind at a directory. */
  const importPath = (file: string, plugin: string): string => {
    if (isInside(file, appDir)) { const r = relative(out, file); return r.startsWith(".") ? r : `./${r}`; }
    if (isInside(file, builtin)) return `@fishtea/plugins/${relative(builtin, file)}`;
    warnings.push(`${plugin}: ${file} is outside the application and the framework, so a ui container cannot see it`);
    return file;
  };

  const parts: string[] = [
    "/* Generated by `fishtea ui-assets` from this application's ui and shell plugins. Do not edit; it is derived. */",
  ];
  // Tailwind only makes the classes it sees. The UI package scans its own sources and the builtin
  // plugins; a plugin in the application is scanned from here, relative to this file.
  for (const p of [...ui, ...shells]) if (isInside(p.dir, appDir)) parts.push(`@source "${relative(out, p.dir)}";`);
  for (const p of ui) {
    if (!p.manifest.tokens) continue;
    const file = join(p.dir, p.manifest.tokens);
    if (!existsSync(file)) throw new Error(`${p.as}: tokens file ${file} not found`);
    const config = { ...defaultsOf(p.manifest), ...(p.use.config ?? {}) };
    let css = readFileSync(file, "utf8");
    // A design system declares its knobs as CSS custom properties, one per config question: config id
    // `accentHue` is the property `--<plugin>-accent-hue`. Answers replace the declared default, so
    // everything derived from a knob moves with one edit.
    //
    // A knob that matches nothing is reported rather than ignored: it means the manifest and the
    // stylesheet have drifted apart, and the symptom — an answered question that changes nothing — is
    // otherwise invisible and maddening.
    for (const [k, v] of Object.entries(config)) {
      const prop = `--${p.manifest.name}-${k.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;
      const declaration = new RegExp(`(${prop}\\s*:\\s*)[^;]+;`, "g");
      if (!declaration.test(css)) {
        warnings.push(`${p.as}: config "${k}" has no ${prop} declaration in ${p.manifest.tokens}, so answering it changes nothing`);
        continue;
      }
      css = css.replace(declaration, `$1${v};`);
    }
    parts.push(`\n/* ---- ${p.manifest.name} ${p.manifest.version} (${p.as}) ---- */\n${css}`);
  }
  const css = parts.join("\n");
  const path = join(out, "plugins.generated.css");
  writeFileSync(path, css);

  // ---- components ------------------------------------------------------------------------------
  //
  // Vessel overrides replace one of the seven vessels (a shop's own product card); views are an
  // application's page for one *shape* (its home, its contact overlay), drawn by a shell; the shell is
  // the whole front end. Later plugins win a vessel or a view, matching the stylesheet order: the last
  // to speak decides how it looks. Two shells is an error — there is no sensible way to wear both.
  const imports: string[] = [];
  const claim = (kind: "vessel" | "view", map: Map<string, { plugin: string; file: string }>, name: string, p: (typeof ui)[number], rel: string) => {
    const file = join(p.dir, rel);
    if (!existsSync(file)) throw new Error(`${p.as}: ${kind} "${name}" names ${rel}, which is not in the plugin`);
    const prior = map.get(name);
    if (prior) warnings.push(`${name}: "${p.as}" overrides "${prior.plugin}", which also claims it`);
    map.set(name, { plugin: p.as, file });
  };
  const vessels = new Map<string, { plugin: string; file: string }>();
  const views = new Map<string, { plugin: string; file: string }>();
  const shapes = appShapes(appDir);
  for (const p of ui) {
    for (const [vessel, rel] of Object.entries(p.manifest.vessels ?? {})) claim("vessel", vessels, vessel, p, rel);
    for (const [shape, rel] of Object.entries(p.manifest.views ?? {})) {
      if (shapes && !shapes.includes(shape)) throw new Error(`${p.as}: view "${shape}" is not a shape of this application (it has ${shapes.join(", ")})`);
      claim("view", views, shape, p, rel);
    }
  }
  if (shells.length > 1) throw new Error(`two shell plugins (${shells.map((p) => p.as).join(", ")}); an application wears one`);
  const shell = shells[0] ?? null;
  if (shell && !shell.manifest.module) throw new Error(`${shell.as}: a shell plugin needs "module"`);

  const entries = (map: Map<string, { plugin: string; file: string }>, prefix: string, exported: string) =>
    [...map.entries()].map(([name, { plugin, file }], i) => {
      imports.push(`import { ${exported} as ${prefix}${i} } from ${JSON.stringify(importPath(file, plugin))};   // ${plugin}`);
      return `  ${JSON.stringify(name)}: ${prefix}${i},`;
    });
  const vesselEntries = entries(vessels, "V", VESSEL_EXPORT);
  const viewEntries = entries(views, "W", VIEW_EXPORT);
  if (shell) imports.push(`import { ${SHELL_EXPORT} as S } from ${JSON.stringify(importPath(join(shell.dir, shell.manifest.module!), shell.as))};   // ${shell.as}`);
  const registry = [
    "/* Generated by `fishtea ui-assets` from this application's ui and shell plugins. Do not edit; it is derived. */",
    'import type { ComponentType } from "react";',
    ...imports,
    "",
    "/** vessel name → the component that replaces the built-in. Empty is the normal case. */",
    "export const vesselOverrides: Partial<Record<string, ComponentType<any>>> = {",
    ...vesselEntries,
    "};",
    "",
    "/** shape → the application's own view of it, for a shell to draw. */",
    "export const views: Partial<Record<string, ComponentType<any>>> = {",
    ...viewEntries,
    "};",
    "",
    "/** the application's shell, or null for the framework's container. */",
    `export const shell: ComponentType<any> | null = ${shell ? "S" : "null"};`,
    "",
  ].join("\n");
  const registryPath = join(out, "plugins.generated.ts");
  writeFileSync(registryPath, registry);

  return { plugins: [...ui, ...shells].map((p) => p.as), css, path, warnings, vessels: [...vessels.keys()], views: [...views.keys()], shell: shell?.as ?? null, registryPath };
}

/** The application's shape names, to check views against; null when its spec cannot be read. */
function appShapes(appDir: string): string[] | null {
  try { return Object.keys(JSON.parse(readFileSync(join(appDir, "spec.json"), "utf8")).shapes ?? {}).filter((k) => k !== "version"); }
  catch { return null; }
}

/** Every plugin directory the framework ships, for `fishtea plugin list` outside an application. */
export function corePlugins(home: string): PluginManifest[] {
  const root = join(home, "plugins");
  if (!existsSync(root)) return [];
  return readdirSync(root).sort().map((n) => readManifestAt(join(root, n))).filter((m): m is PluginManifest => !!m);
}
