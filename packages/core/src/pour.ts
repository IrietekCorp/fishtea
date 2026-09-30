/**
 * The pour (BLUEPRINT §3 step 4, §10): exactly one of ask | form | confirm-write | answer, plus the
 * notification turn kind. Builders here; the decision lives in engine.ts.
 */
import { type ShapeDef, type Spec, type FormField, type VesselName, type PresentTree, deriveForm, renderPhrase, vesselFor, getShape, resolvePresent } from "@fishtea/spec";
import type { Provenance } from "./plan/index.ts";
import { lookup, resolve } from "./plan/index.ts";

export interface Chip {
  label: string; shape: string; args?: Record<string, unknown>; gated?: boolean;
  /**
   * Fire when this form field changes, instead of when somebody clicks.
   *
   * json-render's `watch` reacts to a change by mutating a client-side state tree. This reacts by
   * taking a *turn*: the same utterance a click would have sent, so it is gated by persona, planned,
   * given provenance and appended to the trail like everything else. A second memory in the browser is
   * exactly what the trail exists to avoid.
   */
  on?: { field: string };
}
export interface ClassMeta { name: string; ms: number; confidence: number; reasoning?: string; calls?: { name: string; arguments: Record<string, unknown> }[]; timedOut?: boolean; error?: string; recalled?: number }

export type AskReason = "greeting" | "no-match" | "low-confidence" | "budget" | "pool-down" | "not-allowed";

export interface AskPour { kind: "ask"; phrase: string; hint?: string; shape?: string; fields?: FormField[]; options: Chip[]; reason: AskReason; classifier?: ClassMeta }
export interface FormPour { kind: "form"; shape: string; phrase: string; hint?: string; fields: FormField[]; known: Record<string, unknown>; errors?: Record<string, string>; error?: string; options?: Chip[]; classifier?: ClassMeta }
export interface ConfirmWritePour { kind: "confirm-write"; shape: string; phrase: string; summary: string; fields: FormField[]; known: Record<string, unknown>; classifier?: ClassMeta }
export interface AnswerPour {
  kind: "answer"; shape: string; phrase: string; vessel: VesselName; answer: unknown; next: Chip[]; provenance: Provenance; classifier?: ClassMeta; stale?: boolean;
  /**
   * How to lay the answer out: the shape's organisms from `rules.present`, or derived from the spec, with
   * each one's molecule and clicks resolved. A function of the spec and the answer — never chosen by a
   * model — so a headless caller, an API client and every front end get the same page.
   */
  present?: PresentTree;
  /** the arguments the shape was asked with, so a front end can refine the page rather than replace it */
  args?: Record<string, unknown>;
}
export interface NotificationPour { kind: "notification"; author: "system" | "operator"; name?: string | null; text: string; next: Chip[] }

/**
 * One piece of a composite answer.
 *
 * `of` is an ordinary pour — not a new component type. That is the whole difference from a generative-UI
 * catalogue: nothing here invents widgets for a model to choose between, so all seven vessels keep their
 * contracts, `container.tsx` gains one case rather than a renderer, and a ui plugin's vessel override
 * composes for free because overrides are already looked up per pour kind.
 */
export interface Part {
  of: AnswerPour | FormPour | NotificationPour;
  children?: string[];
  /** the shape whose plan produced it, so the verify strip can attribute each piece */
  from?: string;
}

/**
 * Several vessels, composed for this turn.
 *
 * A flat `id → part` map rather than a nested tree or an array, for three reasons that only a map gives:
 * one part can be replaced while the others stand (so a pour can stream in pieces), a part can be
 * *named* — by a chip, by a stream patch, by an anchor — and nothing has to resend its ancestors to
 * change a leaf. An array can only be replaced whole.
 */
export interface CompositePour {
  kind: "composite";
  shape: string;
  phrase: string;
  root: string;
  parts: Record<string, Part>;
  next: Chip[];
  /** one per part that ran a plan, in the order they ran */
  provenance: Provenance[];
  /**
   * Parts still being planned, for a composite that is arriving in pieces.
   *
   * Present only while streaming: the lead is sent as soon as it is ready and each part follows over
   * SSE as its plan finishes. Absent means the composite is whole, which is what a headless run, an API
   * caller and a resumed turn always get — you cannot stream to something that is not listening.
   */
  pending?: string[];
  classifier?: ClassMeta;
}

export type Pour = AskPour | FormPour | ConfirmWritePour | AnswerPour | NotificationPour | CompositePour;

export const chip = (spec: Spec, shape: string, args?: Record<string, unknown>, label?: string, persona?: string, on?: { field: string }): Chip | null => {
  const s = getShape(spec, shape);
  if (!s) return null;
  const c: Chip = { label: label ?? s.asks, shape };
  if (args && Object.keys(args).length) c.args = args;
  if (on) c.on = on;
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
        const c = chip(spec, n.shape, resolve(n.args ?? {}, scope) as Record<string, unknown>, n.label ? renderLabel(n.label, scope) : undefined, persona, n.on);
        if (c) chips.push(c);
      }
    } else {
      const c = chip(spec, n.shape, resolve(n.args ?? {}, base) as Record<string, unknown>, n.label ? renderLabel(n.label, base) : undefined, persona, n.on);
      if (c) chips.push(c);
    }
  }
  return chips;
}

export function phraseFor(shape: ShapeDef, args: Record<string, unknown>): string {
  return renderPhrase(shape.phrase, args, shape.asks);
}

/**
 * Compose several answers into one pour.
 *
 * The leading shape's answer is the root; each composed shape becomes a sibling part keyed by its own
 * name, so a part is addressable by something a human can read (`parts.trending`) rather than by
 * position. `next` is the union of every part's chips, deduplicated — a composite offers what all of
 * its pieces offer, once each.
 */
export function compositePour(
  root: { shape: string; pour: AnswerPour; provenance: Provenance },
  parts: { shape: string; pour: AnswerPour; provenance: Provenance }[],
  o: { classifier?: ClassMeta } = {},
): CompositePour {
  const all = [root, ...parts];
  const map: Record<string, Part> = {};
  for (const p of all) map[p.shape] = { of: p.pour, from: p.shape };
  map[root.shape].children = parts.map((p) => p.shape);

  const next: Chip[] = [];
  for (const p of all) {
    for (const c of p.pour.next) {
      if (!next.some((x) => x.shape === c.shape && JSON.stringify(x.args ?? {}) === JSON.stringify(c.args ?? {}))) next.push(c);
    }
  }
  return {
    kind: "composite",
    shape: root.shape,
    phrase: root.pour.phrase,
    root: root.shape,
    parts: map,
    next,
    provenance: all.map((p) => p.provenance),
    ...(o.classifier ? { classifier: o.classifier } : {}),
  };
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
  return { kind: "answer", shape: shapeName, phrase: phraseFor(shape, args), vessel: vesselFor(shape, spec), answer, next: nextChips(spec, shape, answer, args, persona), provenance, present: resolvePresent(spec as never, shapeName, answer), args, ...extra };
}

export { vesselFor };
