/**
 * Everything the framework's generic UI shows inline — the understood line, confidence, the verify strip,
 * the trail — moved off the page a visitor reads and onto one they can find from the sitemap. History is
 * shown as the visitor, then their visits (sessions) newest first, each with its own turns.
 */
import { useEffect, useState } from "react";
import { health, sessions, visitorId, type History, type Response, type Session } from "@fishtea/ui/lib/client";
import { shapeOf, type Conversation } from "./useConversation";
import { labelOf } from "./site";
import spec from "@app/spec.json";
import { rowsOf, type PresentTree } from "@fishtea/present";

export function Debug({ c, vessels = {} }: { c: Conversation; vessels?: Record<string, unknown> }) {
  const [history, setHistory] = useState<History | null>(null);
  const [h, setH] = useState<any>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { sessions().then(setHistory).catch(() => setHistory({ visitor: null, sessions: [] })); health().then(setH).catch(() => {}); }, []);
  const last = c.current?.res;
  const v = history?.visitor;
  const turns = history?.sessions.reduce((n, x) => n + x.turns.length, 0) ?? 0;

  return (
    <section className="mx-auto max-w-6xl space-y-10 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-4xl font-black tracking-tighter">Debug<span className="text-accent">.</span></h1>
        <p className="mt-2 text-muted-foreground">What the engine understood, what it read and wrote, and every visit this browser has made. Browser Back returns to the conversation.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="Persona" value={last?.persona || "—"} />
        <Stat label="Core" value={h ? `${h.business} v${h.version} · ${h.classifier?.name}${h.ok ? "" : " (unhealthy)"}` : "…"} />
        <Stat label="This page" value={c.section ? `${labelOf(shapeOf(c.section.res.pour) ?? "home")} · turn ${c.section.res.turn.seq}` : "—"} />
      </div>

      {last && <LastTurn res={last} />}
      {c.section?.res.pour.kind === "answer" && <Layout pour={c.section.res.pour} vessel={c.section.res.pour.shape in vessels} />}

      <div>
        <h2 className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-accent">Visitor</h2>
        <div className="grid gap-4 rounded border border-border bg-card p-5 text-sm md:grid-cols-[2fr_1fr_1fr_1fr]">
          <Field label="Id" value={v?.id ?? visitorId() ?? "—"} mono />
          <Field label="First seen" value={v ? when(v.firstSeen) : "—"} />
          <Field label="Last seen" value={v ? when(v.lastSeen) : "—"} />
          <Field label="Visits" value={history ? `${history.sessions.length} · ${turns} turns${v?.known ? " · identified" : " · anonymous"}` : "…"} />
          <p className="text-xs text-muted-foreground/60 md:col-span-4">
            Recognised on return by the core's cookie (<code>fishtea_visitor</code>, a year, httpOnly) and by the same id kept in this
            browser's storage and sent as a header — either one is enough. A visit is a session: a new one opens after
            {" "}{gapHours()} hours without a turn, and starts where the last one left off.
          </p>
        </div>
      </div>

      <div>
        <h2 className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-accent">Sessions · newest first</h2>
        {history && !history.sessions.length && <p className="text-muted-foreground">No visits yet.</p>}
        <div className="space-y-3">
          {history?.sessions.map((s, i) => (
            <details key={s.id} open={s.current} className="group rounded border border-border bg-card open:border-accent/30">
              <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-4 gap-y-1 p-4 text-sm">
                <span className="font-black">Visit {history.sessions.length - i}{s.current && <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-black uppercase text-accent-foreground">now</span>}</span>
                <span className="tabular-nums text-muted-foreground">{when(s.openedAt)}</span>
                <span className="text-muted-foreground">{duration(s.openedAt, s.lastAt)}</span>
                <span className="text-muted-foreground">{s.turns.length} turns</span>
                <span className="text-muted-foreground/60">{arrival(s.envelope)}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground/60">{s.id}</span>
              </summary>
              <SessionTurns s={s} c={c} open={open} setOpen={setOpen} />
            </details>
          ))}
        </div>
        {open && c.log.get(open) && <pre className="mt-4 max-h-[60vh] overflow-auto rounded border border-border bg-muted p-4 text-xs text-muted-foreground">{JSON.stringify(c.log.get(open), null, 2)}</pre>}
      </div>
      <p className="text-sm text-muted-foreground/60">The operator console (<code>fishtea tui</code>) shows the same engine from the operator's side — every visitor, the unmet questions, the action log.</p>
    </section>
  );
}

function SessionTurns({ s, c, open, setOpen }: { s: Session; c: Conversation; open: string | null; setOpen: (id: string | null) => void }) {
  if (!s.turns.length) return <p className="border-t border-border p-4 text-sm text-muted-foreground">Opened, nothing said.</p>;
  return (
    <div className="overflow-x-auto border-t border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-background text-xs uppercase tracking-widest text-muted-foreground">
          <tr><th className="p-3">#</th><th className="p-3">At</th><th className="p-3">Who</th><th className="p-3">Said</th><th className="p-3">Shape</th><th className="p-3">Pour</th><th className="p-3">Sure</th><th className="p-3">ms</th><th className="p-3" /></tr>
        </thead>
        <tbody>
          {[...s.turns].sort((a, b) => b.seq - a.seq).map((t) => (
            <tr key={t.id} className={`border-t border-border align-top ${t.id === s.headTurnId ? "bg-accent/5" : ""} ${t.answered ? "" : "text-write"}`}>
              <td className="p-3 tabular-nums text-muted-foreground/60">{t.seq}</td>
              <td className="whitespace-nowrap p-3 tabular-nums text-muted-foreground/60">{new Date(t.at).toLocaleTimeString()}</td>
              <td className="p-3">{t.author}</td>
              <td className="max-w-xs p-3">{said(t.utterance)}</td>
              <td className="p-3">{t.shape ? labelOf(t.shape) : "—"}</td>
              <td className="p-3">{t.kind}</td>
              <td className="p-3 tabular-nums">{t.confidence != null ? `${Math.round(t.confidence * 100)}%` : ""}</td>
              <td className="p-3 tabular-nums">{t.latencyMs ?? ""}</td>
              <td className="p-3">{c.log.has(t.id) && <button onClick={() => setOpen(open === t.id ? null : t.id)} className="text-xs text-accent hover:underline">{open === t.id ? "hide" : "response"}</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const said = (u: any) => u?.text ? `“${u.text}”` : u?.shape ? `[${u.shape}]` : u?.arrive ? "arrived" : u?.resumedFrom ? "resumed" : u?.notification ?? "";
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
function duration(from: string, to: string) {
  const m = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000);
  return m < 1 ? "under a minute" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
/** Where a visit came from, from its arrival envelope: a campaign, a referrer, or straight in — and on what. */
function arrival(e: Record<string, unknown>) {
  const from = e.utm_campaign ? `campaign ${e.utm_campaign}` : e.utm_source ? `from ${e.utm_source}` : e.referrer ? `from ${String(e.referrer).replace(/^https?:\/\//, "").split("/")[0]}` : "direct";
  const ua = String(e.userAgent ?? "");
  const on = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : ua ? ua.split(" ")[0] : "";
  return [from, on].filter(Boolean).join(" · ");
}
const gapHours = () => Number((spec as any).rules?.trail?.sessionGapHours ?? 4);

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="min-w-0"><p className="text-xs font-black uppercase tracking-widest text-muted-foreground">{label}</p><p className={`mt-1 truncate ${mono ? "font-mono text-xs" : "font-bold"}`} title={value}>{value}</p></div>;
}

function LastTurn({ res }: { res: Response }) {
  const p: any = res.pour;
  const prov = p.provenance;
  return (
    <div>
      <h2 className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-accent">Last turn</h2>
      <div className="space-y-3 rounded border border-border bg-card p-5 text-sm">
        <p><span className="text-muted-foreground">Understood:</span> {res.understood ? <>{res.understood.phrase} <span className="text-muted-foreground">→ {res.understood.shape} · {Math.round(res.understood.confidence * 100)}% sure</span></> : <span className="text-muted-foreground">{p.kind}{p.reason ? ` (${p.reason})` : ""}</span>}</p>
        {prov && <p><span className="text-muted-foreground">Verify:</span> shape <code>{prov.shape}</code>{prov.calls?.length ? <> · calls {prov.calls.map((x: any) => `${x.call} ${x.ms}ms`).join(" → ")}</> : null}{prov.read?.length ? <> · read {prov.read.join(", ")}</> : null}{prov.wrote?.length ? <strong className="text-write"> · wrote {prov.wrote.join(", ")}</strong> : null} · {prov.records} records</p>}
        <p><span className="text-muted-foreground">Timings:</span> {res.timings.totalMs} ms (classify {res.timings.classifyMs}, plan {res.timings.planMs}) · {res.classifier}</p>
      </div>
    </div>
  );
}

/**
 * How the page on screen was laid out: the organisms of its shape, each one's part of the answer, the
 * molecule its rows use (and where that came from), what a click asks, and how many rows it drew — the
 * quickest way to see why a derived page looks the way it does, and what to declare to change it.
 */
function Layout({ pour, vessel }: { pour: Extract<Response["pour"], { kind: "answer" }>; vessel: boolean }) {
  const tree = (pour as { present?: PresentTree }).present;
  if (!tree) return null;
  const tone = (s?: string) => (s === "derived" ? "text-write" : s === "inline" ? "text-foreground" : "text-accent");
  return (
    <div>
      <h2 className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-accent">Layout · {labelOf(pour.shape)}</h2>
      <div className="space-y-3 rounded border border-border bg-card p-5 text-sm">
        <p className="text-muted-foreground">
          {vessel ? <>A hand-written vessel draws this shape; the tree below is what the UI language would draw without it.</> : <>Drawn by the UI language — </>}
          <span className={tone(tree.source)}>{tree.source}</span>{tree.source === "derived" ? " from the answer's types (declare it in rules.present.shapes to change it)" : " in rules.present"}
          {" · "}resolved by the core, sent with the answer.
        </p>
        <ol className="space-y-1.5 font-mono text-xs">
          {tree.organisms.map((o, i) => {
            const m = o.molecule;
            const rows = m || o.organism === "tags" ? rowsOf(o, pour.answer).length : undefined;
            return (
              <li key={i} className="flex flex-wrap gap-x-3">
                <span className="w-20 font-bold text-foreground">{o.organism}</span>
                {o.from && <span className="text-muted-foreground">from {o.from}</span>}
                {m && <span>{m.as ?? "card"} <span className={tone(o.moleculeSource)}>({o.moleculeSource})</span></span>}
                {m?.go && <span className="text-muted-foreground">→ {m.go.shape}</span>}
                {(m?.tags ?? []).map((t) => <span key={t.from} className="text-muted-foreground">tags {t.from}{t.go ? ` → ${t.go.shape}` : ""}</span>)}
                {o.stats && <span className="text-muted-foreground">{o.stats.length} figures</span>}
                {o.facets && <span className="text-muted-foreground">sets {o.facets.map((f) => f.arg).join(", ")}</span>}
                {rows != null && <span className="text-muted-foreground/60">{rows} rows</span>}
              </li>
            );
          })}
        </ol>
        <p className="text-xs text-muted-foreground/60"><span className="text-accent">declared</span> · <span className="text-foreground">inline</span> · <span className="text-write">derived</span> — <code>fishtea present {pour.shape} --live</code> prints the same with each slot's value.</p>
      </div>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded border border-border bg-card p-4">
      <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate ${mono ? "font-mono text-xs" : "font-bold"}`} title={value}>{value}</p>
    </div>
  );
}
