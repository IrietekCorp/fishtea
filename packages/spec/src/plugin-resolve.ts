/**
 * Finding a plugin on disk.
 *
 * Four places, nearest first, and the order is the whole social model: what you are working on right now
 * beats what you installed, which beats what shipped with the framework. That is what makes a plugin you
 * are writing locally testable before anyone else sees it, and what makes "promote it to core" a move
 * rather than a rewrite — the same directory, in a different place, resolved the same way.
 *
 *   ./anything or /anything   an explicit path, relative to the application
 *   <app>/plugins/<name>      yours, local to this application — where a new one starts
 *   <app>/node_modules/<name> installed with bun add
 *   <framework>/plugins/<name> shipped with fishtea — where a promoted one lands
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { FISHTEA_VERSION } from "./release.ts";
import { PluginError, pluginCompatible, validateManifest, type PluginManifest, type PluginUse, type ResolvedPlugin } from "./plugin.ts";

export const PLUGIN_MANIFEST = "fishtea.plugin.json";

/**
 * Where the framework's own files live — `templates/`, `plugins/`, and the browser bundle. Four ways to
 * be running, and the answer differs for each:
 *
 *   FISHTEA_HOME set          always wins; Compose and the generated app shim both set it
 *   a source checkout         packages/spec/src/… → three levels up
 *   a compiled binary         <home>/bin/fishtea → two levels up, the layout install.sh creates
 *   a binary run from a copy  fall back to ~/.fishtea/current
 *
 * A directory only counts if it actually has `templates/`, because guessing wrong here surfaces much
 * later as "unknown template" rather than as a path problem.
 */
export function frameworkHome(): string {
  // A framework directory has its builtin plugins or its templates; a container's image has the former only.
  const looksRight = (d: string) => !!d && (existsSync(join(d, "plugins")) || existsSync(join(d, "templates")));
  // FISHTEA_HOME wins when it is there. It can name a directory that is not: an application's .env holds
  // the host's install path, and a container that reads that .env has the framework somewhere else — so
  // a FISHTEA_HOME that does not exist falls through to where this code is actually running.
  const env = process.env.FISHTEA_HOME;
  if (env && existsSync(resolve(env))) return resolve(env);

  let fromSource = "";
  try { fromSource = resolve(dirname(new URL(import.meta.url).pathname), "../../.."); } catch { /* bunfs */ }
  if (looksRight(fromSource)) return fromSource;

  // A compiled binary is installed at <home>/bin/fishtea.
  const fromExe = dirname(dirname(process.execPath));
  if (looksRight(fromExe)) return fromExe;

  const current = join(homedir(), ".fishtea", "current");
  if (looksRight(current)) return current;

  return fromSource || current;
}

export interface Candidate { dir: string; from: ResolvedPlugin["from"] }

/** Every place `use` could be, in order, whether or not it exists. Exported so errors can list them. */
export function candidates(use: string, appDir: string, home = frameworkHome()): Candidate[] {
  if (use.startsWith(".") || isAbsolute(use)) return [{ dir: resolve(appDir, use), from: "path" }];
  return [
    { dir: join(appDir, "plugins", use), from: "local" },
    { dir: join(appDir, "node_modules", use), from: "node_modules" },
    { dir: join(home, "plugins", use), from: "builtin" },
  ];
}

export function readManifestAt(dir: string): PluginManifest | null {
  const p = join(dir, PLUGIN_MANIFEST);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as PluginManifest; } catch (e) {
    throw new PluginError([`${p}: ${(e as Error).message}`]);
  }
}

/** Resolve one `spec.plugins` entry. Throws with every place it looked when nothing answers. */
export function resolvePlugin(as: string, use: PluginUse, appDir: string, home = frameworkHome()): ResolvedPlugin {
  const tried = candidates(use.use, appDir, home);
  for (const c of tried) {
    const manifest = readManifestAt(c.dir);
    if (!manifest) continue;
    const problems = validateManifest(manifest, join(c.dir, PLUGIN_MANIFEST));
    if (problems.length) throw new PluginError(problems);
    if (use.version && !(globalThis as any).Bun?.semver?.satisfies?.(manifest.version, use.version)) {
      throw new PluginError([`plugins.${as}: ${manifest.name} ${manifest.version} does not satisfy ${use.version} (${c.dir})`]);
    }
    if (!pluginCompatible(manifest, FISHTEA_VERSION)) {
      throw new PluginError([`plugins.${as}: ${manifest.name} needs fishtea ${manifest.fishtea}, this is ${FISHTEA_VERSION}`]);
    }
    if (use.kind && manifest.kind !== use.kind) {
      throw new PluginError([`plugins.${as}: expected a "${use.kind}" plugin, ${manifest.name} is "${manifest.kind}"`]);
    }
    return { as, manifest, dir: c.dir, use, from: c.from };
  }
  throw new PluginError([`plugins.${as}: no plugin "${use.use}" — looked in:\n      ${tried.map((t) => t.dir).join("\n      ")}`]);
}

/** Resolve every plugin an application asks for, in declaration order. */
export function resolvePlugins(spec: any, appDir: string, home = frameworkHome()): ResolvedPlugin[] {
  const section = spec?.plugins;
  if (!section || typeof section !== "object") return [];
  const out: ResolvedPlugin[] = [];
  for (const [as, use] of Object.entries(section)) {
    if (as === "version" || as === "doc") continue;
    out.push(resolvePlugin(as, use as PluginUse, appDir, home));
  }
  return out;
}

/** Everything installable from here, for `fishtea plugin list --available`. */
export function discoverPlugins(appDir: string, home = frameworkHome()): ResolvedPlugin[] {
  const out: ResolvedPlugin[] = [];
  const roots: [string, ResolvedPlugin["from"]][] = [[join(appDir, "plugins"), "local"], [join(home, "plugins"), "builtin"]];
  for (const [root, from] of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root).sort()) {
      const dir = join(root, name);
      if (!statSync(dir).isDirectory()) continue;
      const manifest = readManifestAt(dir);
      if (manifest && !validateManifest(manifest, dir).length) {
        out.push({ as: manifest.name, manifest, dir, use: { use: name }, from });
      }
    }
  }
  return out;
}
