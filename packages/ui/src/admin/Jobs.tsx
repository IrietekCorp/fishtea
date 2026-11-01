/**
 * Jobs: the application's operator shapes (spec.operator.shapes), each with a Run button, for the work
 * that has to happen on a schedule before there is a scheduler — filling a catalogue, importing sales.
 * The inputs are the shape's own, filled with their defaults. A job that writes asks once more before it
 * runs. A run carries on in the core after the button returns; this page asks how it went until it ends.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Play, XCircle } from "lucide-react";
import { jobs as getJobs, runJob, type Job, type JobRun } from "./client";

type Draft = Record<string, unknown>;
const cls = "w-full rounded border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none";

/** What a field's input holds, as the form shows it: arrays as comma-separated text. */
const shown = (f: Job["fields"][number]) => f.default === undefined ? "" : f.array && Array.isArray(f.default) ? f.default.join(", ") : f.default;

/** The draft as the shape's arguments: empty optional fields left out, numbers and lists typed. */
function argsOf(job: Job, draft: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of job.fields) {
    const v = f.name in draft ? draft[f.name] : shown(f);
    if (v === "" || v === undefined || v === null) continue;
    if (f.array) out[f.name] = String(v).split(",").map((s) => s.trim()).filter(Boolean).map((s) => (f.type === "int" || f.type === "number" ? Number(s) : s));
    else if (f.type === "int" || f.type === "number" || f.type === "money") out[f.name] = Number(v);
    else out[f.name] = v;
  }
  return out;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const took = (ms: number | null) => ms == null ? "" : ms < 1000 ? `${ms} ms` : ms < 120_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`;

export function Jobs() {
  const [list, setList] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => getJobs().then((r) => { setList(r.jobs); setError(null); }).catch((e) => setError(e.message)), []);
  useEffect(() => { refresh(); }, [refresh]);
  const running = list?.some((j) => j.last?.status === "running");
  useEffect(() => { if (!running) return; const t = setInterval(refresh, 3000); return () => clearInterval(t); }, [running, refresh]);

  if (!list) return error ? <p role="alert" className="text-write">{error}</p> : <Loader2 className="h-5 w-5 animate-spin text-accent" aria-label="Loading" />;
  return (
    <section className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-black tracking-tight">Jobs</h1>
        <p className="text-sm text-muted-foreground">The operator shapes in this application's spec. A run carries on in the core when you leave this page. Every run is kept, so the last good answer is here after a restart; a job with a schedule in the spec also runs by itself.</p>
      </div>
      {error && <p role="alert" className="mb-4 text-sm text-write">{error}</p>}
      {!list.length && <p className="text-sm text-muted-foreground">This application declares no operator shapes.</p>}
      <div className="space-y-6">{list.map((j) => <JobCard key={j.name} job={j} onChange={refresh} />)}</div>
    </section>
  );
}

function JobCard({ job, onChange }: { job: Job; onChange: () => void }) {
  const [draft, setDraft] = useState<Draft>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = job.last;
  const isRunning = run?.status === "running";

  const start = async () => {
    if (job.effect === "write" && !confirming) return setConfirming(true);
    setConfirming(false); setBusy(true); setError(null);
    try { await runJob(job.name, argsOf(job, draft)); onChange(); }
    catch (e) { setError((e as Error).message); onChange(); }
    finally { setBusy(false); }
  };

  return (
    <article className="rounded border border-border bg-card p-5">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-mono text-sm font-black">{job.name}</h2>
          <p className="text-sm text-muted-foreground">{job.asks}</p>
          {job.schedule && <p className="mt-1 text-xs text-muted-foreground">{scheduleText(job)}</p>}
        </div>
        <span className={`rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${job.effect === "write" ? "bg-write/15 text-write" : "bg-muted text-muted-foreground"}`}>{job.effect === "write" ? "writes" : "reads"}</span>
      </header>

      {job.fields.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          {job.fields.map((f) => {
            const id = `job-${job.name}-${f.name}`;
            const value = f.name in draft ? draft[f.name] : shown(f);
            const set = (v: unknown) => setDraft((d) => ({ ...d, [f.name]: v }));
            return (
              <div key={f.name} className="space-y-1">
                <label htmlFor={id} className="text-xs font-semibold">{f.label}{f.required ? "" : <span className="font-normal text-muted-foreground"> (optional)</span>}</label>
                {f.type === "boolean" ? <input id={id} type="checkbox" checked={!!value} onChange={(e) => set(e.target.checked)} className="block h-4 w-4 accent-[var(--accent)]" />
                  : f.enumValues ? <select id={id} value={String(value ?? "")} onChange={(e) => set(e.target.value)} className={cls}><option value="">—</option>{f.enumValues.map((v) => <option key={v}>{v}</option>)}</select>
                  : <input id={id} inputMode={!f.array && (f.type === "int" || f.type === "number") ? "decimal" : undefined} value={String(value ?? "")} onChange={(e) => set(e.target.value)} placeholder={f.array ? "comma, separated" : undefined} className={cls} />}
                {f.doc && <p className="text-[11px] text-muted-foreground">{f.doc}</p>}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={start} disabled={busy || isRunning}
          className={`inline-flex items-center gap-2 rounded px-4 py-2 text-sm font-black hover:brightness-110 disabled:opacity-40 ${confirming ? "bg-write text-white" : "bg-accent text-accent-foreground"}`}>
          {busy || isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {isRunning ? "Running…" : confirming ? "Run it: this writes" : "Run"}
        </button>
        {confirming && <button onClick={() => setConfirming(false)} className="text-sm text-muted-foreground hover:text-foreground">Cancel</button>}
        {error && <p role="alert" className="text-sm text-write">{error}</p>}
      </div>

      {run && <LastRun run={run} />}
      {run && run.status !== "done" && run.status !== "running" && job.lastGood && (
        <details className="mt-3 text-sm"><summary className="cursor-pointer text-xs font-semibold text-muted-foreground">The last good run, still in use</summary><LastRun run={job.lastGood} /></details>
      )}
    </article>
  );
}

function LastRun({ run }: { run: JobRun }) {
  const icon = run.status === "running" ? <Loader2 className="h-4 w-4 animate-spin text-accent" />
    : run.status === "done" ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-write" />;
  return (
    <div className="mt-4 border-t border-border pt-4 text-sm" aria-live="polite">
      <p className="flex flex-wrap items-center gap-2">
        {icon}
        <b>{run.status === "running" ? "Running" : run.status === "done" ? "Finished" : run.status === "interrupted" ? "Interrupted by a restart" : "Failed"}</b>
        <span className="text-muted-foreground">started {when(run.startedAt)} {run.trigger === "deploy" ? "after a deploy" : run.trigger === "schedule" ? "on schedule" : `by ${run.by}`}{run.ms != null ? `, took ${took(run.ms)}` : ""}</span>
      </p>
      {run.error && <p className="mt-2 font-mono text-xs text-write">{run.error}</p>}
      {run.answer !== undefined && run.answer !== null && (
        <details className="mt-2" open>
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">What it answered</summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded bg-background p-3 font-mono text-xs">{JSON.stringify(run.answer, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

/** "Daily at 05:00 UTC and after each deploy · next 2 Nov, 05:00" */
function scheduleText(job: Job): string {
  const s = job.schedule!;
  const parts = [s.daily?.length ? `daily at ${s.daily.join(", ")} UTC` : "", s.afterDeploy ? "after each deploy" : ""].filter(Boolean);
  const text = parts.join(" and ");
  return `Runs ${text}${job.next ? ` · next ${when(job.next)}` : ""}`;
}
