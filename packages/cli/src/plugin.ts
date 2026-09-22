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
import { join } from "node:path";
import pc from "picocolors";
import {
  FISHTEA_VERSION, PLUGIN_KINDS, bumpVersion, defaultsOf, discoverPlugins, missingEnv, readManifestAt,
  resolvePlugins, type PluginKind, type PluginManifest, type ResolvedPlugin,
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
 * Generate what the browser bundle needs from the application's ui plugins: one stylesheet importing each
 * design system's tokens in order, with its configured values substituted.
 *
 * Generated rather than dynamic because the UI is a Vite build — a stylesheet has to exist at build time.
 * The file is written into packages/ui/src and is git-ignored; it is derived, like everything else here.
 */
export function generateUiAssets(appDir: string, home: string): { plugins: string[]; css: string; path: string; warnings: string[] } {
  const ui = installed(appDir, home).filter((p) => p.manifest.kind === "ui" && p.use.enabled !== false);
  const warnings: string[] = [];
  const parts: string[] = [
    "/* Generated by `fishtea ui-assets` from this application's ui plugins. Do not edit; it is derived. */",
  ];
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
  const path = join(home, "packages/ui/src/plugins.generated.css");
  writeFileSync(path, css);
  return { plugins: ui.map((p) => p.as), css, path, warnings };
}

/** Every plugin directory the framework ships, for `fishtea plugin list` outside an application. */
export function corePlugins(home: string): PluginManifest[] {
  const root = join(home, "plugins");
  if (!existsSync(root)) return [];
  return readdirSync(root).sort().map((n) => readManifestAt(join(root, n))).filter((m): m is PluginManifest => !!m);
}
