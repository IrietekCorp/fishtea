/**
 * Jobs: the application's operator shapes, run from /admin with a button.
 *
 * An operator shape (spec.operator.shapes) is already a job: it has a description, typed inputs and a
 * plan, and `fishtea tui` or a curl to /op/utter runs it. Until an application has a scheduler, someone
 * has to press go, and a person in /admin should not need a token and a terminal to do it.
 *
 * A run is started, not awaited. Filling a catalogue takes minutes, longer than a proxy in front of the
 * core lets a request wait, so POST /op/jobs/:name answers 202 at once and the page asks GET /op/jobs
 * how it went. One run per job at a time: a second press while it runs is refused (409), because two
 * syncs writing the same rows help nobody.
 *
 * Runs are kept in memory, the last one per job. A restart forgets them; the rows a job wrote are in the
 * database, and the turn-by-turn record of what happened is what a scheduler will add.
 */
import { deriveForm, type FormField } from "@fishtea/spec";
import type { Engine } from "../engine.ts";

/** Shapes the console wires itself, or that address one visitor: not jobs anyone runs on a schedule. */
const NOT_JOBS = new Set(["op.restart", "op.editSection", "op.notify"]);

export interface JobRun {
  id: string; job: string; by: string; args: Record<string, unknown>;
  status: "running" | "done" | "failed";
  startedAt: string; finishedAt: string | null; ms: number | null;
  answer?: unknown; error?: string;
}
export interface Job { name: string; asks: string; effect: string; fields: FormField[]; last: JobRun | null }

export class Jobs {
  private runs = new Map<string, JobRun>();
  private seq = 0;
  constructor(private engine: Engine) {}

  private shapes() {
    return Object.entries(this.engine.app.spec.operator?.shapes ?? {}).filter(([n]) => !NOT_JOBS.has(n));
  }

  list(): Job[] {
    return this.shapes().map(([name, s]) => ({
      name, asks: s.asks ?? name, effect: s.effect ?? "read", fields: deriveForm(s), last: this.runs.get(name) ?? null,
    }));
  }

  /** Start a run. The returned promise is the run's own, for tests and for whoever wants to wait. */
  start(name: string, args: Record<string, unknown>, by: string):
    { ok: true; run: JobRun; done: Promise<JobRun> } | { ok: false; status: 404 | 409; error: string } {
    if (!this.shapes().some(([n]) => n === name)) return { ok: false, status: 404, error: `no job ${name}` };
    if (this.runs.get(name)?.status === "running") return { ok: false, status: 409, error: `${name} is already running` };
    const t0 = performance.now();
    const run: JobRun = { id: `job_${Date.now().toString(36)}_${++this.seq}`, job: name, by, args, status: "running", startedAt: new Date().toISOString(), finishedAt: null, ms: null };
    this.runs.set(name, run);
    const finish = (patch: Partial<JobRun>) => {
      const ended: JobRun = { ...run, ...patch, finishedAt: new Date().toISOString(), ms: Math.round(performance.now() - t0) };
      // a later run may have replaced this one only after it finished; never overwrite a newer record
      if (this.runs.get(name)?.id === run.id) this.runs.set(name, ended);
      return ended;
    };
    const done = this.engine.operate(name, args).then(
      (pour: any) => pour?.kind === "answer"
        ? finish({ status: "done", answer: pour.answer ?? null })
        // invalid inputs come back as a form with the problem in it: a failure to run, not a result
        : finish({ status: "failed", error: String(pour?.error ?? pour?.hint ?? pour?.phrase ?? `the job answered ${pour?.kind}`) }),
      (e: Error) => finish({ status: "failed", error: e?.message ?? String(e) }),
    );
    return { ok: true, run, done };
  }
}
