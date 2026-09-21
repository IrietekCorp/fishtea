/**
 * Section editing, shared by the TUI, the CLI and the operator HTTP surface: apply a patch to one section of
 * spec.json, validate the whole spec, bump that section's version, write. Never writes an invalid spec.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { validateSpec } from "./load.ts";
import { bumpVersion, SECTIONS, type Section } from "./version.ts";

export function readSpecFile(path: string): any { return JSON.parse(readFileSync(path, "utf8")); }
export function writeSpecFile(path: string, spec: unknown) { writeFileSync(path, JSON.stringify(spec, null, 2) + "\n"); }

/** Deep-merge `patch` into `spec[section]` (null deletes a key), bump the section version, validate, write. */
export function applySectionPatch(path: string, section: string, patch: unknown, opts: { replace?: boolean; dir?: string } = {}) {
  if (!(SECTIONS as readonly string[]).includes(section)) throw new Error(`unknown section ${section}`);
  const spec = readSpecFile(path);
  const before = spec[section] ?? {};
  const next = opts.replace ? { ...(patch as any) } : merge(before, patch);
  next.version = bumpVersion(before.version);
  spec[section] = next;
  validateSpec(spec, { dir: opts.dir ?? dirname(path) });
  writeSpecFile(path, spec);
  return { version: next.version as string, section: section as Section };
}

export function merge(base: any, patch: any): any {
  if (patch === null) return undefined;
  if (Array.isArray(patch) || typeof patch !== "object" || typeof base !== "object" || base === null || Array.isArray(base)) return patch;
  const out: any = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else out[k] = merge(base[k], v);
  }
  return out;
}

/** Leaf paths of a value tree, for scoped editing ("pricing.freeShippingOver" → 75). */
export function leaves(o: any, prefix = "", skip = new Set(["version", "doc"])): { path: string; value: unknown }[] {
  const out: { path: string; value: unknown }[] = [];
  for (const [k, v] of Object.entries(o ?? {})) {
    if (!prefix && skip.has(k)) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...leaves(v, `${prefix}${k}.`, skip));
    else out.push({ path: prefix + k, value: v });
  }
  return out;
}

/** "a.b.c" + value → { a: { b: { c: value } } } */
export function pathPatch(path: string, value: unknown): any {
  const patch: any = {};
  let cur = patch;
  const parts = path.split(".");
  parts.forEach((k, i) => { if (i === parts.length - 1) cur[k] = value; else cur = cur[k] = {}; });
  return patch;
}
