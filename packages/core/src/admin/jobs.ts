/**
 * Jobs: the application's operator shapes, run from /admin with a button, or by the core on a schedule.
 *
 * An operator shape (spec.operator.shapes) is already a job: it has a description, typed inputs and a
 * plan. A run is started, not awaited: filling a catalogue takes minutes, longer than a proxy lets a request
 * wait, so POST /op/jobs/:name answers 202 at once and the page asks GET /op/jobs how it went.
 *
 * **Runs are kept in fishtea.job_run**, so the last successful answer outlives a restart and the page can
 * show it. One run of a job at a time, across every core on the database: a partial unique index refuses a
 * second `running` row, and a second press is a 409. A run a stopped core left `running` is marked
 * `interrupted` when a core starts (one core per database is what FishTea deploys).
 *
 * **The schedule** is the shape's own (`schedule` in spec.ts): `daily` times in UTC, and `afterDeploy`,
 * which runs the job once for a release that has not had a successful run of it yet. A release is the hash
 * of what decides what a job does — spec.json, calls/, seed/ and the framework's version — so a new image
 * with changed code counts and a plain restart does not. The core looks once a minute; a time missed while
 * it was down runs when it comes back. What a job wrote stays in the application's tables until the next
 * run replaces it.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { deriveForm, FISHTEA_VERSION, type FormField, type ShapeDef } from "@fishtea/spec";
import type { Engine } from "../engine.ts";
import { newId } from "../trail/index.ts";

/** Shapes the console wires itself, or that address one visitor: not jobs anyone runs on a schedule. */
const NOT_JOBS = new Set(["op.restart", "op.editSection", "op.notify"]);
const TICK_MS = 60_000;

export type Trigger = "manual" | "schedule" | "deploy";
export interface JobRun {
  id: string; job: string; by: string; trigger: Trigger; args: Record<string, unknown>;
  status: "running" | "done" | "failed" | "interrupted";
  startedAt: string; finishedAt: string | null; ms: number | null; release: string | null;
  answer?: unknown; error?: string;
}
export interface Job {
  name: string; asks: string; effect: string; fields: FormField[];
  last: JobRun | null; lastGood: JobRun | null;
  schedule: ShapeDef["schedule"] | null; next: string | null;
}

const row = (r: any): JobRun => ({
  id: r.id, job: r.job, by: r.by, trigger: r.trigger, args: r.args ?? {}, status: r.status,
  startedAt: new Date(r.started_at).toISOString(), finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
  ms: r.ms, release: r.release, ...(r.answer != null ? { answer: r.answer } : {}), ...(r.error ? { error: r.error } : {}),
});

/** What a release is, for afterDeploy: the files that decide what a job does, and the framework. */
export function releaseOf(appDir: string): string {
  const h = createHash("sha256").update(FISHTEA_VERSION);
  const add = (p: string) => {
    if (!existsSync(p)) return;
    if (statSync(p).isDirectory()) for (const f of readdirSync(p).sort()) { if (!f.startsWith(".") && f !== "node_modules") add(join(p, f)); }
    else h.update(p.slice(appDir.length)).update(readFileSync(p));
  };
  for (const p of ["spec.json", "calls", "seed"]) add(join(appDir, p));
  return h.digest("hex").slice(0, 16);
}

/** The next time, after `from`, that one of `daily` (UTC "HH:MM") comes round. */
export function nextDaily(daily: string[], from: Date): Date | null {
  const times = daily.map((t) => t.split(":").map(Number)).filter(([h, m]) => h! >= 0 && h! < 24 && m! >= 0 && m! < 60);
  let best: Date | null = null;
  for (const [h, m] of times) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), h, m));
    if (d <= from) d.setUTCDate(d.getUTCDate() + 1);
    if (!best || d < best) best = d;
  }
  return best;
}
/** The latest time, at or before `now`, that one of `daily` came round. */
export function lastDaily(daily: string[], now: Date): Date | null {
  const n = nextDaily(daily, new Date(now.getTime() - 86400e3));
  if (!n) return null;
  let last = n;
  for (let d = n; d <= now; d = nextDaily(daily, d)!) last = d;
  return last <= now ? last : null;
}

export class Jobs {
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private release: string;
  constructor(private engine: Engine, private opts: { log?: (s: string) => void } = {}) {
    this.release = releaseOf(engine.app.dir);
  }

  private shapes(): [string, ShapeDef][] {
    return Object.entries(this.engine.app.spec.operator?.shapes ?? {}).filter(([n]) => !NOT_JOBS.has(n));
  }

  async list(): Promise<Job[]> {
    const db = this.engine.db;
    const last = await db`SELECT DISTINCT ON (job) * FROM fishtea.job_run ORDER BY job, started_at DESC`;
    const good = await db`SELECT DISTINCT ON (job) * FROM fishtea.job_run WHERE status = 'done' ORDER BY job, started_at DESC`;
    const by = (rows: any[]) => new Map(rows.map((r) => [r.job, row(r)]));
    const L = by(last), G = by(good);
    return this.shapes().map(([name, s]) => ({
      name, asks: s.asks ?? name, effect: s.effect ?? "read", fields: deriveForm(s),
      last: L.get(name) ?? null, lastGood: G.get(name) ?? null,
      schedule: s.schedule ?? null, next: s.schedule?.daily?.length ? nextDaily(s.schedule.daily, new Date())?.toISOString() ?? null : null,
    }));
  }

  /** Start a run. `done` is the run's own promise, for tests and for whoever wants to wait. */
  async start(name: string, args: Record<string, unknown>, by: string, trigger: Trigger = "manual"):
    Promise<{ ok: true; run: JobRun; done: Promise<JobRun> } | { ok: false; status: 404 | 409; error: string }> {
    if (!this.shapes().some(([n]) => n === name)) return { ok: false, status: 404, error: `no job ${name}` };
    const db = this.engine.db;
    const id = `job_${Date.now().toString(36)}_${++this.seq}`;
    const inserted = await db`INSERT INTO fishtea.job_run (id, job, by, trigger, args, status, release)
      VALUES (${id}, ${name}, ${by}, ${trigger}, ${args as any}, 'running', ${this.release})
      ON CONFLICT (job) WHERE status = 'running' DO NOTHING RETURNING *`;
    if (!inserted.length) return { ok: false, status: 409, error: `${name} is already running` };
    const run = row(inserted[0]);
    const t0 = performance.now();
    const finish = async (status: "done" | "failed", answer: unknown, error: string | null): Promise<JobRun> => {
      const ms = Math.round(performance.now() - t0);
      const [r] = await db`UPDATE fishtea.job_run SET status = ${status}, finished_at = now(), ms = ${ms},
        answer = ${answer === undefined ? null : (answer as any)}, error = ${error} WHERE id = ${id} RETURNING *`;
      this.opts.log?.(`job ${name} (${trigger}) ${status} in ${Math.round(ms / 1000)} s${error ? `: ${error}` : ""}`);
      return row(r);
    };
    const done = this.engine.operate(name, args).then(
      (pour: any) => pour?.kind === "answer"
        ? finish("done", pour.answer ?? null, null)
        // invalid inputs come back as a form with the problem in it: a failure to run, not a result
        : finish("failed", null, String(pour?.error ?? pour?.hint ?? pour?.phrase ?? `the job answered ${pour?.kind}`)),
      (e: Error) => finish("failed", null, e?.message ?? String(e)),
    );
    return { ok: true, run, done };
  }

  // ── the schedule ─────────────────────────────────────────────────────────

  /** Begin looking once a minute. Runs a stopped core left behind are marked interrupted first. */
  async schedule() {
    const stale = await this.engine.db`UPDATE fishtea.job_run SET status = 'interrupted', finished_at = now() WHERE status = 'running' RETURNING job`;
    for (const r of stale) this.opts.log?.(`job ${r.job}: a run was interrupted by the last stop`);
    const scheduled = this.shapes().filter(([, s]) => s.schedule);
    if (!scheduled.length) return;
    this.opts.log?.(`jobs on a schedule: ${scheduled.map(([n, s]) => `${n} (${[...(s.schedule!.daily ?? []).map((t) => `${t} UTC`), s.schedule!.afterDeploy ? "after a deploy" : ""].filter(Boolean).join(", ")})`).join("; ")}`);
    await this.tick();
    this.timer = setInterval(() => this.tick().catch((e) => this.opts.log?.(`job schedule: ${e.message}`)), TICK_MS);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Start whatever is due: a release with no good run yet, or a daily time that passed without a run. */
  async tick(now = new Date()) {
    this.release = releaseOf(this.engine.app.dir);
    for (const [name, s] of this.shapes()) {
      const sch = s.schedule;
      if (!sch) continue;
      const args = sch.args ?? {};
      if (sch.afterDeploy) {
        const [ok] = await this.engine.db`SELECT 1 FROM fishtea.job_run WHERE job = ${name} AND release = ${this.release} AND (status IN ('done', 'running') OR (trigger = 'deploy' AND started_at > now() - interval '1 hour')) LIMIT 1`;
        if (!ok) { await this.start(name, args, "schedule", "deploy"); continue; }
      }
      if (sch.daily?.length) {
        const due = lastDaily(sch.daily, now);
        if (!due) continue;
        const [ran] = await this.engine.db`SELECT 1 FROM fishtea.job_run WHERE job = ${name} AND started_at >= ${due} LIMIT 1`;
        if (!ran) await this.start(name, args, "schedule", "schedule");
      }
    }
  }
}
