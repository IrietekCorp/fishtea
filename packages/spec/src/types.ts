/**
 * The FishTea type vocabulary (BLUEPRINT §5).
 *
 *   id string text int number money boolean enum email url timestamp date json
 *   T[]      list of T
 *   T?       optional T
 *   T=v      T with default v
 *   enum:a|b|c
 *   <entity> a reference to an entity declared in spec.entities
 *
 * Types appear as strings ("string[]?") in call/shape inputs and answers, or as
 * objects ({ "type": "enum", "values": [...] }) in entity fields. `parseType`
 * normalises both to a TypeRef.
 */

export const SCALARS = [
  "id", "string", "text", "int", "number", "money", "boolean", "enum",
  "email", "url", "timestamp", "date", "json",
] as const;
export type Scalar = (typeof SCALARS)[number];

export interface TypeRef {
  /** scalar name or entity name */
  base: string;
  array: boolean;
  optional: boolean;
  default?: unknown;
  enumValues?: string[];
  /** true when base is not a scalar (an entity reference) */
  entity: boolean;
  /** inline object type: field name → TypeRef */
  fields?: Record<string, TypeRef>;
  doc?: string;
  min?: number;
  max?: number;
}

export type TypeSpec =
  | string
  | { type: string; optional?: boolean; default?: unknown; values?: string[]; doc?: string; min?: number; max?: number }
  | { [field: string]: TypeSpec };

function parseDefault(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try { return JSON.parse(raw); } catch { /* fall through to string */ }
  }
  return raw;
}

export function parseTypeString(s: string): TypeRef {
  let rest = s.trim();
  let def: unknown = undefined;
  let hasDefault = false;
  const eq = rest.indexOf("=");
  if (eq >= 0) {
    def = parseDefault(rest.slice(eq + 1));
    hasDefault = true;
    rest = rest.slice(0, eq);
  }
  let optional = false;
  if (rest.endsWith("?")) { optional = true; rest = rest.slice(0, -1); }
  let array = false;
  if (rest.endsWith("[]")) { array = true; rest = rest.slice(0, -2); }
  let enumValues: string[] | undefined;
  if (rest.startsWith("enum:")) {
    enumValues = rest.slice(5).split("|").map((v) => v.trim()).filter(Boolean);
    rest = "enum";
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(rest)) throw new Error(`bad type "${s}"`);
  const entity = !(SCALARS as readonly string[]).includes(rest);
  const ref: TypeRef = { base: rest, array, optional: optional || hasDefault, entity };
  if (hasDefault) ref.default = def;
  if (enumValues) ref.enumValues = enumValues;
  return ref;
}

export function isInlineObject(spec: TypeSpec): spec is Record<string, TypeSpec> {
  return typeof spec === "object" && spec !== null && !("type" in spec && typeof (spec as any).type === "string");
}

export function parseType(spec: TypeSpec): TypeRef {
  if (typeof spec === "string") return parseTypeString(spec);
  if (isInlineObject(spec)) {
    const fields: Record<string, TypeRef> = {};
    for (const [k, v] of Object.entries(spec)) fields[k] = parseType(v);
    return { base: "object", array: false, optional: false, entity: false, fields };
  }
  const o = spec as { type: string; optional?: boolean; default?: unknown; values?: string[]; doc?: string; min?: number; max?: number };
  const ref = parseTypeString(o.type);
  if (o.optional) ref.optional = true;
  if (o.default !== undefined) { ref.default = o.default; ref.optional = true; }
  if (o.values) ref.enumValues = o.values;
  if (o.doc) ref.doc = o.doc;
  if (o.min !== undefined) ref.min = o.min;
  if (o.max !== undefined) ref.max = o.max;
  return ref;
}

/** JSON-Schema fragment for a TypeRef (used for classifier tool specs and forms). */
export function toJsonSchema(t: TypeRef, entities?: Record<string, { fields: Record<string, TypeSpec> }>): any {
  let inner: any;
  if (t.fields) {
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const [k, f] of Object.entries(t.fields)) {
      properties[k] = toJsonSchema(f, entities);
      if (!f.optional) required.push(k);
    }
    inner = { type: "object", properties, ...(required.length ? { required } : {}) };
  } else if (t.entity) {
    const ent = entities?.[t.base];
    if (ent) {
      const properties: Record<string, any> = {};
      for (const [k, f] of Object.entries(ent.fields)) properties[k] = toJsonSchema(parseType(f), entities);
      inner = { type: "object", properties };
    } else inner = { type: "object" };
  } else {
    switch (t.base) {
      case "int": inner = { type: "integer" }; break;
      case "number": case "money": inner = { type: "number" }; break;
      case "boolean": inner = { type: "boolean" }; break;
      case "json": inner = {}; break;
      case "enum": inner = { type: "string", ...(t.enumValues ? { enum: t.enumValues } : {}) }; break;
      case "email": inner = { type: "string", format: "email" }; break;
      case "url": inner = { type: "string", format: "uri" }; break;
      case "timestamp": inner = { type: "string", format: "date-time" }; break;
      case "date": inner = { type: "string", format: "date" }; break;
      default: inner = { type: "string" };
    }
    if (t.min !== undefined) inner.minimum = t.min;
    if (t.max !== undefined) inner.maximum = t.max;
  }
  if (t.doc) inner.description = t.doc;
  if (t.default !== undefined) inner.default = t.default;
  return t.array ? { type: "array", items: inner } : inner;
}

/** Postgres column type for an entity field. */
export function toPgType(t: TypeRef, fieldName: string): string {
  const scalar = (): string => {
    switch (t.base) {
      case "id": return "text";
      case "string": case "text": case "email": case "url": case "enum": return "text";
      case "int": return "integer";
      case "number": return "double precision";
      case "money": return "numeric(12,2)";
      case "boolean": return "boolean";
      case "timestamp": return "timestamptz";
      case "date": return "date";
      case "json": return "jsonb";
      default: return "jsonb"; // entity reference embedded
    }
  };
  if (t.array) {
    const s = scalar();
    return s === "jsonb" ? "jsonb" : `${s}[]`;
  }
  return scalar();
}

export const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
export const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
