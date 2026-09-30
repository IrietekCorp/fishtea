/**
 * Settings: the values in `rules` an operator may reasonably change without opening the spec — a reply
 * window, a session gap, the site's copy — and each plugin's configuration. The list comes from the core,
 * read off the spec as it stands; a save sends only what changed, and the core validates the whole spec
 * before it writes anything.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { AdminError, saveSettings, settings as getSettings, type Setting } from "./client";

const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
const groupTitle = (g: string) => g.replace(/^rules\./, "").replace(/^plugins\./, "plugin · ").split(".").map(humanize).join(" · ");

export function Settings() {
  const [list, setList] = useState<Setting[] | null>(null);
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string; problems?: string[] } | null>(null);
  useEffect(() => { getSettings().then((r) => setList(r.settings)).catch((e) => setNote({ ok: false, text: e.message })); }, []);

  const groups = useMemo(() => {
    const m = new Map<string, Setting[]>();
    for (const s of list ?? []) m.set(s.group, [...(m.get(s.group) ?? []), s]);
    return [...m];
  }, [list]);
  const changed = Object.entries(edits).filter(([id, v]) => list?.find((s) => s.id === id)?.value !== v);

  const save = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await saveSettings(changed.map(([id, value]) => ({ id, value })));
      setList(r.settings); setEdits({});
      setNote({ ok: true, text: `Saved ${changed.length} setting${changed.length === 1 ? "" : "s"}; the core reloaded the spec${r.sections.includes("plugins") ? " and the site's stylesheet" : ""}.` });
    } catch (e) { setNote({ ok: false, text: (e as Error).message, problems: e instanceof AdminError ? e.body.problems : undefined }); }
    finally { setBusy(false); }
  };

  if (!list) return note ? <p role="alert" className="text-write">{note.text}</p> : <Loader2 className="h-5 w-5 animate-spin text-accent" aria-label="Loading" />;
  return (
    <section className="max-w-3xl">
      <div className="sticky top-14 z-20 -mx-4 mb-6 flex flex-wrap items-end justify-between gap-4 bg-background/95 px-4 py-3 backdrop-blur-sm">
        <div><h1 className="text-2xl font-black tracking-tight">Settings</h1><p className="text-sm text-muted-foreground">Values from the spec's rules, and each plugin's configuration. Structure — the layout, the menu — is in the spec editor.</p></div>
        <button onClick={save} disabled={!changed.length || busy} className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-black text-accent-foreground hover:brightness-110 disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save{changed.length ? ` ${changed.length}` : ""}</button>
      </div>
      {note && (
        <div role={note.ok ? "status" : "alert"} className={`mb-6 rounded border p-4 text-sm ${note.ok ? "border-success/40 text-success" : "border-write/40 text-write"}`}>
          <p>{note.text}</p>
          {note.problems?.length ? <ul className="mt-2 list-disc pl-5 font-mono text-xs">{note.problems.map((p, i) => <li key={i}>{p}</li>)}</ul> : null}
        </div>
      )}
      <div className="space-y-8">
        {groups.map(([g, items]) => (
          <fieldset key={g} className="rounded border border-border bg-card p-5">
            <legend className="px-1 text-xs font-black uppercase tracking-[0.2em] text-accent">{groupTitle(g)}</legend>
            <div className="space-y-4">
              {items.map((s) => {
                const value = s.id in edits ? edits[s.id] : s.value;
                const set = (v: unknown) => setEdits((e) => ({ ...e, [s.id]: v }));
                const id = `set-${s.id}`;
                const cls = "w-full rounded border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none";
                return (
                  <div key={s.id} className="grid gap-1.5 sm:grid-cols-[14rem_1fr] sm:items-start sm:gap-4">
                    <label htmlFor={id} className="pt-2 text-sm font-semibold">{s.section === "rules" ? humanize(s.label) : s.label}<span className="block font-mono text-[10px] font-normal text-muted-foreground">{s.id}</span></label>
                    {s.type === "boolean" ? <input id={id} type="checkbox" checked={!!value} onChange={(e) => set(e.target.checked)} className="mt-3 h-4 w-4 accent-[var(--accent)]" />
                      : s.type === "enum" ? <select id={id} value={String(value ?? "")} onChange={(e) => set(e.target.value)} className={cls}>{s.values?.map((v) => <option key={v}>{v}</option>)}</select>
                      : s.type === "number" ? <input id={id} type="number" step="any" value={String(value ?? "")} onChange={(e) => set(e.target.value === "" ? "" : Number(e.target.value))} className={cls} />
                      : s.type === "text" ? <textarea id={id} rows={3} value={String(value ?? "")} onChange={(e) => set(e.target.value)} className={cls} />
                      : <input id={id} value={String(value ?? "")} onChange={(e) => set(e.target.value)} className={cls} />}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    </section>
  );
}
