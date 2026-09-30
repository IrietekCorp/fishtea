/**
 * The lighter settings an operator may change from /admin without touching the whole spec: the scalar
 * values in `rules` (a reply window, a session gap, a confidence floor, the site's copy) and each plugin's
 * configuration (a design system's accent). Everything is read off the spec as it stands, so a new rule
 * appears here without anyone listing it; structure — the layout language, the site map's sections — is
 * not a setting and stays in the spec editor.
 *
 * A change is only ever one of the settings offered, coerced to the type it already has, and written
 * through `applySectionPatch`: the whole spec is validated and the section's version bumped, or nothing
 * is written.
 */
import { applySectionPatch, leaves, pathPatch, readSpecFile, type App } from "@fishtea/spec";

export interface Setting {
  /** "rules.contact.replyWithinDays", "plugins.piscopour.config.accent" */
  id: string;
  section: "rules" | "plugins";
  /** the path inside the section */
  path: string;
  group: string;
  label: string;
  type: "string" | "text" | "number" | "boolean" | "enum";
  values?: string[];
  value: unknown;
}

/** rules subtrees that are structure, not settings — except the site's copy, which is prose. */
const STRUCTURE = ["present", "site"];
/**
 * Rules that guard visitors rather than tune the site: whether a write is confirmed first, and how sure
 * the engine must be before it writes. They stay in the spec, where changing one is a deliberate edit
 * that is reviewed like any other — not a checkbox beside a reply window.
 */
const GUARDED = ["writes"];

export function settingsOf(app: App): Setting[] {
  // the application's own file, not the loaded spec: a plugin's contribution is not this application's setting
  const spec = readSpecFile(app.specPath) as Record<string, any>;
  const out: Setting[] = [];
  for (const { path, value } of leaves(spec.rules ?? {})) {
    const top = path.split(".")[0];
    if (STRUCTURE.includes(top) && !path.startsWith("site.copy.")) continue;
    if (GUARDED.includes(top)) continue;
    if (value !== null && typeof value === "object") continue; // arrays: structure
    const type = typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : typeof value === "string" && (value.length > 80 || value.includes("\n")) ? "text" : "string";
    if (!["boolean", "number", "string", "text"].includes(type) || value === undefined) continue;
    out.push({ id: `rules.${path}`, section: "rules", path, group: `rules.${path.split(".").slice(0, -1).join(".") || top}`, label: path.split(".").pop()!, type, value });
  }
  for (const p of app.plugins) {
    for (const q of p.manifest.config ?? []) {
      const kind = q.type === "enum" ? "enum" : q.type === "int" || q.type === "number" ? "number" : q.type === "boolean" ? "boolean" : q.type === "text" ? "text" : "string";
      out.push({
        id: `plugins.${p.as}.config.${q.id}`, section: "plugins", path: `${p.as}.config.${q.id}`, group: `plugins.${p.as}`,
        label: q.ask, type: kind, values: q.values as string[] | undefined, value: spec.plugins?.[p.as]?.config?.[q.id] ?? q.default,
      });
    }
  }
  return out;
}

function coerce(s: Setting, v: unknown): unknown {
  switch (s.type) {
    case "number": { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`${s.id}: a number`); return n; }
    case "boolean": if (typeof v !== "boolean") throw new Error(`${s.id}: true or false`); return v;
    case "enum": if (!s.values?.includes(String(v))) throw new Error(`${s.id}: one of ${s.values?.join(", ")}`); return String(v);
    default: if (typeof v !== "string" || v.length > 4000) throw new Error(`${s.id}: text, at most 4000 characters`); return v;
  }
}

/**
 * Apply changes to offered settings only. Grouped by section, so each section is patched, validated and
 * versioned once. Returns the sections written, so the caller can regenerate what depends on them.
 */
export function applySettings(app: App, changes: { id: string; value: unknown }[]): { sections: string[] } {
  const offered = new Map(settingsOf(app).map((s) => [s.id, s]));
  const patches: Record<string, any> = {};
  for (const ch of changes) {
    const s = offered.get(ch.id);
    if (!s) throw new Error(`${ch.id} is not a setting`);
    const patch = pathPatch(s.path, coerce(s, ch.value));
    patches[s.section] = deepMerge(patches[s.section] ?? {}, patch);
  }
  for (const [section, patch] of Object.entries(patches)) applySectionPatch(app.specPath, section, patch, { dir: app.dir });
  return { sections: Object.keys(patches) };
}

const deepMerge = (a: any, b: any): any => {
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(a[k], v);
  return out;
};
