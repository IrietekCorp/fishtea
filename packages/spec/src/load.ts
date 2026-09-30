import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import schema from "../schema/spec.schema.json" with { type: "json" };
import { type Spec, entities, calls, shapes, personas, notifications, operatorShapes, getShape, getCall, getEntity, type ShapeDef } from "./spec.ts";
import { parseType, SCALARS, type TypeSpec, isInlineObject } from "./types.ts";
import { check as checkPresent, type SpecLike } from "./present.ts";
import { sectionHashes } from "./version.ts";
import { mergePlugins, type ResolvedPlugin } from "./plugin.ts";
import { frameworkHome, resolvePlugins } from "./plugin-resolve.ts";

/**
 * Where a call's SQL or module actually lives. An application's own calls are relative to its `calls/`
 * directory; a plugin's are rewritten to absolute paths when the plugin is merged, so both the validator
 * and the executor can find them without either knowing that plugins exist.
 */
export function callFile(appDir: string, rel: string, kind: "sql" | "module"): string {
  if (rel.startsWith("/")) return rel;
  if (kind === "sql") return join(appDir, "calls", rel);
  return join(appDir, rel.startsWith("calls/") ? rel : join("calls", rel));
}

export class SpecError extends Error {
  constructor(public problems: string[]) {
    super(`invalid spec:\n  - ${problems.join("\n  - ")}`);
  }
}

/** An application directory: spec.json plus calls/, seed/, rules/. */
export interface App {
  dir: string;
  specPath: string;
  /** the spec as loaded: the application's own, with every enabled plugin's contribution merged in */
  spec: Spec;
  hashes: Record<string, string>;
  /** resolve a path declared in the spec (impl.sql, impl.module, rules.tax.table) */
  resolve(rel: string): string;
  /** plugins this application asked for, resolved and read */
  plugins: ResolvedPlugin[];
  /** "calls.charge" → the plugin that contributed it; empty for anything the application declared itself */
  provenance: Record<string, string>;
  /** non-fatal plugin notes, e.g. a contribution the application overrode */
  pluginWarnings: string[];
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(schema as any);

/** Find the spec file for a path that may be an app dir, a spec.json, or a *.spec.json. */
export function resolveSpecPath(target: string): string {
  const p = resolve(target);
  if (existsSync(p) && statSync(p).isDirectory()) {
    const inDir = join(p, "spec.json");
    if (existsSync(inDir)) return inDir;
    throw new Error(`${p} has no spec.json`);
  }
  if (!existsSync(p)) throw new Error(`${p} does not exist`);
  return p;
}

export function loadApp(target: string, opts: { fishteaHome?: string } = {}): App {
  const specPath = resolveSpecPath(target);
  const dir = dirname(specPath);
  const raw = JSON.parse(readFileSync(specPath, "utf8"));

  // Plugins are merged *before* validation, so a contributed call is checked exactly as strictly as one
  // the application wrote itself — the same SQL parameter and file-existence rules, no exemption.
  const plugins = resolvePlugins(raw, dir, opts.fishteaHome ?? frameworkHome());
  const { spec: merged, provenance, warnings } = mergePlugins(raw, plugins);

  const spec = validateSpec(merged, { dir });
  return {
    dir,
    specPath,
    spec,
    hashes: sectionHashes(spec as any),
    resolve: (rel) => (rel.startsWith("/") ? rel : join(dir, rel)),
    plugins,
    provenance,
    pluginWarnings: warnings,
  };
}

/** Parse + validate + freeze. Throws SpecError listing every problem found. */
export function validateSpec(raw: unknown, opts: { dir?: string } = {}): Spec {
  const problems: string[] = [];
  if (!validateSchema(raw)) {
    for (const e of validateSchema.errors ?? []) problems.push(`${e.instancePath || "/"} ${e.message}${e.params && "allowedValues" in e.params ? " " + JSON.stringify(e.params.allowedValues) : ""}`);
    throw new SpecError(problems);
  }
  const spec = raw as Spec;
  structural(spec, opts.dir, problems);
  problems.push(...checkPresent(spec as unknown as SpecLike));
  if (problems.length) throw new SpecError(problems);
  return deepFreeze(spec);
}

function typeProblems(where: string, t: TypeSpec, spec: Spec, problems: string[], allowEntity = true) {
  try {
    const ref = parseType(t);
    if (ref.fields) {
      for (const [k, f] of Object.entries(ref.fields)) typeProblems(`${where}.${k}`, isInlineObject(t) ? (t as any)[k] : f.base, spec, problems, allowEntity);
      return;
    }
    if (ref.base === "object") return;
    if (ref.entity) {
      if (!allowEntity) problems.push(`${where}: entity type "${ref.base}" not allowed here`);
      else if (!getEntity(spec, ref.base)) problems.push(`${where}: unknown type or entity "${ref.base}"`);
    }
    if (ref.base === "enum" && !ref.enumValues?.length) problems.push(`${where}: enum without values`);
  } catch (e) {
    problems.push(`${where}: ${(e as Error).message}`);
  }
}

function structural(spec: Spec, dir: string | undefined, problems: string[]) {
  const personaNames = new Set(personas(spec).map(([n]) => n));
  personaNames.add("operator");
  if (!personaNames.has("stranger")) problems.push(`personas: a "stranger" persona (when: "true") is required`);

  for (const [name, ent] of entities(spec)) {
    if (!("id" in ent.fields)) problems.push(`entities.${name}: needs an "id" field`);
    for (const [f, t] of Object.entries(ent.fields)) typeProblems(`entities.${name}.fields.${f}`, t, spec, problems);
    for (const f of ent.index ?? []) if (!(f in ent.fields)) problems.push(`entities.${name}.index: unknown field "${f}"`);
    for (const f of ent.embed ?? []) if (!(f in ent.fields)) problems.push(`entities.${name}.embed: unknown field "${f}"`);
  }

  for (const [name, call] of calls(spec)) {
    for (const [f, t] of Object.entries(call.in)) typeProblems(`calls.${name}.in.${f}`, t, spec, problems);
    typeProblems(`calls.${name}.out`, call.out, spec, problems);
    const impl = call.impl;
    const kinds = ["sql", "module", "url"].filter((k) => (impl as any)[k]);
    if (kinds.length !== 1) problems.push(`calls.${name}.impl: exactly one of sql|module|url required`);
    if ((call.kind === "query" || call.kind === "mutation") && !impl.sql) problems.push(`calls.${name}: ${call.kind} calls need impl.sql`);
    if (call.kind === "compute" && !impl.module) problems.push(`calls.${name}: compute calls need impl.module`);
    if (call.kind === "external" && !impl.url) problems.push(`calls.${name}: external calls need impl.url`);
    if (impl.sql && dir) {
      const p = callFile(dir, impl.sql, "sql");
      if (!existsSync(p)) problems.push(`calls.${name}.impl.sql: ${p} not found`);
      else {
        const text = readFileSync(p, "utf8");
        if (/\$\{|\{\{|<%|--\s*interp/i.test(text)) problems.push(`calls.${name}.impl.sql: ${impl.sql} contains string-interpolation markers; use $1..$n parameters only`);
        const params = Object.keys(call.in);
        const used = new Set([...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
        for (const n of used) if (n < 1 || n > params.length) problems.push(`calls.${name}.impl.sql: $${n} exceeds declared inputs (${params.length})`);
      }
    }
    if (impl.module && dir) {
      const p = callFile(dir, impl.module, "module");
      if (!existsSync(p)) problems.push(`calls.${name}.impl.module: ${p} not found`);
    }
    if (impl.url && !/^https?:\/\//.test(impl.url)) problems.push(`calls.${name}.impl.url must be absolute http(s)`);
  }

  const allShapes: [string, ShapeDef, string][] = [
    ...shapes(spec).map(([n, s]) => [n, s, "shapes"] as [string, ShapeDef, string]),
    ...operatorShapes(spec).map(([n, s]) => [n, s, "operator.shapes"] as [string, ShapeDef, string]),
  ];
  for (const [name, shape, where] of allShapes) {
    const at = `${where}.${name}`;
    for (const [f, t] of Object.entries(shape.input)) typeProblems(`${at}.input.${f}`, t, spec, problems);
    typeProblems(`${at}.answer`, shape.answer, spec, problems);
    for (const p of shape.allow) if (!personaNames.has(p)) problems.push(`${at}.allow: unknown persona "${p}"`);
    if (where === "operator.shapes" && !shape.allow.includes("operator")) problems.push(`${at}: operator shapes must allow "operator"`);
    if (where === "shapes" && shape.allow.includes("operator")) problems.push(`${at}: consumer shapes may not allow "operator"`);
    for (const n of shape.next ?? []) if (!getShape(spec, n.shape)) problems.push(`${at}.next: unknown shape "${n.shape}"`);

    // A composite is planned part by part, so every part has to be plannable, readable and reachable by
    // whoever asked. Catching this here rather than at runtime matters: a composed write would be a
    // write with no confirm-write in front of it, and a composed shape the persona cannot ask would be
    // the gate bypassed by composition.
    for (const c of shape.compose ?? []) {
      const composed = getShape(spec, c);
      if (!composed) { problems.push(`${at}.compose: unknown shape "${c}"`); continue; }
      if (c === name) { problems.push(`${at}.compose: a shape cannot compose itself`); continue; }
      if (composed.effect === "write") problems.push(`${at}.compose: "${c}" is a write — a write pours confirm-write on its own and is never a part`);
      if (composed.compose?.length) problems.push(`${at}.compose: "${c}" composes as well; composition is one level deep on purpose`);
      const missing = shape.allow.filter((p) => !composed.allow.includes(p));
      if (missing.length) problems.push(`${at}.compose: "${c}" is not allowed for ${missing.join(", ")}, who may ask ${name} — a part must never widen who can see what`);
    }
    if (shape.plan) planProblems(at, shape, spec, problems);
    else if (!name.startsWith("op.")) problems.push(`${at}: shape has no plan`);
  }

  for (const [state, g] of Object.entries(spec.envelope.greeting)) {
    if (!personaNames.has(state)) problems.push(`envelope.greeting.${state}: unknown persona`);
    if (!g.resume && !g.shape) problems.push(`envelope.greeting.${state}: needs "shape" or "resume": true`);
    if (g.shape && !getShape(spec, g.shape)) problems.push(`envelope.greeting.${state}: unknown shape "${g.shape}"`);
    for (const o of g.offer ?? []) if (!getShape(spec, o)) problems.push(`envelope.greeting.${state}.offer: unknown shape "${o}"`);
  }
  for (const p of personaNames) if (p !== "operator" && !spec.envelope.greeting[p]) problems.push(`envelope.greeting: no greeting for persona "${p}"`);

  for (const [name, n] of notifications(spec)) for (const nx of n.next ?? []) if (!getShape(spec, nx.shape)) problems.push(`notifications.${name}.next: unknown shape "${nx.shape}"`);

  const tax = (spec.rules as any).tax;
  if (tax?.table && dir && !existsSync(join(dir, "rules", tax.table))) problems.push(`rules.tax.table: ${join(dir, "rules", tax.table)} not found`);
}

export function stepIds(shape: ShapeDef): string[] {
  return (shape.plan ?? []).map((s, i) => s.id ?? `s${i}`);
}

/** Collect "$id.path" references in a value tree → set of step ids referenced. */
export function referencedSteps(value: unknown, ids: Set<string>): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      for (const m of v.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)(?=\.|\b)/g)) if (ids.has(m[1])) out.add(m[1]);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  return out;
}

export function planDeps(shape: ShapeDef): Map<string, Set<string>> {
  const ids = stepIds(shape);
  const idSet = new Set(ids);
  const deps = new Map<string, Set<string>>();
  (shape.plan ?? []).forEach((step, i) => {
    const id = ids[i];
    const d = new Set<string>(step.after ?? []);
    for (const r of referencedSteps(step.with ?? {}, idSet)) if (r !== id) d.add(r);
    deps.set(id, d);
  });
  return deps;
}

/** Topological order of plan steps; throws on cycle or unknown dependency. */
export function topo(shape: ShapeDef): string[][] {
  const deps = planDeps(shape);
  for (const [id, d] of deps) for (const x of d) if (!deps.has(x)) throw new Error(`step "${id}" depends on unknown step "${x}"`);
  const done = new Set<string>();
  const waves: string[][] = [];
  while (done.size < deps.size) {
    const wave = [...deps].filter(([id, d]) => !done.has(id) && [...d].every((x) => done.has(x))).map(([id]) => id);
    if (!wave.length) throw new Error(`plan has a dependency cycle among: ${[...deps.keys()].filter((k) => !done.has(k)).join(", ")}`);
    wave.forEach((id) => done.add(id));
    waves.push(wave);
  }
  return waves;
}

function planProblems(at: string, shape: ShapeDef, spec: Spec, problems: string[]) {
  const ids = stepIds(shape);
  if (new Set(ids).size !== ids.length) problems.push(`${at}.plan: duplicate step ids`);
  for (const step of shape.plan ?? []) {
    const call = getCall(spec, step.call);
    if (!call) { problems.push(`${at}.plan: unknown call "${step.call}"`); continue; }
    for (const k of Object.keys(step.with ?? {})) if (!(k in call.in)) problems.push(`${at}.plan[${step.id ?? step.call}].with: "${k}" is not an input of ${step.call}`);
    if (shape.effect === "read" && call.kind === "mutation") problems.push(`${at}: read shape runs mutation ${step.call}`);
  }
  try { topo(shape); } catch (e) { problems.push(`${at}.plan: ${(e as Error).message}`); }
  if (!shape.assemble && (shape.plan ?? []).length > 1) problems.push(`${at}: multi-step plan needs "assemble"`);
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as any)) deepFreeze(v);
  }
  return o;
}

export { SCALARS, basename };
