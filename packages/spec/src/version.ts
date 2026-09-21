import { createHash } from "node:crypto";

export const SECTIONS = ["business", "entities", "calls", "rules", "shapes", "personas", "envelope", "notifications", "operator"] as const;
export type Section = (typeof SECTIONS)[number];

/** Canonical JSON: sorted keys, no whitespace. Stable across editors. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    const keys = Object.keys(value as object).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical((value as any)[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export function sectionHash(section: unknown): string {
  const copy = section && typeof section === "object" ? { ...(section as any) } : section;
  if (copy && typeof copy === "object") delete (copy as any).version;
  return createHash("sha256").update(canonical(copy)).digest("hex").slice(0, 16);
}

export function sectionHashes(spec: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of SECTIONS) if (spec[s] !== undefined) out[s] = sectionHash(spec[s]);
  return out;
}

/** "2026.09.21-1" → "2026.09.21-2" (same day) or today's date with -1. */
export function bumpVersion(current: string | undefined, now = new Date()): string {
  const today = `${now.getUTCFullYear()}.${String(now.getUTCMonth() + 1).padStart(2, "0")}.${String(now.getUTCDate()).padStart(2, "0")}`;
  const m = current?.match(/^(\d{4}\.\d{2}\.\d{2})-(\d+)$/);
  if (m && m[1] === today) return `${today}-${Number(m[2]) + 1}`;
  return `${today}-1`;
}
