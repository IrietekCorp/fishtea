/**
 * Plugins: everything outside the conversation itself.
 *
 * The spec already had six places where something entity-specific has to plug in, and archetypes were
 * already de-facto plugins — a spec fragment plus calls, seed and an interview — that nobody had named.
 * A plugin is that, given a manifest and a resolver:
 *
 *   integration   calls, entities, shapes: Stripe, an AI API, a shipping quote
 *   ui            a design system — tokens, and optionally its own vessels and per-shape views
 *   shell         the whole front end a visitor sees, in place of the framework's container
 *   auth          how a visitor becomes known
 *   classifier    an alternative to the needle pool
 *   channel       where a notification is delivered
 *   archetype     a template `fishtea new` can start from
 *
 * Two rules keep this from becoming a mess.
 *
 * **The spec stays yours.** A plugin's contribution is merged at *load* time and never written into
 * spec.json. `fishtea plugin add` writes one line naming the plugin; the entities and calls it brings
 * appear in the loaded spec, tagged with where they came from, and vanish when you remove it. Nothing is
 * inlined, so there is no generated code to reconcile later and no diff churn when a plugin is upgraded.
 *
 * **The application always wins.** If your spec defines `calls.payments.charge` and so does a plugin,
 * yours stands and the plugin's is dropped with a warning — you can always override a plugin by naming the
 * same thing. Two plugins claiming the same name is a different matter: nobody asked for that, and
 * silently picking one would be a bug you would find much later, so it is an error.
 */
import { satisfies } from "./release.ts";
import type { VesselName } from "./spec.ts";

export const PLUGIN_KINDS = ["integration", "ui", "auth", "classifier", "channel", "archetype", "shell"] as const;
export type PluginKind = (typeof PLUGIN_KINDS)[number];

/** Sections of the spec a plugin may contribute to. `business` and `envelope` are the application's alone. */
export const CONTRIBUTABLE = ["entities", "calls", "shapes", "rules", "personas", "notifications", "operator"] as const;
export type Contributable = (typeof CONTRIBUTABLE)[number];

/** A configuration question, the same shape a template's onboard.json uses. One vocabulary, not two. */
export interface PluginQuestion {
  id: string;
  ask: string;
  type: "string" | "text" | "int" | "number" | "boolean" | "enum" | "multi" | "list";
  values?: string[];
  default?: unknown;
  doc?: string;
  /** a secret: prompted, never written into spec.json, read from the environment at run time */
  env?: string;
  /**
   * ui plugins: what the answer is for. "tokens" (the default) is a design-system knob — config id
   * `accentHue` is the custom property `--<plugin>-accent-hue` in the stylesheet. "views" is read by the
   * plugin's own views from the application's spec (a heading, a placeholder), so it has no property and
   * the stylesheet is not checked for one.
   */
  for?: "tokens" | "views";
}

export interface PluginManifest {
  name: string;
  version: string;
  kind: PluginKind;
  doc?: string;
  /** framework range this plugin needs */
  fishtea?: string;
  /** spec fragments merged into the application */
  provides?: Partial<Record<Contributable, Record<string, unknown>>>;
  /** questions asked when the plugin is added */
  config?: PluginQuestion[];
  /** environment variables that must be set for it to work; `fishtea doctor` checks them */
  env?: string[];
  /** ui plugins: a stylesheet of design tokens, relative to the plugin directory */
  tokens?: string;
  /** ui plugins: vessel name → component file, relative to the plugin directory */
  vessels?: Record<string, string>;
  /**
   * ui plugins: shape name → component file exporting `View`, for a shell to draw that shape with. A view
   * is the application's page for one shape (its home, its contact overlay); anything unclaimed is drawn
   * from `pour.present` or the shape's vessel. Shape names are checked against the spec by `ui-assets`.
   */
  views?: Record<string, string>;
  /**
   * ui plugins: the brand's own frame for a shell to wear — `header` and/or `footer`, each a component file
   * exporting `View`. The shell still owns navigation and passes it in (HeaderProps / FooterProps in
   * @fishtea/plugins/sections/types); a slot left out is the shell's own. For a business whose header and
   * footer are part of its brand, not something a framework should restyle.
   */
  chrome?: Partial<Record<ChromeSlot, string>>;
  /**
   * classifier and channel plugins: the module that implements the seam, relative to the plugin
   * directory. What it must export depends on the kind — see SEAM_EXPORT — and is checked when it is
   * loaded, not here, because reading a manifest must never run anybody's code.
   */
  module?: string;
}

/** The parts of a shell's frame a ui plugin may replace. */
export const CHROME_SLOTS = ["header", "footer"] as const;
export type ChromeSlot = (typeof CHROME_SLOTS)[number];

/**
 * The vessels a `ui` plugin may override, which is all of them: seven shapes of answer plus the three
 * the engine pours directly. A name outside this list is a typo, and a typo that silently overrides
 * nothing is the exact failure this second pass exists to remove.
 */
export const ANSWER_VESSELS = ["list", "card", "detail", "compare", "timeline", "confirm"] as const;
export const VESSELS = [...ANSWER_VESSELS, "ask", "form", "confirm-write", "notification"] as const;
export type OverridableVessel = (typeof VESSELS)[number];

/** The six a shape may name must stay exactly spec.ts's VesselName; the compiler checks both directions. */
const _answersMatch: readonly VesselName[] = ANSWER_VESSELS;
const _noExtras: (typeof ANSWER_VESSELS)[number] = null as unknown as VesselName;
void _answersMatch; void _noExtras;

/** The export a seam plugin's `module` must provide, by kind. Kinds absent here have no seam module. */
export const SEAM_EXPORT: Partial<Record<PluginKind, string>> = {
  classifier: "createClassifier",
  channel: "createChannel",
};

/**
 * What a shell plugin's `module` exports. Deliberately not a seam: a shell is browser code the UI bundle
 * imports, and the core — which loads seam modules server-side — must never import it.
 */
export const SHELL_EXPORT = "Shell";
/** What a ui plugin's per-shape view file exports. */
export const VIEW_EXPORT = "View";

/** Kinds whose whole purpose is the module they carry, so a manifest without one cannot work. */
export const SEAM_KINDS = Object.keys(SEAM_EXPORT) as PluginKind[];

/** How an application asks for a plugin (spec.plugins.<localName>). */
export interface PluginUse {
  use: string;
  version?: string;
  kind?: PluginKind;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

/** A plugin that has been found on disk and read. */
export interface ResolvedPlugin {
  /** the name the application gave it in spec.plugins */
  as: string;
  manifest: PluginManifest;
  dir: string;
  use: PluginUse;
  /** where it was found, for `fishtea plugin list` */
  from: "local" | "node_modules" | "builtin" | "path";
}

export class PluginError extends Error {
  constructor(public problems: string[]) {
    super(`plugin problems:\n  - ${problems.join("\n  - ")}`);
  }
}

export function validateManifest(m: unknown, where: string): string[] {
  const problems: string[] = [];
  const p = m as PluginManifest;
  if (!p || typeof p !== "object") return [`${where}: not an object`];
  if (!p.name || !/^[a-z][a-z0-9-]{0,40}$/.test(p.name)) problems.push(`${where}: name must be lowercase letters, digits and dashes`);
  if (!p.version || !/^\d+\.\d+\.\d+/.test(p.version)) problems.push(`${where}: version must be semver`);
  if (!PLUGIN_KINDS.includes(p.kind)) problems.push(`${where}: kind must be one of ${PLUGIN_KINDS.join(", ")}`);
  for (const section of Object.keys(p.provides ?? {})) {
    if (!CONTRIBUTABLE.includes(section as Contributable)) {
      problems.push(`${where}: plugins may not contribute "${section}" (allowed: ${CONTRIBUTABLE.join(", ")})`);
    }
  }
  for (const q of p.config ?? []) if (!q.id || !q.ask) problems.push(`${where}: every config question needs an id and an ask`);
  // A classifier or channel plugin *is* its module. Without one it resolves, merges and contributes
  // nothing, which used to be a plugin that looked installed and did nothing at all.
  if (SEAM_KINDS.includes(p.kind) && !p.module) {
    problems.push(`${where}: a ${p.kind} plugin needs "module", the file exporting ${SEAM_EXPORT[p.kind]}()`);
  }
  if (p.kind === "shell" && !p.module) problems.push(`${where}: a shell plugin needs "module", the file exporting ${SHELL_EXPORT}`);
  if (p.module && (p.module.startsWith("/") || p.module.includes(".."))) {
    problems.push(`${where}: "module" must be a path inside the plugin, not ${p.module}`);
  }
  for (const [vessel, file] of Object.entries(p.vessels ?? {})) {
    if (!VESSELS.includes(vessel as OverridableVessel)) {
      problems.push(`${where}: "${vessel}" is not a vessel (one of ${VESSELS.join(", ")})`);
    }
    if (typeof file !== "string" || file.startsWith("/") || file.includes("..")) {
      problems.push(`${where}: vessel "${vessel}" must name a file inside the plugin, not ${String(file)}`);
    }
  }
  if (p.vessels && p.kind !== "ui") problems.push(`${where}: only a ui plugin may override vessels`);
  for (const [shape, file] of Object.entries(p.views ?? {})) {
    if (typeof file !== "string" || file.startsWith("/") || file.includes("..")) problems.push(`${where}: view "${shape}" must name a file inside the plugin, not ${String(file)}`);
  }
  if (p.views && p.kind !== "ui") problems.push(`${where}: only a ui plugin may carry views`);
  for (const [slot, file] of Object.entries(p.chrome ?? {})) {
    if (!CHROME_SLOTS.includes(slot as ChromeSlot)) problems.push(`${where}: "${slot}" is not a chrome slot (one of ${CHROME_SLOTS.join(", ")})`);
    if (typeof file !== "string" || file.startsWith("/") || file.includes("..")) problems.push(`${where}: chrome "${slot}" must name a file inside the plugin, not ${String(file)}`);
  }
  if (p.chrome && p.kind !== "ui") problems.push(`${where}: only a ui plugin may carry chrome`);
  return problems;
}

/** Substitute {{config.x}} and {{name}} in a contributed fragment. Strings only; structure is never built. */
export function interpolate(value: unknown, vars: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (whole, path: string) => {
      const v = path.split(".").reduce<any>((o, k) => o?.[k], vars);
      return v === undefined ? whole : String(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, vars));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolate(v, vars);
    return out;
  }
  return value;
}

export interface MergeResult {
  spec: any;
  /** "calls.charge" → the plugin that contributed it */
  provenance: Record<string, string>;
  warnings: string[];
}

/**
 * Merge resolved plugins into a spec. Pure: returns a new spec, leaves the input alone.
 *
 * `impl.plugin` on a contributed call is rewritten to an absolute path into the plugin's directory, so the
 * loader and the executor can find a plugin's SQL and modules without either of them knowing plugins exist.
 */
export function mergePlugins(raw: any, plugins: ResolvedPlugin[]): MergeResult {
  const spec = structuredClone(raw);
  const provenance: Record<string, string> = {};
  const warnings: string[] = [];
  const claimed = new Map<string, string>();               // "calls.charge" → plugin name

  for (const p of plugins) {
    if (p.use.enabled === false) continue;
    const vars = { config: { ...defaultsOf(p.manifest), ...(p.use.config ?? {}) }, name: p.as, plugin: p.manifest.name };

    for (const section of CONTRIBUTABLE) {
      const fragment = p.manifest.provides?.[section];
      if (!fragment) continue;
      spec[section] ??= { version: spec.business?.version ?? "0.0.0-plugin" };
      for (const [key, value] of Object.entries(fragment)) {
        if (key === "version" || key === "doc") continue;
        const path = `${section}.${key}`;

        if (Object.prototype.hasOwnProperty.call(spec[section], key) && !claimed.has(path)) {
          warnings.push(`${path}: your spec defines this, so the "${p.as}" plugin's version is ignored`);
          continue;                                         // the application always wins
        }
        const other = claimed.get(path);
        if (other && other !== p.as) {
          throw new PluginError([`${path} is claimed by both "${other}" and "${p.as}" — rename one, or disable it`]);
        }

        let merged = interpolate(value, vars) as any;
        if (section === "calls" && merged?.impl) merged = { ...merged, impl: resolveImpl(merged.impl, p) };
        spec[section][key] = merged;
        claimed.set(path, p.as);
        provenance[path] = p.as;
      }
    }
  }
  return { spec, provenance, warnings };
}

/** A contributed call's files live in the plugin, so its impl paths become absolute at merge time. */
function resolveImpl(impl: any, p: ResolvedPlugin): any {
  const out = { ...impl };
  delete out.plugin;                                        // consumed here; the loader never sees it
  for (const key of ["sql", "module"] as const) {
    const rel = out[key];
    if (typeof rel === "string" && !rel.startsWith("/")) out[key] = `${p.dir}/${rel}`;
  }
  return out;
}

export function defaultsOf(m: PluginManifest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const q of m.config ?? []) if (q.default !== undefined) out[q.id] = q.default;
  return out;
}

/** Every environment variable the enabled plugins need but the process does not have. */
export function missingEnv(plugins: ResolvedPlugin[], env: Record<string, string | undefined> = process.env): { plugin: string; vars: string[] }[] {
  const out: { plugin: string; vars: string[] }[] = [];
  for (const p of plugins) {
    if (p.use.enabled === false) continue;
    const declared = [...(p.manifest.env ?? []), ...(p.manifest.config ?? []).filter((q) => q.env).map((q) => q.env!)];
    const vars = declared.filter((v) => !env[v]);
    if (vars.length) out.push({ plugin: p.as, vars });
  }
  return out;
}

/** Does this plugin run on this framework build? */
export function pluginCompatible(m: PluginManifest, frameworkVersion: string): boolean {
  return !m.fishtea || satisfies(frameworkVersion, m.fishtea);
}
