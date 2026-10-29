/**
 * `fishtea tune` — a classifier for *this* application, derived from its own spec.
 *
 * Everything else in the classifier story slides along a fixed curve: the token cap trades tail latency
 * for a truncated answer, a shallower rung trades accuracy for speed, persona subsets trade nothing but
 * buy accuracy only because there is less to be wrong about. Measured on the stock model, the whole
 * ladder is one line — L20 182 ms at 16/24, L14 145 at 14/24, L8 78 at 8/24 — and no gate on the shallow
 * rung's own confidence recovers the difference (contract.md, Phase 5).
 *
 * Fine-tuning a rung on one application's tools is the only thing that moves the line instead. The
 * vendor's claim is that a two-layer subnetwork tuned on one product's tools "runs optimally"; the first
 * evidence here agrees, in that an 8-layer rung tuned for two steps on twenty-one rows answered 7 of 9,
 * two of them held out, in 49–88 ms against the stock model's 182.
 *
 * What makes this FishTea's to do rather than the operator's is that the corpus writes itself. A spec
 * already declares every shape's name, what it asks, the words that trigger it, every argument with a
 * sentence of prose about where its value comes from, and which personas may ask — and the seed holds
 * real ids, categories, tags and brands to put in the arguments. Then the trail accumulates the real
 * thing: what visitors actually said and which shape it turned out to be, with confirmed writes as the
 * strongest labels in the system, because the visitor was shown what would happen and said yes.
 *
 * Two things this does not do, both measured rather than assumed:
 *
 *   - **It does not train.** `needle finetune` is JAX on CPU here at roughly two minutes a step, so a
 *     thousand-example run is a day. Training belongs on a GPU or on Cactus's hosted service, not in
 *     `fishtea up`.
 *   - **It does not solve confidence.** A locally tuned model loses its confidence head — the toolchain
 *     says so and the built model confirms it, returning `confidence: None` on every answer, which
 *     FishTea reads as 0 and pours `ask` for. Either the hosted service trains the head with the model,
 *     or the floor stops reading the model's opinion of itself. See docs/TUNING.md.
 *
 * So this command's job is the corpus and the bookkeeping: derive it, say how good it looks, and know
 * when the spec has moved out from under a model that was trained on it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deriveTools, type App, type ToolSpec } from "@fishtea/spec";

/** One line of `needle finetune`'s JSONL: the prompt it will see, and the answer it should give. */
export interface TuneExample {
  query: string;
  tools: ToolSpec[];
  answers: { name: string; arguments: Record<string, unknown> }[];
  system: string;
  /** Where each example came from, so a corpus can be audited and weighted. Stripped before training. */
  source: "trigger" | "intent" | "argument" | "trail" | "unmet" | "off-topic";
}

export interface Corpus {
  examples: TuneExample[];
  /** The spec sections a tuned model depends on. If these move, the model is stale. */
  hashes: { shapes: string; personas: string };
  counts: Record<string, number>;
}

/** The same system line the pool binds its agents with, so training sees the prompt inference will. */
export const TUNE_SYSTEM =
  "You route what a visitor says to one of the store's tools. Prior turns may be listed; the last line is what the visitor said now.";

/**
 * Off-topic queries, which teach the model to answer with nothing.
 *
 * Needle already does this well — "what's the weather in Lagos" comes back as an empty call list at 0.94
 * — and it is the behaviour most easily trained away by a corpus of nothing but positives. These are
 * deliberately not about any archetype's domain.
 */
const OFF_TOPIC = [
  "what's the weather in Lagos", "tell me a joke", "who is the prime minister",
  "how tall is the eiffel tower", "what's 17 times 4", "translate good morning into Dutch",
  "is it going to rain tomorrow", "what year did the Berlin wall come down",
  "recommend a film for tonight", "how do I change a tyre",
];

/** Shapes a classifier is allowed to be given: the same filter `deriveTools` applies. */
const classifiable = (spec: App["spec"]) =>
  Object.entries(spec.shapes as Record<string, any>).filter(
    ([name, s]) => name !== "version" && name !== "doc" && s && typeof s === "object" && s.classify !== false,
  );

/**
 * One tool subset per persona, which is what a worker is bound to and therefore what the model must be
 * good at. Training against the whole tool list would teach a prompt that never occurs at inference.
 */
export function personaSubsets(spec: App["spec"]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const personas = Object.keys((spec.personas ?? {}) as Record<string, unknown>).filter((p) => p !== "version");
  for (const persona of personas) {
    const names = classifiable(spec)
      .filter(([, s]) => !Array.isArray(s.allow) || s.allow.includes(persona))
      .map(([name]) => name);
    if (names.length) out.set(persona, names);
  }
  // Two personas with the same subset are one subset; the pool binds by subset, not by persona.
  const seen = new Map<string, string>();
  for (const [persona, names] of [...out]) {
    const key = [...names].sort().join("\u0000");
    if (seen.has(key)) out.delete(persona);
    else seen.set(key, persona);
  }
  return out;
}

/** Real values to put in arguments: ids per entity, and the vocabularies the catalogue actually uses. */
export function seedValues(app: App): { ids: Record<string, string[]>; words: Record<string, string[]> } {
  const ids: Record<string, string[]> = {};
  const words: Record<string, string[]> = {};
  const dir = join(app.dir, "seed");
  if (!existsSync(dir)) return { ids, words };
  for (const [entity] of Object.entries(app.spec.entities as Record<string, any>)) {
    const file = join(dir, `${entity}.json`);
    if (!existsSync(file)) continue;
    let rows: any[];
    try { rows = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
    if (!Array.isArray(rows) || !rows.length) continue;
    ids[entity] = rows.map((r) => r?.id).filter((v): v is string => typeof v === "string").slice(0, 40);
    // Any short scalar field, or a string array, is vocabulary the visitor might say back at us —
    // but keyed by *entity* and field, because `name` on a product is a product's name and has no
    // business being offered as a person's. ("my email is Baroque Pearl Drop Earrings" is what the
    // global version produced.)
    for (const row of rows.slice(0, 40)) {
      for (const [field, value] of Object.entries(row ?? {})) {
        const push = (v: unknown) => {
          if (typeof v === "string" && v.length > 1 && v.length <= 40) (words[`${entity}.${field}`] ??= []).push(v);
        };
        if (Array.isArray(value)) value.slice(0, 6).forEach(push);
        else push(value);
      }
    }
  }
  for (const k of Object.keys(words)) words[k] = [...new Set(words[k])].slice(0, 24);
  return { ids, words };
}

/** Which entity an `id` argument points at. The spec does not say, so the name does, then the answer. */
function entityFor(field: string, shape: any, entities: string[]): string | undefined {
  const bare = field.replace(/Id$/, "").toLowerCase();
  const byName = entities.find((e) => e.toLowerCase() === bare);
  if (byName) return byName;
  const answer = String(shape?.answer ?? "").replace(/\[\]$/, "");
  return entities.includes(answer) ? answer : undefined;
}

const typeOf = (t: unknown): string => (typeof t === "string" ? t : String((t as any)?.type ?? "string"));
const required = (input: Record<string, unknown>): string[] =>
  Object.entries(input).filter(([, t]) => !/[?]|=/.test(typeOf(t))).map(([k]) => k);

/** A deterministic pick, so two runs of the same spec give the same corpus and the same hash. */
const pick = <T,>(xs: T[], n: number): T | undefined => (xs.length ? xs[n % xs.length] : undefined);

/**
 * Turn one shape into queries. Everything here comes from what the spec already declares — the triggers
 * are the phrases the author said people use, and the arguments are filled from the seed, so the model
 * learns to lift a real id out of a real sentence rather than to echo a placeholder.
 */
function examplesFor(
  shape: string, def: any, tools: ToolSpec[], seed: ReturnType<typeof seedValues>, entities: string[], perShape: number,
): TuneExample[] {
  const out: TuneExample[] = [];
  const input = (def.input ?? {}) as Record<string, unknown>;
  const req = required(input);
  const triggers: string[] = (def.triggers ?? []).map(String);
  const add = (query: string, args: Record<string, unknown>, source: TuneExample["source"]) =>
    out.push({ query, tools, answers: [{ name: shape, arguments: args }], system: TUNE_SYSTEM, source });

  // The trigger on its own. When the shape needs nothing, that is the whole call; when it needs
  // arguments the utterance did not carry, naming the shape with none of them is *also* right, because
  // the engine's answer to a missing required argument is to pour a form asking for it (`missingRequired`
  // in engine.ts). "check out" must reach `checkout` so the form can collect the address — teaching the
  // model to say nothing instead would lose the turn. So the two behaviours are trained separately: a
  // bare trigger names the shape, a trigger carrying a value fills it.
  for (const t of triggers.slice(0, perShape)) add(t, {}, req.length ? "intent" : "trigger");

  // The trigger with a real value, which is the case that actually matters: "add p_coral_hoops to my
  // cart" has to come back with the id, not with the word "add".
  let n = 0;
  for (const t of triggers) {
    for (const field of req) {
      const kind = typeOf(input[field]);
      let value: unknown;
      if (kind.startsWith("enum:")) value = pick(kind.slice(5).split("|"), n);
      else if (kind === "id") value = pick(seed.ids[entityFor(field, def, entities) ?? ""] ?? [], n);
      else if (kind === "email") value = "jo@example.com";
      else if (kind === "int" || kind === "money") value = [2, 7, 30, 60][n % 4];
      if (value === undefined) continue;
      const args = Object.fromEntries(req.map((f) => [f, f === field ? value : undefined]).filter(([, v]) => v !== undefined));
      if (Object.keys(args).length !== req.length) continue;      // a partial fill, which is neither behaviour
      add(`${t} ${value}`, args, "argument");
      n++;
      if (n >= perShape) break;
    }
    if (n >= perShape) break;
  }

  // Optional fields whose values are catalogue words: "show me earrings", "looking for bold". Only for
  // a shape that requires nothing, or this emits the one case that is neither behaviour — an optional
  // argument filled while a required one is missing, which teaches the model to drop what it extracted.
  // The vocabulary comes from the entity this shape answers with, so a product's words stay products'.
  const answerEntity = String(def.answer ?? "").replace(/\[\]$/, "");
  let m = 0;
  if (!req.length && entities.includes(answerEntity)) {
    for (const [field, t] of Object.entries(input)) {
      if (!/[?]/.test(typeOf(t)) || m >= perShape) continue;
      const vocab = seed.words[`${answerEntity}.${field}`]
        ?? seed.words[`${answerEntity}.${field}s`]
        ?? seed.words[`${answerEntity}.${field.replace(/s$/, "")}`]
        ?? [];
      for (const trigger of triggers.slice(0, 2)) {
        const value = pick(vocab, m);
        if (value === undefined || m >= perShape) break;
        add(`${trigger} ${value}`, { [field]: value }, "argument");
        m++;
      }
    }
  }
  return out;
}

/** The corpus: the spec's own vocabulary, the seed's real values, and whatever the trail has learned. */
export function deriveCorpus(
  app: App,
  opts: { perShape?: number; trail?: { text: string; shape: string; persona: string | null }[]; unmet?: string[] } = {},
): Corpus {
  const perShape = Math.max(1, opts.perShape ?? 4);
  const subsets = personaSubsets(app.spec);
  const seed = seedValues(app);
  const entities = Object.keys(app.spec.entities as Record<string, unknown>);
  const allTools = deriveTools(app.spec);
  const toolsFor = (names: string[]) => allTools.filter((t) => names.includes(t.name));
  const examples: TuneExample[] = [];

  for (const [, names] of subsets) {
    const tools = toolsFor(names);
    if (!tools.length) continue;
    for (const [shape, def] of classifiable(app.spec)) {
      if (!names.includes(shape)) continue;
      examples.push(...examplesFor(shape, def, tools, seed, entities, perShape));
    }
    // Refusals, against each subset, because "nothing here answers that" is subset-relative.
    for (const q of OFF_TOPIC.slice(0, Math.max(2, Math.round(tools.length / 2)))) {
      examples.push({ query: q, tools, answers: [], system: TUNE_SYSTEM, source: "off-topic" });
    }
    // What visitors really said. A persona's own turns would be better still; the trail records the
    // persona on the turn, so when it matches we train it against that persona's subset alone.
    for (const row of opts.trail ?? []) {
      if (!names.includes(row.shape)) continue;
      if (row.persona && subsets.has(row.persona) && row.persona !== [...subsets.keys()].find((p) => subsets.get(p) === names)) continue;
      examples.push({ query: row.text, tools, answers: [{ name: row.shape, arguments: {} }], system: TUNE_SYSTEM, source: "trail" });
    }
    // Questions nobody could answer are labelled negatives, and the honest kind: real sentences a real
    // visitor typed at this business that genuinely have no shape.
    for (const q of (opts.unmet ?? []).slice(0, 50)) {
      examples.push({ query: q, tools, answers: [], system: TUNE_SYSTEM, source: "unmet" });
    }
  }

  const counts: Record<string, number> = {};
  for (const e of examples) counts[e.source] = (counts[e.source] ?? 0) + 1;
  return { examples, hashes: { shapes: app.hashes.shapes, personas: app.hashes.personas }, counts };
}

/** Where a tuned model and its provenance live, beside everything else derived for an application. */
export const tuneDir = (app: App) => join(app.dir, ".fishtea", "tune");

export interface TuneManifest {
  /** The spec this corpus was derived from. A model trained on it is stale when these stop matching. */
  hashes: { shapes: string; personas: string };
  at: string;
  examples: number;
  counts: Record<string, number>;
  corpus: string;
  /** Set once something has actually been trained from this corpus. */
  model?: { path: string; layers: number; at: string; confidence: "head" | "none" };
}

export function writeCorpus(app: App, corpus: Corpus): { corpus: string; manifest: string } {
  const dir = tuneDir(app);
  mkdirSync(dir, { recursive: true });
  const corpusPath = join(dir, "corpus.jsonl");
  // `source` is ours, not needle's: strip it so the file is exactly what `needle finetune` reads.
  writeFileSync(corpusPath, corpus.examples.map(({ source: _s, ...row }) => JSON.stringify(row)).join("\n") + "\n");
  const manifestPath = join(dir, "manifest.json");
  const existing = readManifest(app);
  const manifest: TuneManifest = {
    hashes: corpus.hashes,
    at: new Date().toISOString(),
    examples: corpus.examples.length,
    counts: corpus.counts,
    corpus: "corpus.jsonl",
    ...(existing?.model ? { model: existing.model } : {}),
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return { corpus: corpusPath, manifest: manifestPath };
}

export function readManifest(app: App): TuneManifest | undefined {
  const p = join(tuneDir(app), "manifest.json");
  if (!existsSync(p)) return undefined;
  try { return JSON.parse(readFileSync(p, "utf8")) as TuneManifest; } catch { return undefined; }
}

/**
 * Is a tuned model still about this spec?
 *
 * Only two sections matter. `shapes` is what the tools are derived from, so any change to a name, an
 * `asks`, a trigger or an argument changes the prompt the model was trained against. `personas` decides
 * which subsets exist, and a subset is what a worker binds. Everything else — a call's SQL, a layout, a
 * notification — can change all it likes without making a model wrong.
 */
export function staleness(app: App, manifest = readManifest(app)): { state: "none" | "fresh" | "stale"; moved: string[] } {
  if (!manifest) return { state: "none", moved: [] };
  const moved = (["shapes", "personas"] as const).filter((k) => manifest.hashes[k] !== app.hashes[k]);
  return { state: moved.length ? "stale" : "fresh", moved };
}

/** A short digest of a corpus, so two runs can be compared without diffing thousands of lines. */
export const corpusDigest = (c: Corpus) =>
  createHash("sha256").update(c.examples.map((e) => `${e.query}\u0000${JSON.stringify(e.answers)}`).join("\n")).digest("hex").slice(0, 16);
