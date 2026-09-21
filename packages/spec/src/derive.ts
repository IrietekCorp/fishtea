/**
 * Everything the loader derives from a spec (BLUEPRINT §5 "Derivations"):
 *   entities → DDL            (deriveDDL)
 *   shapes   → tool specs     (deriveTools)      classifier tool list
 *   shapes   → form fields    (deriveForm)       ask/form/confirm-write vessels
 *   answer   → vessel         (inferVessel)      deterministic, never the model
 *   answer   → zod schema     (answerSchema)     planner validates against it
 *   phrase   → understood line(renderPhrase)
 */
import { z, type ZodTypeAny } from "zod";
import { type Spec, type ShapeDef, type EntityDef, entities, shapes, operatorShapes, getEntity, type VesselName } from "./spec.ts";
import { parseType, toJsonSchema, toPgType, snake, type TypeRef, type TypeSpec } from "./types.ts";

/** Embedding width. needle3 returns 3072 floats (measured in Phase 0; the blueprint guessed 768). */
export const EMBED_DIM = Number(process.env.FISHTEA_EMBED_DIM ?? 3072);

export interface ColumnDef { name: string; field: string; type: string; nullable: boolean; check?: string; default?: string; primary: boolean }
export interface TableDef { entity: string; name: string; columns: ColumnDef[]; indexes: string[]; unique: string[]; embed: string[]; fts: string[] }

function sqlLiteral(v: unknown, pgType: string): string {
  if (v === null) return "NULL";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return pgType === "jsonb" ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `'{${v.map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(",")}}'`;
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

export function deriveTable(entityName: string, ent: EntityDef): TableDef {
  const name = snake(entityName);
  const columns: ColumnDef[] = [];
  for (const [field, spec] of Object.entries(ent.fields)) {
    const t = parseType(spec);
    const col = snake(field);
    const pg = t.fields ? "jsonb" : toPgType(t, field);
    const primary = field === "id";
    const c: ColumnDef = { name: col, field, type: pg, nullable: !primary && !!t.optional && t.default === undefined, primary };
    if (t.base === "enum" && t.enumValues?.length && !t.array) c.check = `${col} IN (${t.enumValues.map((v) => `'${v.replace(/'/g, "''")}'`).join(",")})`;
    if (t.base === "int" || t.base === "number" || t.base === "money") {
      const parts: string[] = [];
      if (t.min !== undefined) parts.push(`${col} >= ${t.min}`);
      if (t.max !== undefined) parts.push(`${col} <= ${t.max}`);
      if (parts.length) c.check = parts.join(" AND ");
    }
    if (t.default !== undefined) c.default = sqlLiteral(t.default, pg);
    else if (t.array && !t.optional) c.default = pg === "jsonb" ? "'[]'::jsonb" : "'{}'";
    else if (t.base === "timestamp" && !t.optional && (field === "createdAt" || field === "updatedAt" || field.endsWith("At"))) c.default = "now()";
    columns.push(c);
  }
  const fts = (ent.embed ?? []).filter((f) => { const t = parseType(ent.fields[f]); return !t.array && ["string", "text"].includes(t.base); });
  return { entity: entityName, name, columns, indexes: ent.index ?? [], unique: ent.unique ?? [], embed: ent.embed ?? [], fts };
}

export const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

export function tableDDL(t: TableDef): string {
  const lines = t.columns.map((c) => {
    let s = `  ${q(c.name)} ${c.type}`;
    if (c.primary) s += " PRIMARY KEY";
    else if (!c.nullable) s += " NOT NULL";
    if (c.default) s += ` DEFAULT ${c.default}`;
    if (c.check) s += ` CHECK (${c.check.replace(new RegExp(`^${c.name}\\b`), q(c.name)).replace(new RegExp(` AND ${c.name}\\b`), ` AND ${q(c.name)}`)})`;
    return s;
  });
  if (t.embed.length) lines.push(`  embedding halfvec(${EMBED_DIM})`);
  if (t.fts.length) lines.push(`  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', ${t.fts.map((f) => `coalesce(${q(snake(f))}, '')`).join(" || ' ' || ")})) STORED`);
  const tbl = `business.${q(t.name)}`;
  const out = [`CREATE TABLE IF NOT EXISTS ${tbl} (\n${lines.join(",\n")}\n);`];
  for (const ix of t.indexes) {
    const col = t.columns.find((c) => c.field === ix);
    if (!col) continue;
    const method = col.type.endsWith("[]") || col.type === "jsonb" ? "gin" : "btree";
    out.push(`CREATE INDEX IF NOT EXISTS ${q(`${t.name}_${col.name}_idx`)} ON ${tbl} USING ${method} (${q(col.name)});`);
  }
  for (const u of t.unique) {
    const col = t.columns.find((c) => c.field === u);
    if (col) out.push(`CREATE UNIQUE INDEX IF NOT EXISTS ${q(`${t.name}_${col.name}_uniq`)} ON ${tbl} (${q(col.name)});`);
  }
  if (t.fts.length) out.push(`CREATE INDEX IF NOT EXISTS ${q(`${t.name}_fts_idx`)} ON ${tbl} USING gin (fts);`);
  if (t.embed.length) out.push(`CREATE INDEX IF NOT EXISTS ${q(`${t.name}_embedding_idx`)} ON ${tbl} USING hnsw (embedding halfvec_cosine_ops);`);
  return out.join("\n");
}

export function deriveTables(spec: Spec): TableDef[] {
  return entities(spec).map(([n, e]) => deriveTable(n, e));
}

export function deriveDDL(spec: Spec): string {
  return ["CREATE EXTENSION IF NOT EXISTS vector;", "CREATE SCHEMA IF NOT EXISTS business;", ...deriveTables(spec).map(tableDDL)].join("\n\n");
}

// ── tool specs ───────────────────────────────────────────────────────────────

export interface ToolSpec { name: string; description: string; parameters: any; triggers?: string[] }

export function shapeTool(name: string, shape: ShapeDef, spec: Spec): ToolSpec {
  const ents = Object.fromEntries(entities(spec));
  const properties: Record<string, any> = {};
  const required: string[] = [];
  for (const [k, t] of Object.entries(shape.input)) {
    const ref = parseType(t);
    properties[k] = toJsonSchema(ref, ents);
    if (!ref.optional) required.push(k);
  }
  const tool: ToolSpec = { name, description: shape.asks, parameters: { type: "object", properties, ...(required.length ? { required } : {}) } };
  if (shape.triggers?.length) tool.triggers = shape.triggers;
  return tool;
}

/** Consumer tool list (operator shapes live in a separate registry, §12.5). */
export function deriveTools(spec: Spec): ToolSpec[] {
  return shapes(spec).map(([n, s]) => shapeTool(n, s, spec));
}
export function deriveOperatorTools(spec: Spec): ToolSpec[] {
  return operatorShapes(spec).map(([n, s]) => shapeTool(n, s, spec));
}

// ── forms ────────────────────────────────────────────────────────────────────

export interface FormField {
  name: string; label: string; type: string; required: boolean; array: boolean;
  default?: unknown; enumValues?: string[]; doc?: string; min?: number; max?: number;
}

const labelOf = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

export function deriveForm(shape: ShapeDef): FormField[] {
  return Object.entries(shape.input).map(([name, t]) => {
    const ref = parseType(t);
    const f: FormField = { name, label: labelOf(name), type: ref.fields ? "json" : ref.base, required: !ref.optional, array: ref.array };
    if (ref.default !== undefined) f.default = ref.default;
    if (ref.enumValues) f.enumValues = ref.enumValues;
    if (ref.doc) f.doc = ref.doc;
    if (ref.min !== undefined) f.min = ref.min;
    if (ref.max !== undefined) f.max = ref.max;
    return f;
  });
}

// ── vessels ──────────────────────────────────────────────────────────────────

function hasArrayField(ref: TypeRef, spec: Spec, depth = 0): boolean {
  if (depth > 2) return false;
  if (ref.fields) return Object.values(ref.fields).some((f) => f.array || (f.entity && hasArrayField(f, spec, depth + 1)));
  if (ref.entity) {
    const e = getEntity(spec, ref.base);
    return !!e && Object.values(e.fields).some((t) => parseType(t).array);
  }
  return false;
}

/** BLUEPRINT §10 table. Deterministic from the answer type; `vessel` on a shape overrides. */
export function inferVessel(answer: TypeSpec, spec: Spec): VesselName {
  const ref = parseType(answer);
  if (ref.array) return "list";
  if (ref.fields) {
    const keys = Object.keys(ref.fields);
    if (["left", "right", "facets"].every((k) => keys.includes(k))) return "compare";
    if (ref.fields.events && (ref.fields.events.array || ref.fields.events.base === "json")) return "timeline";
    if (keys.includes("ok") && keys.length <= 4) return "confirm";
    if (hasArrayField(ref, spec)) return "detail";
    return "card";
  }
  if (ref.entity && hasArrayField(ref, spec)) return "detail";
  return "card";
}

export function vesselFor(shape: ShapeDef, spec: Spec): VesselName {
  return shape.vessel ?? inferVessel(shape.answer, spec);
}

// ── zod ──────────────────────────────────────────────────────────────────────

function zodScalar(ref: TypeRef): ZodTypeAny {
  switch (ref.base) {
    case "int": return z.number().int();
    case "number": case "money": return z.coerce.number();
    case "boolean": return z.boolean();
    case "json": return z.any();
    case "enum": return ref.enumValues?.length ? z.enum(ref.enumValues as [string, ...string[]]) : z.string();
    case "email": return z.string().email();
    case "timestamp": case "date": return z.union([z.string(), z.date()]).transform((v) => (v instanceof Date ? v.toISOString() : v));
    default: return z.string();
  }
}

export function zodFor(t: TypeSpec, spec: Spec, opts: { lenient?: boolean } = {}, depth = 0): ZodTypeAny {
  const ref = parseType(t);
  let inner: ZodTypeAny;
  if (ref.fields) {
    const shape: Record<string, ZodTypeAny> = {};
    for (const [k, f] of Object.entries(ref.fields)) {
      const src = (t as any)[k];
      shape[k] = f.optional ? zodFor(src, spec, opts, depth + 1).nullish() : zodFor(src, spec, opts, depth + 1);
    }
    inner = z.object(shape).passthrough();
  } else if (ref.entity) {
    const e = getEntity(spec, ref.base);
    if (!e || depth > 3) inner = z.record(z.any());
    else {
      const shape: Record<string, ZodTypeAny> = {};
      for (const [k, f] of Object.entries(e.fields)) {
        const fr = parseType(f);
        const zf = zodFor(f, spec, opts, depth + 1);
        shape[k] = fr.optional || opts.lenient ? zf.nullish() : zf;
      }
      inner = z.object(shape).passthrough();
    }
  } else inner = zodScalar(ref);
  if (ref.array) inner = z.array(inner);
  return ref.optional ? inner.nullish() : inner;
}

/** Schema for a shape's validated input (server-side, before any plan runs). */
export function inputSchema(shape: ShapeDef, spec: Spec): ZodTypeAny {
  const fields: Record<string, ZodTypeAny> = {};
  for (const [k, t] of Object.entries(shape.input)) {
    const ref = parseType(t);
    let s = zodFor(t, spec);
    if (ref.default !== undefined) s = s.default(ref.default as any);
    fields[k] = s;
  }
  return z.object(fields).strip();
}

export function answerSchema(shape: ShapeDef, spec: Spec): ZodTypeAny {
  return zodFor(shape.answer, spec, { lenient: true });
}

// ── phrase ───────────────────────────────────────────────────────────────────

/**
 * "Accessories {mood? that feel $mood} {occasion? for $occasion}" →
 * conditional groups drop when their variable is empty; $var substitutes.
 */
export function renderPhrase(template: string | undefined, args: Record<string, unknown>, fallback: string): string {
  if (!template) return fallback;
  const present = (k: string) => { const v = args[k]; return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length); };
  const sub = (s: string) => s.replace(/\$([A-Za-z_][A-Za-z0-9_.]*)/g, (_, k) => { const v = k.split(".").reduce((o: any, p: string) => o?.[p], args); return v == null ? "" : Array.isArray(v) ? v.join(", ") : String(v); });
  const out = template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\?\s*([^}]*)\}/g, (_, k, body) => (present(k) ? sub(body) : ""));
  return sub(out).replace(/\s+/g, " ").trim();
}

export type { VesselName };
