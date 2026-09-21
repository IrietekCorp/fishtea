/** Everything the console shows about one application, refreshed on a timer or on demand. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadApp, SpecError, type App, shapes as specShapes, entities as specEntities, calls as specCalls } from "@fishtea/spec";
import { connect, entitiesDrift, type Db } from "@fishtea/core";
import { Core, poolHealth, type Health } from "./core.ts";

export interface Snapshot {
  app: App | null;
  specError: string | null;
  health: Health | null;
  pool: any | null;
  db: { ok: boolean; turns: number; unmet: number; visitors: number; drifted: boolean; error?: string };
  counts: { entities: number; calls: number; shapes: number };
  at: number;
}

export const EMPTY: Snapshot = { app: null, specError: null, health: null, pool: null, db: { ok: false, turns: 0, unmet: 0, visitors: 0, drifted: false }, counts: { entities: 0, calls: 0, shapes: 0 }, at: 0 };

let db: Db | null = null;
export function database(): Db | null {
  if (db) return db;
  try { db = connect(process.env.DATABASE_URL); return db; } catch { return null; }
}
export async function closeDatabase() { try { await db?.end(); } catch {} db = null; }

export async function snapshot(dir: string, core: Core): Promise<Snapshot> {
  let app: App | null = null, specError: string | null = null;
  try { app = loadApp(dir); } catch (e) { specError = e instanceof SpecError ? e.problems.join("\n") : (e as Error).message; }
  const [health, pool] = await Promise.all([core.health(), poolHealth(process.env.CLASSIFIER_URL ?? "http://localhost:8081")]);
  const stats = { ok: false, turns: 0, unmet: 0, visitors: 0, drifted: false } as Snapshot["db"];
  const d = database();
  if (d) {
    try {
      const [[t], [u], [v]] = await Promise.all([
        d.unsafe("SELECT count(*)::int AS n FROM conversation.turn"),
        d.unsafe("SELECT count(*)::int AS n FROM conversation.unmet"),
        d.unsafe("SELECT count(*)::int AS n FROM conversation.visitor"),
      ]);
      stats.ok = true; stats.turns = t.n; stats.unmet = u.n; stats.visitors = v.n;
      if (app) stats.drifted = (await entitiesDrift(d, app)).drifted;
    } catch (e) { stats.error = (e as Error).message.split("\n")[0]; }
  } else stats.error = "DATABASE_URL not set";
  return {
    app, specError, health, pool, db: stats,
    counts: app ? { entities: specEntities(app.spec).length, calls: specCalls(app.spec).length, shapes: specShapes(app.spec).length } : { entities: 0, calls: 0, shapes: 0 },
    at: Date.now(),
  };
}

export function appMeta(dir: string): { template?: string; home?: string } {
  const p = join(dir, "package.json");
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")).fishtea ?? {}; } catch { return {}; }
}
