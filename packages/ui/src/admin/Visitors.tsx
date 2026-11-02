/**
 * Visitors: who has been here, each one's visits, each visit's turns, and one turn in full — what was
 * said, what it matched, what the plan read and wrote, the layout the answer carried. It is what /debug
 * showed one visitor about themselves, for every visitor, and only to an operator.
 */
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { turn as getTurn, unmet as getUnmet, visitor as getVisitor, visitors as getVisitors, type FullTurn, type Visit, type VisitorRow } from "./client";
import type { Go } from "./Admin";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const said = (u: any) => (u?.text ? `“${u.text}”` : u?.shape ? `[${u.shape}]` : u?.arrive ? "arrived" : u?.resumedFrom ? "resumed" : u?.notification ?? "");
const browser = (ua?: string | null) => (!ua ? "—" : /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /HeadlessChrome/.test(ua) ? "Headless Chrome" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : ua.split(" ")[0]);
function arrival(e: Record<string, unknown>) {
  const from = e.tool ? `tool: ${e.tool}` : e.utm_campaign ? `campaign ${e.utm_campaign}` : e.utm_source ? `from ${e.utm_source}` : e.referrer ? `from ${String(e.referrer).replace(/^https?:\/\//, "").split("/")[0]}` : "direct";
  return [from, browser(e.userAgent as string)].filter((x) => x && x !== "—").join(" · ");
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let live = true; setData(null); setError(null); load().then((d) => live && setData(d)).catch((e) => live && setError(e.message)); return () => { live = false; }; }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error };
}

const Loading = () => <Loader2 className="h-5 w-5 animate-spin text-accent" aria-label="Loading" />;
const Err = ({ text }: { text: string }) => <p role="alert" className="text-write">{text}</p>;
const Back = ({ onClick, label }: { onClick: () => void; label: string }) =>
  <button onClick={onClick} className="mb-6 inline-flex items-center gap-1 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground hover:text-accent"><ArrowLeft className="h-3 w-3" />{label}</button>;
const th = "p-3 text-left text-xs font-black uppercase tracking-widest text-muted-foreground";

export function Visitors({ parts, go }: { parts: string[]; go: Go }) {
  if (parts[0] === "turn" && parts[1]) return <Turn id={parts[1]} go={go} />;
  if (parts[0]) return <Visitor id={parts[0]} go={go} />;
  return <VisitorList go={go} />;
}

function VisitorList({ go }: { go: Go }) {
  const [tools, setTools] = useState(false);
  const [all, setAll] = useState(false);
  const [offset, setOffset] = useState(0);
  const { data, error } = useLoad(() => getVisitors({ tools, all, offset }), [tools, all, offset]);
  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-2xl font-black tracking-tight">Visitors</h1><p className="max-w-2xl text-sm text-muted-foreground">Newest first. A browser is recognised on return by a cookie and by the id it keeps; an account is one visitor on every browser it signs in on. Passers-by (arrived, did nothing) and bots are left out.</p></div>
        <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={all} onChange={(e) => { setOffset(0); setAll(e.target.checked); }} className="accent-[var(--accent)]" />include passers-by and bots</label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={tools} onChange={(e) => { setOffset(0); setTools(e.target.checked); }} className="accent-[var(--accent)]" />include tooling (headless, checks, tests)</label>
        </div>
      </div>
      {error ? <Err text={error} /> : !data ? <Loading /> : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-sm">
            <thead className="bg-card"><tr><th className={th}>Visitor</th><th className={th}>Last seen</th><th className={th}>Visits</th><th className={th}>Turns</th><th className={th}>Browser</th><th className={th} /></tr></thead>
            <tbody>
              {data.visitors.map((v: VisitorRow) => (
                <tr key={v.id} className="cursor-pointer border-t border-border hover:bg-card" onClick={() => go("visitors", v.id)}>
                  <td className="p-3 font-mono text-xs"><button className="hover:text-accent" onClick={(e) => { e.stopPropagation(); go("visitors", v.id); }}>{v.id}</button></td>
                  <td className="whitespace-nowrap p-3 text-muted-foreground">{when(v.last_seen)}</td>
                  <td className="p-3 tabular-nums">{v.trails}</td>
                  <td className="p-3 tabular-nums">{v.turns}</td>
                  <td className="p-3 text-muted-foreground">{browser(v.user_agent)}</td>
                  <td className="whitespace-nowrap p-3">
                    {v.account ? <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-black uppercase text-accent-foreground">account</span>
                      : v.customer_id ? <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-black uppercase text-accent-foreground">known</span>
                      : v.tool ? <span className="text-xs text-muted-foreground">tool</span> : null}
                    {!!v.joined && <span className="ml-2 text-xs text-muted-foreground">{v.joined + 1} browsers</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.visitors.length && <p className="p-4 text-sm text-muted-foreground">Nobody yet.</p>}
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))} className="rounded border border-border px-3 py-1.5 text-sm disabled:opacity-40">Newer</button>
        <button disabled={(data?.visitors.length ?? 0) < 50} onClick={() => setOffset(offset + 50)} className="rounded border border-border px-3 py-1.5 text-sm disabled:opacity-40">Older</button>
      </div>
    </section>
  );
}

function Visitor({ id, go }: { id: string; go: Go }) {
  const { data, error } = useLoad(() => getVisitor(id), [id]);
  return (
    <section>
      <Back onClick={() => go("visitors")} label="Visitors" />
      <h1 className="mb-1 font-mono text-lg">{id}</h1>
      {error ? <Err text={error} /> : !data ? <Loading /> : (
        <>
          <p className="mb-8 text-sm text-muted-foreground">First seen {when(data.visitor.firstSeen)} · last seen {when(data.visitor.lastSeen)} · {data.sessions.length} visits · {data.visitor.known ? "identified" : "anonymous"}</p>
          <div className="space-y-3">
            {data.sessions.map((s: Visit, i) => (
              <details key={s.id} open={i === 0} className="rounded border border-border bg-card open:border-accent/30">
                <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-4 gap-y-1 p-4 text-sm">
                  <span className="font-black">Visit {data.sessions.length - i}</span>
                  <span className="tabular-nums text-muted-foreground">{when(s.openedAt)}</span>
                  <span className="text-muted-foreground">{s.turns.length} turns</span>
                  <span className="text-muted-foreground/70">{arrival(s.envelope)}</span>
                </summary>
                <div className="overflow-x-auto border-t border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-background"><tr><th className={th}>#</th><th className={th}>At</th><th className={th}>Who</th><th className={th}>Said</th><th className={th}>Shape</th><th className={th}>Pour</th><th className={th}>Sure</th><th className={th}>ms</th></tr></thead>
                    <tbody>
                      {[...s.turns].sort((a, b) => b.seq - a.seq).map((t) => (
                        <tr key={t.id} onClick={() => go("visitors", "turn", t.id)} className={`cursor-pointer border-t border-border hover:bg-background ${t.answered ? "" : "text-write"}`}>
                          <td className="p-3 tabular-nums text-muted-foreground">{t.seq}</td>
                          <td className="whitespace-nowrap p-3 tabular-nums text-muted-foreground">{new Date(t.at).toLocaleTimeString()}</td>
                          <td className="p-3">{t.author}</td>
                          <td className="max-w-xs p-3"><button className="text-left hover:text-accent" onClick={(e) => { e.stopPropagation(); go("visitors", "turn", t.id); }}>{said(t.utterance) || "—"}</button></td>
                          <td className="p-3">{t.shape ?? "—"}</td>
                          <td className="p-3">{t.kind}</td>
                          <td className="p-3 tabular-nums">{t.confidence != null ? `${Math.round(t.confidence * 100)}%` : ""}</td>
                          <td className="p-3 tabular-nums">{t.latencyMs ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!s.turns.length && <p className="p-4 text-sm text-muted-foreground">Opened, nothing said.</p>}
                </div>
              </details>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** One turn in full: what was said, what it matched, what the plan did, and the layout the answer carried. */
function Turn({ id, go }: { id: string; go: Go }) {
  const { data, error } = useLoad(() => getTurn(id), [id]);
  const t: FullTurn | undefined = data?.turn;
  const prov = t?.provenance ?? {};
  const tree = t?.pour?.present;
  return (
    <section>
      <Back onClick={() => history.back()} label="Back" />
      {error ? <Err text={error} /> : !t ? <Loading /> : (
        <div className="space-y-8">
          <div>
            <h1 className="text-2xl font-black tracking-tight">{said(t.utterance) || t.kind}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Turn {t.seq} · {new Date(t.at).toLocaleString()} · {t.author} · <button onClick={() => go("visitors")} className="hover:text-accent">visitors</button></p>
          </div>
          <dl className="grid gap-x-6 gap-y-3 rounded border border-border bg-card p-5 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="text-muted-foreground">Understood</dt><dd>{t.shape ?? "—"} · {t.kind}{t.confidence != null ? ` · ${Math.round(t.confidence * 100)}% sure` : ""}{t.answered ? "" : <span className="text-write"> · unanswered</span>}</dd>
            <dt className="text-muted-foreground">Phrase</dt><dd>{t.pour?.phrase ?? t.pour?.text ?? "—"}</dd>
            {t.pour?.args && <><dt className="text-muted-foreground">Arguments</dt><dd className="font-mono text-xs">{JSON.stringify(t.pour.args)}</dd></>}
            <dt className="text-muted-foreground">Calls</dt><dd>{prov.calls?.length ? prov.calls.map((x: any) => `${x.call} ${x.ms}ms`).join(" → ") : "—"}</dd>
            <dt className="text-muted-foreground">Read</dt><dd>{prov.read?.join(", ") || "—"}</dd>
            {prov.wrote?.length ? <><dt className="text-muted-foreground">Wrote</dt><dd className="font-bold text-write">{prov.wrote.join(", ")}</dd></> : null}
            <dt className="text-muted-foreground">Records</dt><dd>{prov.records ?? "—"} · {t.latencyMs ?? "?"} ms</dd>
          </dl>
          {tree && (
            <div>
              <h2 className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-accent">Layout · {tree.source}</h2>
              <ol className="space-y-1.5 rounded border border-border bg-card p-5 font-mono text-xs">
                {tree.organisms.map((o: any, i: number) => (
                  <li key={i} className="flex flex-wrap gap-x-3">
                    <span className="w-20 font-bold">{o.organism}</span>
                    {o.from && <span className="text-muted-foreground">from {o.from}</span>}
                    {o.molecule && <span>{o.molecule.as ?? "card"} <span className="text-muted-foreground">({o.moleculeSource})</span></span>}
                    {o.molecule?.go && <span className="text-muted-foreground">→ {o.molecule.go.shape}</span>}
                    {o.stats && <span className="text-muted-foreground">{o.stats.length} figures</span>}
                    {o.facets && <span className="text-muted-foreground">sets {o.facets.map((f: any) => f.arg).join(", ")}</span>}
                  </li>
                ))}
              </ol>
            </div>
          )}
          <details className="rounded border border-border">
            <summary className="cursor-pointer p-4 text-sm font-semibold">The whole turn, as stored</summary>
            <pre className="max-h-[60vh] overflow-auto border-t border-border bg-muted p-4 text-xs text-muted-foreground">{JSON.stringify(t, null, 2)}</pre>
          </details>
        </div>
      )}
    </section>
  );
}

/** Questions nobody could answer: usually the first thing worth fixing. */
export function Unmet({ go }: { go: Go }) {
  const [since, setSince] = useState("7 days");
  const { data, error } = useLoad(() => getUnmet(since), [since]);
  return (
    <section>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-2xl font-black tracking-tight">Unmet</h1><p className="text-sm text-muted-foreground">What visitors asked that nothing could answer.</p></div>
        <select value={since} onChange={(e) => setSince(e.target.value)} className="rounded border border-border bg-background px-3 py-1.5 text-sm" aria-label="Since">
          {["1 day", "7 days", "30 days", "90 days"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      {error ? <Err text={error} /> : !data ? <Loading /> : !data.unmet.length ? <p className="text-muted-foreground">Nothing unanswered in the last {since}.</p> : (
        <ul className="divide-y divide-border rounded border border-border">
          {data.unmet.map((u, i) => (
            <li key={i} className="flex flex-wrap items-baseline justify-between gap-3 p-4 text-sm">
              <span className="font-semibold">“{u.asked}”</span>
              <span className="text-muted-foreground">{when(u.at)} · <button className="font-mono text-xs hover:text-accent" onClick={() => go("visitors", u.visitorId)}>{u.visitorId}</button></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
