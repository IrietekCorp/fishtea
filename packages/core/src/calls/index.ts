/**
 * Call executors (BLUEPRINT §8): sql (prepared, parameters only), compute (module default export),
 * external (fetch with allowlist + timeout). Bound once from the spec; each returns typed output
 * plus the tables it touched, for provenance.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type App, type CallDef, calls as specCalls, parseType, camel, snake, type TypeRef } from "@fishtea/spec";
import type { Db } from "../db/index.ts";

export interface CallContext { visitor: { id: string; customerId?: string | null }; spec: App["spec"]; resolve: (p: string) => string; db: Db; tx?: Db }
export interface CallResult { output: unknown; read: string[]; wrote: string[]; ms: number }
export interface BoundCall {
  name: string;
  def: CallDef;
  read: string[];
  wrote: string[];
  run(input: Record<string, unknown>, ctx: CallContext): Promise<CallResult>;
}

const TABLE = /\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+(business|conversation)\.("?[a-z_]+"?)/gi;
const WRITE = /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(business|conversation)\.("?[a-z_]+"?)/gi;

export function tablesIn(sql: string): { read: string[]; wrote: string[] } {
  const all = new Set<string>(), wrote = new Set<string>();
  for (const m of sql.matchAll(TABLE)) all.add(`${m[1]}.${m[2].replace(/"/g, "")}`);
  for (const m of sql.matchAll(WRITE)) wrote.add(`${m[1]}.${m[2].replace(/"/g, "")}`);
  return { read: [...all].filter((t) => !wrote.has(t)), wrote: [...wrote] };
}

function coerceParam(v: unknown, t: TypeRef): unknown {
  if (v === undefined) return null;
  if (v === null) return null;
  // postgres.js JSON-encodes values bound to jsonb placeholders itself; never pre-stringify
  if (t.fields || t.base === "json" || (t.entity && !t.array)) return typeof v === "string" ? tryParse(v) : v;
  if (t.array) {
    const arr = Array.isArray(v) ? v : [v];
    if (t.entity) return arr;
    return arr.map((x) => (t.base === "int" || t.base === "number" || t.base === "money" ? Number(x) : String(x)));
  }
  if (t.base === "int") return Math.trunc(Number(v));
  if (t.base === "number" || t.base === "money") return Number(v);
  if (t.base === "boolean") return typeof v === "string" ? v === "true" : Boolean(v);
  return typeof v === "object" ? JSON.stringify(v) : String(v);
}

const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return s; } };
const DROP_COLS = new Set(["fts", "embedding"]);

export function camelRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (DROP_COLS.has(k)) continue;
    out[camel(k)] = v;
  }
  return out;
}

function shapeOutput(rows: Record<string, unknown>[], out: TypeRef, name: string): unknown {
  const mapped = rows.map(camelRow);
  if (out.array) return mapped;
  if (!mapped.length) {
    if (out.optional) return null;
    throw new Error(`${name} returned no row`);
  }
  const row = mapped[0];
  // scalar-object answers with a single column named like the type ("count") stay as objects
  return row;
}

export function bindCalls(app: App, opts: { allowHosts?: string[] } = {}): Map<string, BoundCall> {
  const bound = new Map<string, BoundCall>();
  for (const [name, def] of specCalls(app.spec)) {
    const inputs = Object.entries(def.in).map(([k, t]) => [k, parseType(t)] as const);
    const out = parseType(def.out);
    if (def.impl.sql) {
      const text = readFileSync(join(app.dir, "calls", def.impl.sql), "utf8");
      const { read, wrote } = tablesIn(text);
      bound.set(name, {
        name, def, read, wrote,
        async run(input, ctx) {
          const t0 = performance.now();
          const params = inputs.map(([k, t]) => coerceParam(input[k] ?? t.default, t));
          const db = ctx.tx ?? ctx.db;
          const rows = (await db.unsafe(text, params as any[])) as unknown as Record<string, unknown>[];
          return { output: shapeOutput(rows, out, name), read, wrote, ms: performance.now() - t0 };
        },
      });
    } else if (def.impl.module) {
      const rel = def.impl.module.startsWith("calls/") ? def.impl.module : join("calls", def.impl.module);
      const path = join(app.dir, rel);
      let fn: ((input: any, ctx: any) => unknown) | undefined;
      bound.set(name, {
        name, def, read: [], wrote: [],
        async run(input, ctx) {
          const t0 = performance.now();
          if (!fn) { const mod = await import(path); fn = mod.default ?? mod[camel(name.replace(".", "_"))]; if (typeof fn !== "function") throw new Error(`${path} has no default export`); }
          const withDefaults: Record<string, unknown> = {};
          for (const [k, t] of inputs) withDefaults[k] = input[k] ?? t.default ?? null;
          const output = await fn(withDefaults, { spec: ctx.spec, resolve: ctx.resolve, visitor: ctx.visitor });
          return { output, read: [], wrote: [], ms: performance.now() - t0 };
        },
      });
    } else if (def.impl.url) {
      const url = new URL(def.impl.url);
      const allow = opts.allowHosts ?? (process.env.FISHTEA_EXTERNAL_HOSTS ?? "").split(",").filter(Boolean);
      bound.set(name, {
        name, def, read: [`external:${url.host}`], wrote: [],
        async run(input, ctx) {
          const t0 = performance.now();
          if (!allow.includes(url.host)) throw new Error(`external host ${url.host} not in FISHTEA_EXTERNAL_HOSTS allowlist`);
          const timeout = Number(ctx.spec.rules.calls?.timeoutMs ?? 250) * 4;
          const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(timeout) });
          if (!res.ok) throw new Error(`${name}: ${res.status}`);
          return { output: await res.json(), read: [`external:${url.host}`], wrote: [], ms: performance.now() - t0 };
        },
      });
    }
  }
  return bound;
}

export { snake };
