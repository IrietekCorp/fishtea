/**
 * Section editing shared by the TUI and the operator HTTP surface: apply a patch to one section of spec.json,
 * validate the whole spec, bump that section's version, write. Never writes an invalid spec.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { validateSpec, bumpVersion, SECTIONS, type Section } from "@fishtea/spec";

export function readSpecFile(path: string): any { return JSON.parse(readFileSync(path, "utf8")); }

export function writeSpecFile(path: string, spec: unknown) { writeFileSync(path, JSON.stringify(spec, null, 2) + "\n"); }

/** Deep-merge `patch` into `spec[section]` (null deletes a key), bump version, validate, write. */
export function applySectionPatch(path: string, section: string, patch: unknown, opts: { replace?: boolean; dir?: string } = {}) {
  if (!(SECTIONS as readonly string[]).includes(section)) throw new Error(`unknown section ${section}`);
  const spec = readSpecFile(path);
  const before = spec[section] ?? {};
  const next = opts.replace ? { ...(patch as any) } : merge(before, patch);
  next.version = bumpVersion(before.version);
  spec[section] = next;
  validateSpec(spec, { dir: opts.dir ?? path.replace(/\/[^/]+$/, "") });
  writeSpecFile(path, spec);
  return { version: next.version, section: section as Section };
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
