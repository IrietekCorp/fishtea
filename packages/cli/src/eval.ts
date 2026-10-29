/**
 * `fishtea eval` — the labelled set, and the two numbers that cannot be derived from a spec.
 *
 * Everything else about the classifier here writes itself. `fishtea tune` derives a training corpus
 * from triggers, inputs, seed values and the trail, because a spec has already declared that material.
 * This cannot be derived, and that is exactly why it has to exist: it is **ground truth**, a human
 * saying "this sentence means that shape", and it is the only thing in the project that can answer the
 * two questions standing in front of every remaining decision.
 *
 *   1. **What should `rules.classify.floor` be?** It is not a universal number. `needle3.cact` is
 *      byte-identical between engines 3.0.4 and 3.2.8, and the median confidence on a *correct* route
 *      moves from 0.79 to 0.07 between them; the WASM engine sits with the latter, so the pinned 0.35
 *      would keep 8 of 19 correct routes at full depth and 0 of 13 at four layers. A floor is a property
 *      of one engine's calibration, and the only honest way to pick one is to sweep it over labelled
 *      answers and look at what each value keeps and admits.
 *
 *   2. **Can FishTea gate without the model's head at all?** A locally fine-tuned rung reports
 *      `confidence: None`, which is the blocker in front of the whole tuning story (docs/TUNING.md). The
 *      proposed answer is a confidence FishTea computes from signals it already holds, and a proposal
 *      like that is worth precisely as much as the labelled set it was measured against.
 *
 * So the set is not a test fixture that happens to be about classification. It is the instrument. Which
 * is why `checkCases` is strict about it: a case naming a shape its persona may not ask is not a hard
 * case, it is a **wrong label**, and a wrong label silently moves the floor it is used to derive.
 *
 * ## What the tags are for
 *
 * Accuracy over a bag of sentences is close to meaningless, because the composition of the bag decides
 * the number. The tags split it into populations that answer different questions:
 *
 *   - `plain` carries a shape's own trigger. The shipped lexical router should get these; if the model
 *     does not beat it here, something is wrong.
 *   - `paraphrase` deliberately avoids every trigger. **This is the population that justifies the
 *     model's existence** — a dictionary cannot do it, and the gap between `plain` and `paraphrase` is
 *     the honest measure of what the megabytes buy.
 *   - `collision` is one shape's trigger sitting inside a sentence that means another. `viewCart`'s
 *     "my cart" inside `addToCart`'s "add to my cart" sent five of eight cart utterances to the wrong
 *     shape, one at confidence 1.00. `checkTriggers` now refuses that at load, so these cases guard a
 *     fix rather than describe a bug.
 *   - `bare` is a trigger with no arguments, which must still route: the engine's answer to a missing
 *     required argument is to pour a form (`missingRequired`), so saying nothing loses the turn.
 *   - `anaphora` needs the prior turn, and uses the exact `last answer listed:` line `recentContext`
 *     builds, so the measurement is of production and not of a format invented for the test.
 *   - `out-of-subset` is a real shape the asking persona may not ask. The tools are never offered, so
 *     the only correct answer is silence. This is not the gate being tested — the gate runs afterwards
 *     and is not the model's business — it is whether an unoffered tool stays uncalled.
 *   - `unsupported` is a plausible question about this business with no shape behind it. Harder, and
 *     more common in the wild, than off-topic.
 *   - `off-topic` is nothing to do with the business. Needle is good at these out of the box, and it is
 *     the first behaviour a corpus of nothing but positives trains away.
 *
 * Refusals (`out-of-subset`, `unsupported`, `off-topic`) are about a third of each set on purpose. A set
 * of positives only cannot tell a floor that keeps good answers from a floor that admits bad ones, which
 * is the entire question a floor exists to settle.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deriveTools, type App, type ToolSpec } from "@fishtea/spec";
import { personaShapes } from "./tune.ts";

export const EVAL_FILE = join("eval", "classify.jsonl");

export type EvalTag =
  | "plain" | "paraphrase" | "collision" | "bare" | "anaphora"
  | "out-of-subset" | "unsupported" | "off-topic";

/** The populations where the only correct answer is no call at all. */
export const REFUSAL_TAGS: EvalTag[] = ["out-of-subset", "unsupported", "off-topic"];

export interface EvalCase {
  /** What the visitor said. */
  text: string;
  /** Who is asking — this decides which tool subset the classifier is given. */
  persona: string;
  /** The shape it must reach, or null when the only right answer is to stay silent. */
  shape: string | null;
  /** Arguments that must be extracted. Checked as a subset: unlisted arguments are not wrong. */
  args?: Record<string, unknown>;
  /** Prior turns, in the exact shape `recentContext` builds them. */
  context?: string[];
  tag: EvalTag;
  /** Why this case earns its place, where that is not obvious. */
  why?: string;
}

export interface CaseResult {
  case: EvalCase;
  got: string | null;
  args: Record<string, unknown>;
  confidence: number;
  ms: number;
  /** Routed to the labelled shape (or correctly stayed silent). */
  correct: boolean;
  /** Every argument the label demands came back with the right value. Undefined when none were demanded. */
  argsOk?: boolean;
  /** What the shipped lexical router said about the same utterance, as an independent second opinion. */
  lexical?: string | null;
  error?: string;
}

// ── loading and checking ────────────────────────────────────────────────────

export function casesPath(app: App): string { return join(app.dir, EVAL_FILE); }

export function loadCases(app: App): EvalCase[] {
  const path = casesPath(app);
  if (!existsSync(path)) return [];
  const out: EvalCase[] = [];
  readFileSync(path, "utf8").split("\n").forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("//")) return;
    try { out.push(JSON.parse(t) as EvalCase); }
    catch (e) { throw new Error(`${EVAL_FILE} line ${i + 1} is not JSON: ${(e as Error).message}`); }
  });
  return out;
}

const TAGS = new Set<string>(["plain", "paraphrase", "collision", "bare", "anaphora", "out-of-subset", "unsupported", "off-topic"]);

/**
 * Refuse a labelled set that cannot mean what it says.
 *
 * A measuring instrument that is quietly wrong is worse than no instrument, and every problem below is
 * a way for one case to move a derived floor without anybody noticing.
 */
export function checkCases(app: App, cases: EvalCase[]): string[] {
  const problems: string[] = [];
  const subsets = personaShapes(app.spec);
  const tools = new Map(deriveTools(app.spec).map((t) => [t.name, t]));
  const at = (i: number) => `${EVAL_FILE} line ${i + 1}`;
  const seen = new Map<string, number>();

  cases.forEach((c, i) => {
    if (typeof c.text !== "string" || !c.text.trim()) { problems.push(`${at(i)}: no text`); return; }
    const key = `${c.persona}\u0000${c.text.toLowerCase()}\u0000${(c.context ?? []).join("|")}`;
    const first = seen.get(key);
    if (first !== undefined) problems.push(`${at(i)}: "${c.text}" as ${c.persona} is already case ${first + 1} — a duplicate counts twice and weights the score`);
    seen.set(key, i);

    if (!TAGS.has(c.tag)) problems.push(`${at(i)}: tag "${c.tag}" is not one of ${[...TAGS].join(", ")}`);
    const subset = subsets.get(c.persona);
    if (!subset) { problems.push(`${at(i)}: persona "${c.persona}" is not in this spec`); return; }

    const refusal = REFUSAL_TAGS.includes(c.tag);
    if (c.shape === null) {
      if (!refusal) problems.push(`${at(i)}: expects no call but is tagged "${c.tag}" — a case with no shape belongs to ${REFUSAL_TAGS.join(", ")}`);
      return;
    }
    if (refusal) { problems.push(`${at(i)}: tagged "${c.tag}" but names the shape "${c.shape}" — those tags mean the right answer is silence`); return; }

    const tool = tools.get(c.shape);
    if (!tool) {
      // A shape the classifier is never offered is a different mistake from one that does not exist,
      // and saying "not a shape" about a shape sitting in spec.json sends the reader to the wrong file.
      // `classify: false` means reachable by chip or next-action only — real, and not the model's to find.
      const declared = (app.spec.shapes as Record<string, unknown>)[c.shape];
      problems.push(declared && typeof declared === "object"
        ? `${at(i)}: "${c.shape}" is declared "classify": false, so the classifier is never offered it — it is reached by a chip, not by what a visitor types`
        : `${at(i)}: "${c.shape}" is not a shape in this spec`);
      return;
    }
    if (!subset.includes(c.shape)) {
      problems.push(`${at(i)}: ${c.persona} may not ask "${c.shape}", so it is never offered — label it null and tag it out-of-subset, or the case asks for something impossible`);
      return;
    }
    for (const k of Object.keys(c.args ?? {})) {
      if (!(tool.parameters?.properties as Record<string, unknown> | undefined)?.[k]) {
        problems.push(`${at(i)}: "${c.shape}" has no argument "${k}"`);
      }
    }
    if (c.tag === "bare" && Object.keys(c.args ?? {}).length) {
      problems.push(`${at(i)}: tagged "bare" but demands arguments — bare means the trigger alone, so the engine pours a form`);
    }
    if (c.tag === "anaphora" && !(c.context ?? []).length) {
      problems.push(`${at(i)}: tagged "anaphora" but carries no context, so there is nothing to refer back to`);
    }
  });
  return problems;
}

/**
 * The holes in the set.
 *
 * Deliberately not every (persona, shape) pair: that is dozens of combinations for an archetype this
 * size, most of them the same sentence asked by somebody else, and a set padded to satisfy a cross
 * product measures padding. What matters is that no shape and no persona goes entirely unexercised,
 * because an unexercised shape is one nobody has checked the classifier can reach at all.
 */
export function coverage(app: App, cases: EvalCase[]): { shapes: string[]; personas: string[] } {
  const subsets = personaShapes(app.spec);
  const askedShapes = new Set(cases.map((c) => c.shape).filter(Boolean) as string[]);
  const askedPersonas = new Set(cases.map((c) => c.persona));
  const reachable = new Set<string>();
  for (const names of subsets.values()) for (const n of names) reachable.add(n);
  return {
    shapes: [...reachable].filter((s) => !askedShapes.has(s)).sort(),
    personas: [...subsets.keys()].filter((p) => !askedPersonas.has(p)).sort(),
  };
}

// ── running ─────────────────────────────────────────────────────────────────

/** Minimal shape of a classifier, so this module does not depend on the core package. */
export interface EvalClassifier {
  readonly name: string;
  classify(req: { text: string; context: string[]; tools: ToolSpec[]; budgetMs: number; maxTokens?: number }):
    Promise<{ calls: { name: string; arguments: Record<string, unknown> }[]; confidence: number; ms: number; timedOut?: boolean; error?: string }>;
}

const sameValue = (want: unknown, got: unknown) =>
  typeof want === "number" ? Number(got) === want : String(got ?? "").trim().toLowerCase() === String(want).trim().toLowerCase();

export async function runCases(
  app: App,
  classifier: EvalClassifier,
  cases: EvalCase[],
  opts: { budgetMs?: number; maxTokens?: number; second?: EvalClassifier; onCase?: (r: CaseResult) => void } = {},
): Promise<CaseResult[]> {
  const subsets = personaShapes(app.spec);
  const all = deriveTools(app.spec);
  const budgetMs = opts.budgetMs ?? Number(app.spec.rules.classify?.budgetMs ?? 2500);
  const maxTokens = opts.maxTokens ?? (app.spec.rules.classify?.maxTokens === undefined ? undefined : Number(app.spec.rules.classify.maxTokens));
  const out: CaseResult[] = [];

  for (const c of cases) {
    const names = new Set(subsets.get(c.persona) ?? []);
    const tools = all.filter((t) => names.has(t.name));
    const req = { text: c.text, context: c.context ?? [], tools, budgetMs, maxTokens };
    const r = await classifier.classify(req);
    const got = r.calls[0]?.name ?? null;
    const args = r.calls[0]?.arguments ?? {};
    const wanted = Object.entries(c.args ?? {});
    const result: CaseResult = {
      case: c,
      got,
      args,
      confidence: Number(r.confidence ?? 0),
      ms: r.ms,
      correct: got === c.shape,
      argsOk: wanted.length ? wanted.every(([k, v]) => sameValue(v, args[k])) : undefined,
      error: r.error,
    };
    if (opts.second) {
      const s = await opts.second.classify(req);
      result.lexical = s.calls[0]?.name ?? null;
    }
    out.push(result);
    opts.onCase?.(result);
  }
  return out;
}

// ── scoring ─────────────────────────────────────────────────────────────────

export interface Score {
  n: number;
  correct: number;
  /** Cases that should have routed somewhere, and how many did so correctly. */
  positives: { n: number; correct: number };
  /** Cases where silence was the right answer, and how many stayed silent. */
  refusals: { n: number; correct: number };
  /** Of the cases demanding specific arguments, how many came back with them. */
  args: { n: number; correct: number };
  byTag: Record<string, { n: number; correct: number }>;
  medianMs: number;
  /** Set when a second classifier ran: how the two compare on routing. */
  versus?: { agree: number; onlyPrimary: number; onlySecond: number; neither: number };
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : 0);

export function score(results: CaseResult[]): Score {
  const s: Score = {
    n: results.length, correct: 0,
    positives: { n: 0, correct: 0 }, refusals: { n: 0, correct: 0 }, args: { n: 0, correct: 0 },
    byTag: {}, medianMs: Math.round(median(results.map((r) => r.ms))),
  };
  for (const r of results) {
    const tag = (s.byTag[r.case.tag] ??= { n: 0, correct: 0 });
    tag.n++;
    if (r.correct) { s.correct++; tag.correct++; }
    const bucket = r.case.shape === null ? s.refusals : s.positives;
    bucket.n++;
    if (r.correct) bucket.correct++;
    if (r.argsOk !== undefined) { s.args.n++; if (r.argsOk) s.args.correct++; }
  }
  if (results.some((r) => r.lexical !== undefined)) {
    const v = { agree: 0, onlyPrimary: 0, onlySecond: 0, neither: 0 };
    for (const r of results) {
      const a = r.correct, b = r.lexical === r.case.shape;
      if (a && b) v.agree++; else if (a) v.onlyPrimary++; else if (b) v.onlySecond++; else v.neither++;
    }
    s.versus = v;
  }
  return s;
}

// ── the floor ───────────────────────────────────────────────────────────────

export const FLOORS = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

export interface FloorRow {
  floor: number;
  /** Correct routes still admitted at this floor — the answers the visitor gets. */
  kept: number;
  /** Wrong routes still admitted — the answers the visitor should not get. */
  admitted: number;
  /** kept/rightTotal − admitted/wrongTotal: Youden's J, so the two populations count equally. */
  j: number;
}

/**
 * Sweep the floor over the labelled answers.
 *
 * Only cases where the classifier *named something* can speak to a floor, because a floor filters
 * answers rather than producing them: a silence is already a refusal and no threshold changes it. So the
 * two populations are the routes that were right and the routes that were wrong, and a floor is good
 * when it separates them — not when it maximises either alone, which is why this scores Youden's J
 * rather than a raw difference. A set with ten times as many right answers as wrong ones would otherwise
 * recommend a floor of zero every time.
 */
export function floorSweep(results: CaseResult[], floors: number[] = FLOORS): { rows: FloorRow[]; right: number; wrong: number } {
  const spoke = results.filter((r) => r.got !== null);
  const right = spoke.filter((r) => r.correct).map((r) => r.confidence);
  const wrong = spoke.filter((r) => !r.correct).map((r) => r.confidence);
  const rows = floors.map((floor) => {
    const kept = right.filter((c) => c >= floor).length;
    const admitted = wrong.filter((c) => c >= floor).length;
    const j = (right.length ? kept / right.length : 0) - (wrong.length ? admitted / wrong.length : 0);
    return { floor, kept, admitted, j };
  });
  return { rows, right: right.length, wrong: wrong.length };
}

export interface FloorAdvice { floor: number; kept: number; admitted: number; right: number; wrong: number; note: string }

export function recommendFloor(results: CaseResult[], floors: number[] = FLOORS): FloorAdvice | null {
  const { rows, right, wrong } = floorSweep(results, floors);
  if (!right) return null;
  // Ties go to the lower floor: between two thresholds that separate equally well, the one that pours
  // fewer `ask`s is the one a visitor prefers.
  const best = rows.reduce((a, b) => (b.j > a.j + 1e-9 ? b : a));
  const note = !wrong
    ? "no wrong routes in this set, so any floor separates nothing — the number below only reflects what it costs in correct answers"
    : best.j < 0.2
      ? "the two populations barely separate at any floor: this engine's confidence is not a usable gate on its own"
      : `keeps ${best.kept}/${right} correct routes and admits ${best.admitted}/${wrong} wrong ones`;
  return { floor: best.floor, kept: best.kept, admitted: best.admitted, right, wrong, note };
}

// ── a baseline to measure against ───────────────────────────────────────────

/**
 * Performance tuning is a loop, and a loop needs a fixed point.
 *
 * A single run says 27/56, which is a number with nothing to lean on: is the shallow rung better than
 * the stock one, did the upgrade help, did a trigger edit cost anything? So one run is saved as
 * `eval/baseline.json` and every later run reports the delta against it, per population — because the
 * aggregate is the least informative number in the set, and a change that gains three paraphrases while
 * losing three refusals is not a wash.
 *
 * The case digest is the safety catch. Comparing today's score against a baseline measured on a
 * different set of cases is the most comfortable way to be wrong about progress, so the digest is
 * stored and a changed set is reported rather than compared.
 */
export interface Baseline {
  at: string;
  framework: string;
  /** What was measured — the classifier's name plus whatever the operator called this configuration. */
  classifier: string;
  label?: string;
  cases: number;
  digest: string;
  score: Score;
  floor?: FloorAdvice | null;
}

export const BASELINE_FILE = join("eval", "baseline.json");
export const baselinePath = (app: App) => join(app.dir, BASELINE_FILE);

/** Identifies the set, so a baseline is never compared against different questions. */
export function caseDigest(cases: EvalCase[]): string {
  const h = createHash("sha256");
  for (const c of [...cases].sort((a, b) => (a.persona + a.text).localeCompare(b.persona + b.text))) {
    h.update(`${c.persona}\u0000${c.text}\u0000${c.shape ?? ""}\u0000${c.tag}\u0000${JSON.stringify(c.args ?? {})}\n`);
  }
  return h.digest("hex").slice(0, 16);
}

export function readBaseline(app: App): Baseline | null {
  const p = baselinePath(app);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as Baseline; } catch { return null; }
}

export function writeBaseline(app: App, b: Baseline): string {
  const p = baselinePath(app);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(b, null, 2) + "\n");
  return p;
}

export interface Delta { what: string; then: number; now: number; of: number }

/**
 * What moved, population by population.
 *
 * Returns every row, including the unchanged ones, because "nothing moved" is a result: it is what a
 * refactor is supposed to produce and what a tuning run is not.
 */
export function compare(then: Score, now: Score): Delta[] {
  const rows: Delta[] = [
    { what: "overall", then: then.correct, now: now.correct, of: now.n },
    { what: "routed", then: then.positives.correct, now: now.positives.correct, of: now.positives.n },
    { what: "refused", then: then.refusals.correct, now: now.refusals.correct, of: now.refusals.n },
  ];
  if (now.args.n || then.args.n) rows.push({ what: "arguments", then: then.args.correct, now: now.args.correct, of: now.args.n });
  for (const tag of new Set([...Object.keys(then.byTag), ...Object.keys(now.byTag)])) {
    rows.push({ what: tag, then: then.byTag[tag]?.correct ?? 0, now: now.byTag[tag]?.correct ?? 0, of: now.byTag[tag]?.n ?? then.byTag[tag]?.n ?? 0 });
  }
  return rows;
}

/** True when every answer came back with no confidence at all — a locally tuned rung, whose head is gone. */
export const headless = (results: CaseResult[]) =>
  results.some((r) => r.got !== null) && results.every((r) => !r.confidence);
