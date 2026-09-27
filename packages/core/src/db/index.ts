import postgres, { type Sql } from "postgres";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type App, deriveTables, tableDDL, EMBED_DIM, snake, parseType, getEntity, q } from "@fishtea/spec";

export type Db = Sql<{}>;

export function connect(url = process.env.DATABASE_URL ?? "postgres://fishtea:fishtea@localhost:5432/fishtea"): Db {
  return postgres(url, { max: Number(process.env.FISHTEA_PG_POOL ?? 8), onnotice: () => {}, transform: undefined, prepare: true });
}

const here = new URL(".", import.meta.url).pathname;

export interface MigrationReport { created: string[]; added: string[]; dropped: string[]; refused: string[]; conversation: boolean }

/**
 * Apply the fixed conversation schema, then the business schema derived from spec.entities.
 * Additive by default (new tables, new columns). Destructive changes (columns that vanished from the
 * spec) are refused unless allowDestructive; the report lists them either way.
 */
/**
 * The fixed conversation schema, applied on its own.
 *
 * Separate from `migrate` because `migrate` runs only when the *business* entities have drifted, and
 * this has to run whatever the spec did. The framework's own tables change with the framework — a new
 * pour kind widens a CHECK, say — and an application whose entities have not moved in months would
 * otherwise never receive it, then fail on the first turn of the new kind. Idempotent and cheap, so it
 * is safe in front of anything.
 */
export async function ensureConversationSchema(db: Db): Promise<void> {
  const conv = readFileSync(join(here, "conversation.sql"), "utf8").replace(/halfvec\(3072\)/g, `halfvec(${EMBED_DIM})`);
  await db.unsafe(conv);
  await db.unsafe("CREATE SCHEMA IF NOT EXISTS business;");
}

export async function migrate(db: Db, app: App, opts: { allowDestructive?: boolean; log?: (s: string) => void } = {}): Promise<MigrationReport> {
  const log = opts.log ?? (() => {});
  const report: MigrationReport = { created: [], added: [], dropped: [], refused: [], conversation: true };
  await ensureConversationSchema(db);

  for (const table of deriveTables(app.spec)) {
    const exists = await db`SELECT 1 FROM information_schema.tables WHERE table_schema = 'business' AND table_name = ${table.name}`;
    if (!exists.length) {
      await db.unsafe(tableDDL(table));
      report.created.push(table.name);
      log(`created business.${table.name}`);
      continue;
    }
    const cols = await db<{ column_name: string }[]>`SELECT column_name FROM information_schema.columns WHERE table_schema = 'business' AND table_name = ${table.name}`;
    const have = new Set(cols.map((c) => c.column_name));
    for (const c of table.columns) {
      if (have.has(c.name)) continue;
      let ddl = `ALTER TABLE business.${q(table.name)} ADD COLUMN ${q(c.name)} ${c.type}`;
      if (c.default) ddl += ` DEFAULT ${c.default}`;
      if (!c.nullable && c.default) ddl += " NOT NULL";
      if (c.check) ddl += ` CHECK (${c.check})`;
      await db.unsafe(ddl);
      report.added.push(`${table.name}.${c.name}`);
      log(`added business.${table.name}.${c.name}`);
    }
    if (table.embed.length && !have.has("embedding")) { await db.unsafe(`ALTER TABLE business.${q(table.name)} ADD COLUMN embedding halfvec(${EMBED_DIM})`); report.added.push(`${table.name}.embedding`); }
    if (table.fts.length && !have.has("fts")) {
      await db.unsafe(`ALTER TABLE business.${q(table.name)} ADD COLUMN fts tsvector GENERATED ALWAYS AS (to_tsvector('english', ${table.fts.map((f) => `coalesce(${q(snake(f))}, '')`).join(" || ' ' || ")})) STORED`);
      report.added.push(`${table.name}.fts`);
    }
    const wanted = new Set([...table.columns.map((c) => c.name), "embedding", "fts"]);
    for (const col of have) {
      if (wanted.has(col)) continue;
      if (opts.allowDestructive) {
        await db.unsafe(`ALTER TABLE business.${q(table.name)} DROP COLUMN ${q(col)}`);
        report.dropped.push(`${table.name}.${col}`);
        log(`dropped business.${table.name}.${col}`);
      } else report.refused.push(`${table.name}.${col}`);
    }
    // indexes are idempotent
    const ddl = tableDDL(table).split("\n").filter((l) => l.startsWith("CREATE ") && l.includes("INDEX"));
    for (const stmt of ddl) await db.unsafe(stmt);
  }
  // tables that vanished from the spec
  const present = await db<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_schema = 'business'`;
  const wantedTables = new Set(deriveTables(app.spec).map((t) => t.name));
  for (const { table_name } of present) {
    if (wantedTables.has(table_name)) continue;
    if (opts.allowDestructive) { await db.unsafe(`DROP TABLE business.${q(table_name)} CASCADE`); report.dropped.push(table_name); }
    else report.refused.push(table_name);
  }
  await db`INSERT INTO fishtea.migration (section, hash, version) VALUES ('entities', ${app.hashes.entities}, ${app.spec.entities.version})
           ON CONFLICT (section) DO UPDATE SET hash = excluded.hash, version = excluded.version, applied_at = now()`;
  return report;
}

/** Has the entities section changed since the last migration? */
export async function entitiesDrift(db: Db, app: App): Promise<{ applied?: string; current: string; drifted: boolean }> {
  const rows = await db<{ hash: string }[]>`SELECT hash FROM fishtea.migration WHERE section = 'entities'`.catch(() => []);
  const applied = rows[0]?.hash;
  return { applied, current: app.hashes.entities, drifted: applied !== app.hashes.entities };
}

/** Load seed/<entity>.json files: upsert by id, camelCase keys → snake_case columns. */
export async function seed(db: Db, app: App, opts: { log?: (s: string) => void } = {}): Promise<Record<string, number>> {
  const dir = join(app.dir, "seed");
  const counts: Record<string, number> = {};
  if (!existsSync(dir)) return counts;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const entity = file.replace(/\.json$/, "");
    const ent = getEntity(app.spec, entity);
    if (!ent) { opts.log?.(`seed: no entity "${entity}" for ${file}, skipped`); continue; }
    const rows: Record<string, unknown>[] = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const table = snake(entity);
    let n = 0;
    for (const row of rows) {
      const cols: string[] = [], vals: unknown[] = [];
      for (const [field, spec] of Object.entries(ent.fields)) {
        if (!(field in row)) continue;
        const t = parseType(spec);
        cols.push(snake(field)); vals.push(row[field]);
      }
      const placeholders = cols.map((c, i) => {
        const t = parseType(ent.fields[Object.keys(ent.fields).find((f) => snake(f) === c)!]);
        const cast = t.base === "json" || t.fields ? "::jsonb" : t.array ? (t.base === "int" ? "::int[]" : "::text[]") : t.base === "money" ? "::numeric" : t.base === "number" ? "::double precision" : t.base === "int" ? "::int" : t.base === "boolean" ? "::boolean" : t.base === "date" ? "::date" : t.base === "timestamp" ? "::timestamptz" : "::text";
        return `$${i + 1}${cast}`;
      });
      const update = cols.filter((c) => c !== "id").map((c) => `${q(c)} = excluded.${q(c)}`).join(", ");
      await db.unsafe(`INSERT INTO business.${q(table)} (${cols.map(q).join(",")}) VALUES (${placeholders.join(",")}) ON CONFLICT (id) DO UPDATE SET ${update || "id = excluded.id"}`, vals as any[]);
      n++;
    }
    counts[entity] = n;
    opts.log?.(`seeded ${n} ${entity}`);
  }
  return counts;
}

/** Drop everything FishTea created. Tests only. */
export async function reset(db: Db) {
  await db.unsafe("DROP SCHEMA IF EXISTS business CASCADE; DROP SCHEMA IF EXISTS conversation CASCADE; DROP SCHEMA IF EXISTS fishtea CASCADE;");
}
