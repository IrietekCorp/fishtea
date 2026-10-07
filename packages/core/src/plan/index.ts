/**
 * The planner (BLUEPRINT §8). Input: a shape, validated args, the visitor. Output: an answer matching the
 * shape's answer schema plus provenance. Steps run in topological waves, concurrently within a wave, each
 * with a budget. A failing step fails the pour ("the ground refused the question").
 */
import { type App, type ShapeDef, topo, stepIds, answerSchema, getCall } from "@fishtea/spec";
import type { BoundCall, CallContext } from "../calls/index.ts";
import type { Db } from "../db/index.ts";

export interface Provenance {
  shape: string;
  calls: { id: string; call: string; ms: number; kind: string }[];
  read: string[];
  wrote: string[];
  at: string;
  records: number;
  ms: number;
}

export class PlanError extends Error {
  constructor(message: string, public step?: string, public call?: string) { super(message); }
}

const REF = /^\$([A-Za-z_][A-Za-z0-9_]*)((?:\.[A-Za-z0-9_]+)*)$/;

export function lookup(scope: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<any>((o, p) => (o == null ? undefined : o[p]), scope);
}

/**
 * Resolve `$ref` values in a template against a scope.
 *   "$mood"          → scope.mood
 *   "$b.tags"        → scope.b.tags
 *   "[$mood]"        → [scope.mood] (wrap a scalar into a list; drops when empty)
 *   "text $o.id"     → interpolated; "$$t.total" → "$" + value
 *   arrays/objects   → resolved element-wise
 */
export function resolve(template: unknown, scope: Record<string, unknown>): unknown {
  if (typeof template === "string") {
    const m = template.match(REF);
    if (m) return lookup(scope, m[1] + m[2]);
    const wrap = template.match(/^\[\s*\$([A-Za-z_][A-Za-z0-9_.]*)\s*\]$/);
    if (wrap) { const v = lookup(scope, wrap[1]); return v == null || v === "" ? [] : Array.isArray(v) ? v : [v]; }
    if (!template.includes("$")) return template;
    return template.replace(/\$(\$?)([A-Za-z_][A-Za-z0-9_.]*)/g, (_, dollar, path) => {
      const v = lookup(scope, path);
      const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      return (dollar ? "$" : "") + s;
    });
  }
  if (Array.isArray(template)) return template.map((t) => resolve(t, scope)).filter((v) => v !== undefined);
  if (template && typeof template === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) { const r = resolve(v, scope); if (r !== undefined) out[k] = r; }
    return out;
  }
  return template;
}

export function countRecords(answer: unknown): number {
  if (Array.isArray(answer)) return answer.length;
  if (answer && typeof answer === "object") {
    const arrays = Object.values(answer).filter(Array.isArray);
    return arrays.length ? arrays.reduce((n, a) => n + a.length, 0) : 1;
  }
  return answer == null ? 0 : 1;
}

export interface PlanInput { shapeName: string; shape: ShapeDef; args: Record<string, unknown>; visitor: { id: string; customerId?: string | null }; persona: string }

export class Planner {
  constructor(private app: App, private calls: Map<string, BoundCall>, private db: Db) {}

  async run(input: PlanInput): Promise<{ answer: unknown; provenance: Provenance }> {
    const { shape, shapeName } = input;
    const t0 = performance.now();
    const ids = stepIds(shape);
    const steps = shape.plan ?? [];
    const waves = topo(shape);
    const outputs: Record<string, unknown> = {};
    const scope: Record<string, unknown> = { ...input.args, visitor: input.visitor, persona: input.persona, now: new Date().toISOString() };
    const prov: Provenance = { shape: shapeName, calls: [], read: [], wrote: [], at: new Date().toISOString(), records: 0, ms: 0 };
    const timeoutMs = Number(this.app.spec.rules.calls?.timeoutMs ?? 250);
    const ctxBase: CallContext = { visitor: input.visitor, spec: this.app.spec, resolve: this.app.resolve, db: this.db };

    for (const wave of waves) {
      await Promise.all(wave.map(async (id) => {
        const step = steps[ids.indexOf(id)];
        const bound = this.calls.get(step.call);
        if (!bound) throw new PlanError(`unknown call ${step.call}`, id, step.call);
        const args = resolve(step.with ?? {}, { ...scope, ...outputs }) as Record<string, unknown>;
        const def = getCall(this.app.spec, step.call)!;
        const exec = async () => {
          if (def.transaction && def.impl.sql) return this.db.begin((tx) => bound.run(args, { ...ctxBase, tx: tx as unknown as Db }));
          return bound.run(args, ctxBase);
        };
        let timer: ReturnType<typeof setTimeout> | undefined;
        // a call's own timeoutMs, else the global budget (×1 for compute, ×4 for everything else)
        const limit = def.timeoutMs ?? timeoutMs * (def.kind === "compute" ? 1 : 4);
        const budget = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new PlanError(`${step.call} exceeded ${limit} ms`, id, step.call)), limit); });
        try {
          const r = await Promise.race([exec(), budget]);
          outputs[id] = r.output;
          prov.calls.push({ id, call: step.call, ms: Math.round(r.ms * 10) / 10, kind: def.kind });
          for (const t of r.read) if (!prov.read.includes(t)) prov.read.push(t);
          for (const t of r.wrote) if (!prov.wrote.includes(t)) prov.wrote.push(t);
        } catch (e) {
          if (e instanceof PlanError) throw e;
          throw new PlanError((e as Error).message, id, step.call);
        } finally { clearTimeout(timer); }
      }));
    }

    let answer: unknown;
    if (shape.assemble !== undefined) answer = resolve(shape.assemble, { ...scope, ...outputs });
    else if (ids.length === 1) answer = outputs[ids[0]];
    else answer = outputs;

    const parsed = answerSchema(shape, this.app.spec).safeParse(answer);
    if (!parsed.success) throw new PlanError(`answer does not match ${shapeName}.answer: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    prov.records = countRecords(parsed.data);
    prov.ms = Math.round((performance.now() - t0) * 10) / 10;
    return { answer: parsed.data, provenance: prov };
  }
}
