/**
 * The pour (BLUEPRINT §3 step 4, §10): exactly one of ask | form | confirm-write | answer, plus the
 * notification turn kind. Builders here; the decision lives in engine.ts.
 */
import { type ShapeDef, type Spec, type FormField, type VesselName, deriveForm, renderPhrase, vesselFor, getShape } from "@fishtea/spec";
import type { Provenance } from "./plan/index.ts";
import { lookup, resolve } from "./plan/index.ts";

export interface Chip { label: string; shape: string; args?: Record<string, unknown>; gated?: boolean }
export interface ClassMeta { name: string; ms: number; confidence: number; reasoning?: string; calls?: { name: string; arguments: Record<string, unknown> }[]; timedOut?: boolean; error?: string; recalled?: number }

export type AskReason = "greeting" | "no-match" | "low-confidence" | "budget" | "pool-down" | "not-allowed";

export interface AskPour { kind: "ask"; phrase: string; hint?: string; shape?: string; fields?: FormField[]; options: Chip[]; reason: AskReason; classifier?: ClassMeta }
export interface FormPour { kind: "form"; shape: string; phrase: string; hint?: string; fields: FormField[]; known: Record<string, unknown>; errors?: Record<string, string>; error?: string; options?: Chip[]; classifier?: ClassMeta }
export interface ConfirmWritePour { kind: "confirm-write"; shape: string; phrase: string; summary: string; fields: FormField[]; known: Record<string, unknown>; classifier?: ClassMeta }
export interface AnswerPour { kind: "answer"; shape: string; phrase: string; vessel: VesselName; answer: unknown; next: Chip[]; provenance: Provenance; classifier?: ClassMeta; stale?: boolean }
export interface NotificationPour { kind: "notification"; author: "system" | "operator"; name?: string | null; text: string; next: Chip[] }
export type Pour = AskPour | FormPour | ConfirmWritePour | AnswerPour | NotificationPour;

export const chip = (spec: Spec, shape: string, args?: Record<string, unknown>, label?: string, persona?: string): Chip | null => {
  const s = getShape(spec, shape);
  if (!s) return null;
  const c: Chip = { label: label ?? s.asks, shape };
  if (args && Object.keys(args).length) c.args = args;
  if (persona && !s.allow.includes(persona)) c.gated = true;
  return c;
};

/** `{item.name}` / `{order.id}` label templates. */
export function renderLabel(template: string, scope: Record<string, unknown>): string {
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_.]*)\}/g, (_, path) => { const v = lookup(scope, path); return v == null ? "" : String(v); }).replace(/\s+/g, " ").trim();
}

/** next[] affordances of a shape, fanned out over `each` arrays in the answer (capped). */
export function nextChips(spec: Spec, shape: ShapeDef, answer: unknown, args: Record<string, unknown>, persona: string, cap = 6): Chip[] {
  const chips: Chip[] = [];
  const base: Record<string, unknown> = { ...args, answer, ...(answer && typeof answer === "object" && !Array.isArray(answer) ? (answer as object) : {}) };
  for (const n of shape.next ?? []) {
    if (n.each) {
      const arr = lookup(base, n.each);
      if (!Array.isArray(arr)) continue;
      for (const item of arr.slice(0, cap)) {
        const scope = { ...base, item };
        const c = chip(spec, n.shape, resolve(n.args ?? {}, scope) as Record<string, unknown>, n.label ? renderLabel(n.label, scope) : undefined, persona);
        if (c) chips.push(c);
      }
    } else {
      const c = chip(spec, n.shape, resolve(n.args ?? {}, base) as Record<string, unknown>, n.label ? renderLabel(n.label, base) : undefined, persona);
      if (c) chips.push(c);
    }
  }
  return chips;
}

export function phraseFor(shape: ShapeDef, args: Record<string, unknown>): string {
  return renderPhrase(shape.phrase, args, shape.asks);
}

export function askPour(p: Omit<AskPour, "kind">): AskPour { return { kind: "ask", ...p }; }
export function formPour(shapeName: string, shape: ShapeDef, known: Record<string, unknown>, extra: Partial<FormPour> = {}): FormPour {
  return { kind: "form", shape: shapeName, phrase: phraseFor(shape, known), fields: deriveForm(shape), known, ...extra };
}
export function confirmPour(shapeName: string, shape: ShapeDef, known: Record<string, unknown>, extra: Partial<ConfirmWritePour> = {}): ConfirmWritePour {
  const summary = `${shape.asks}: ${Object.entries(known).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k} = ${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ") || "no details"}`;
  return { kind: "confirm-write", shape: shapeName, phrase: phraseFor(shape, known), summary, fields: deriveForm(shape), known, ...extra };
}
export function answerPour(spec: Spec, shapeName: string, shape: ShapeDef, args: Record<string, unknown>, answer: unknown, provenance: Provenance, persona: string, extra: Partial<AnswerPour> = {}): AnswerPour {
  return { kind: "answer", shape: shapeName, phrase: phraseFor(shape, args), vessel: vesselFor(shape, spec), answer, next: nextChips(spec, shape, answer, args, persona), provenance, ...extra };
}

export { vesselFor };
