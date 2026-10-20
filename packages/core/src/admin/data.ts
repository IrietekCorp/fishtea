/**
 * /admin → Data: the rows of the entities a spec opens to its operators (`entities.<name>.admin`), read
 * and edited by field, each value checked against the type the spec gives it. Only those entities, only
 * their declared fields, and never the id once a row has one: the spec says what an operator may touch,
 * the same way it says what a visitor may ask.
 *
 * A seeded row is partly the seed's: the next seed (every boot) puts back the fields its seed file gives,
 * and leaves the others alone. Each row says which fields those are (`$seeded`), so an edit that will not
 * last is not a surprise.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveTable, entities, parseType, snake, camel, type App, type EntityAdmin, type TypeRef } from "@fishtea/spec";
import type { Db } from "../db/index.ts";

export interface DataField { name: string; type: string; array: boolean; optional: boolean; values?: string[]; doc?: string }
export interface DataEntity {
  name: string; doc?: string; title: string; columns: string[]; order: string; collect?: string;
  fields: DataField[]; count: number;
}

const TITLES = ["name", "title", "label", "question", "value"];

/** The entities this spec opens to operators, with how /admin lists them. */
export function openEntities(app: App): { name: string; doc?: string; admin: Required<Omit<EntityAdmin, "collect">> & { collect?: string }; types: Record<string, TypeRef>; filled: Set<string> }[] {
  return entities(app.spec).filter(([, e]) => !!e.admin).map(([name, e]) => {
    const a: EntityAdmin = e.admin === true ? {} : e.admin!;
    const types = Object.fromEntries(Object.entries(e.fields).map(([f, t]) => [f, parseType(t)]));
    const title = a.title ?? TITLES.find((f) => f in types) ?? "id";
    // the fields the database fills when a row leaves them out (a default, a createdAt)
    const filled = new Set(deriveTable(name, e).columns.filter((c) => c.default).map((c) => c.field));
    return {
      name, doc: e.doc, types, filled,
      admin: { title, columns: a.columns ?? [title], order: a.order ?? ("order" in types ? "order" : "id"), collect: a.collect },
    };
  });
}

const fieldOf = (name: string, t: TypeRef): DataField => ({ name, type: t.fields ? "json" : t.base, array: t.array, optional: t.optional || t.default !== undefined, values: t.enumValues, doc: t.doc });
const table = (entity: string) => `business.${snake(entity)}`;

export class DataError extends Error {}

/** One value, as its type says it is stored; "" is no value, for a field that may have none. */
function coerce(field: string, t: TypeRef, v: unknown, db: Db): unknown {
  const none = v === null || v === undefined || v === "";
  if (none) {
    if (t.optional || t.default !== undefined) return null;
    if (t.array) return db.array([]);
    throw new DataError(`${field}: needs a value`);
  }
  if (t.fields || t.base === "json") {
    if (typeof v === "string") { try { return db.json(JSON.parse(v)); } catch { throw new DataError(`${field}: not JSON`); } }
    return db.json(v as any);
  }
  if (t.array) {
    const list = Array.isArray(v) ? v : String(v).split(/\n|,/).map((s) => s.trim()).filter(Boolean);
    return db.array(list.map((x) => coerce(field, { ...t, array: false, optional: false }, x, db)) as any[]);
  }
  switch (t.base) {
    case "int": case "number": case "money": {
      const n = Number(v);
      if (!Number.isFinite(n) || (t.base === "int" && !Number.isInteger(n))) throw new DataError(`${field}: a number`);
      if ((t.min !== undefined && n < t.min) || (t.max !== undefined && n > t.max)) throw new DataError(`${field}: out of range`);
      return n;
    }
    case "boolean":
      if (typeof v === "boolean") return v;
      if (v === "true" || v === "false") return v === "true";
      throw new DataError(`${field}: true or false`);
    case "enum":
      if (!t.enumValues?.includes(String(v))) throw new DataError(`${field}: one of ${t.enumValues?.join(", ")}`);
      return String(v);
    case "date": {
      const s = String(v).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new DataError(`${field}: a date, YYYY-MM-DD`);
      return s;
    }
    case "timestamp": {
      const d = new Date(String(v));
      if (Number.isNaN(d.getTime())) throw new DataError(`${field}: a date and time`);
      return d.toISOString();
    }
    case "email":
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) throw new DataError(`${field}: an email address`);
      return String(v);
    case "url":
      // an uploaded picture is kept as a data: URL; anything else must be a web address
      if (!/^(https?:\/\/|\/(?!\/)|data:image\/(png|jpeg|webp);base64,)/.test(String(v))) throw new DataError(`${field}: a URL`);
      return String(v);
    default:
      if (typeof v !== "string" && typeof v !== "number") throw new DataError(`${field}: text`);
      if (String(v).length > 400_000) throw new DataError(`${field}: too long`);
      return String(v);
  }
}

const out = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== "fts" && k !== "embedding").map(([k, v]) => [camel(k), v]));

export class Data {
  constructor(private db: Db, private app: () => App) {}

  private entity(name: string) {
    const e = openEntities(this.app()).find((x) => x.name === name);
    if (!e) throw new DataError(`no entity "${name}" is open to operators`);
    return e;
  }

  /** the rows in the entity's seed file, by id: the fields of each that the next seed puts back */
  private seeded(name: string): Map<string, string[]> {
    const file = join(this.app().dir, "seed", `${name}.json`);
    try {
      const rows = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
      return new Map((Array.isArray(rows) ? rows : []).map((r: any) => [String(r.id), Object.keys(r).filter((k) => k !== "id")]));
    } catch { return new Map(); }
  }

  async list(): Promise<DataEntity[]> {
    const outList: DataEntity[] = [];
    for (const e of openEntities(this.app())) {
      const [{ n }] = await this.db`SELECT count(*)::int AS n FROM ${this.db(table(e.name))}`;
      outList.push({ name: e.name, doc: e.doc, ...e.admin, fields: Object.entries(e.types).map(([f, t]) => fieldOf(f, t)), count: n });
    }
    return outList;
  }

  async rows(name: string, o: { limit?: number; offset?: number } = {}) {
    const e = this.entity(name);
    const limit = Math.max(1, Math.min(500, o.limit ?? 200)), offset = Math.max(0, o.offset ?? 0);
    const by = this.db(snake(e.admin.order));
    const rows = await this.db`SELECT * FROM ${this.db(table(name))} ORDER BY ${by} DESC NULLS LAST, "id" LIMIT ${limit} OFFSET ${offset}`;
    const seeded = this.seeded(name);
    return rows.map((r) => ({ ...out(r), $seeded: seeded.get(String(r.id)) ?? [] }));
  }

  async get(name: string, id: string) {
    this.entity(name);
    const [r] = await this.db`SELECT * FROM ${this.db(table(name))} WHERE "id" = ${id}`;
    return r ? { ...out(r), $seeded: this.seeded(name).get(id) ?? [] } : null;
  }

  private values(name: string, patch: Record<string, unknown>) {
    const e = this.entity(name);
    const set: Record<string, unknown> = {};
    for (const [f, v] of Object.entries(patch)) {
      if (f === "id" || f.startsWith("$")) continue;
      const t = e.types[f];
      if (!t) throw new DataError(`${f}: not a field of ${name}`);
      set[snake(f)] = coerce(f, t, v, this.db);
    }
    return set;
  }

  async update(name: string, id: string, patch: Record<string, unknown>) {
    const set = this.values(name, patch);
    if (!Object.keys(set).length) return this.get(name, id);
    const r = await this.db`UPDATE ${this.db(table(name))} SET ${this.db(set)} WHERE "id" = ${id} RETURNING "id"`;
    if (!r.length) throw new DataError(`no ${name} "${id}"`);
    return this.get(name, id);
  }

  async create(name: string, row: Record<string, unknown>) {
    const e = this.entity(name);
    const set = this.values(name, row);
    for (const [f, t] of Object.entries(e.types)) if (f !== "id" && !(snake(f) in set) && !t.optional && !e.filled.has(f)) throw new DataError(`${f}: needs a value`);
    const id = typeof row.id === "string" && /^[\w.-]{1,80}$/.test(row.id) ? row.id : `${snake(name).slice(0, 3)}_${randomBytes(6).toString("hex")}`;
    await this.db`INSERT INTO ${this.db(table(name))} ${this.db({ id, ...set })}`;
    return this.get(name, id);
  }

  async remove(name: string, id: string) {
    this.entity(name);
    const r = await this.db`DELETE FROM ${this.db(table(name))} WHERE "id" = ${id} RETURNING "id"`;
    return { ok: r.length > 0 };
  }
}
