/**
 * The spec, whole. It is the source everything else is derived from, so a save is the core's decision:
 * it must be JSON, it must validate, and it must start from the file as it stands — if someone else saved
 * since this was opened, the save is refused and their version is offered instead of being overwritten.
 * Every save keeps the version it replaced, and any of them can be loaded back into the editor.
 */
import { useEffect, useState } from "react";
import { History, Loader2, RotateCcw, Save } from "lucide-react";
import { AdminError, saveSpec, specHistory, specSource, specVersion } from "./client";

type Note = { kind: "ok" | "error" | "warn"; text: string; problems?: string[] };

export function SpecEditor() {
  const [text, setText] = useState<string | null>(null);
  const [base, setBase] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [theirs, setTheirs] = useState<{ text: string; hash: string } | null>(null);
  const [history, setHistory] = useState<string[] | null>(null);

  const load = async () => {
    const s = await specSource();
    setText(s.text); setBase(s.hash); setSaved(s.text); setTheirs(null);
  };
  useEffect(() => { load().catch((e) => setNote({ kind: "error", text: e.message })); }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (text !== null && text !== saved) e.preventDefault(); };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [text, saved]);

  const parseError = (() => { if (text === null) return null; try { JSON.parse(text); return null; } catch (e) { return (e as Error).message; } })();
  const dirty = text !== null && text !== saved;

  const save = async () => {
    if (text === null || parseError) return;
    setBusy(true); setNote(null);
    try {
      const r = await saveSpec(text, base);
      setBase(r.hash); setSaved(text); setHistory(null);
      setNote({ kind: r.migrationNeeded ? "warn" : "ok", text: `Saved — the core reloaded it as v${r.version}.${r.migrationNeeded ? " The entities changed: run `fishtea migrate` to apply them to the database." : ""}` });
    } catch (e) {
      if (e instanceof AdminError && e.status === 409) { setTheirs({ text: e.body.text, hash: e.body.hash }); setNote({ kind: "warn", text: "Someone saved the spec since you opened it. Nothing was written." }); }
      else setNote({ kind: "error", text: (e as Error).message, problems: e instanceof AdminError ? e.body.problems : undefined });
    } finally { setBusy(false); }
  };

  if (text === null) return note ? <p role="alert" className="text-write">{note.text}</p> : <Loader2 className="h-5 w-5 animate-spin text-accent" aria-label="Loading" />;
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Spec</h1>
          <p className="text-sm text-muted-foreground">spec.json, as written. The core checks every save and hot-reloads it; the version it replaces is kept.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => specHistory().then((h) => setHistory(h.history)).catch((e) => setNote({ kind: "error", text: e.message }))} className="inline-flex items-center gap-2 rounded border border-border px-4 py-2 text-sm font-semibold hover:border-accent"><History className="h-4 w-4" />History</button>
          <button onClick={() => { setText(saved); setNote(null); }} disabled={!dirty} className="inline-flex items-center gap-2 rounded border border-border px-4 py-2 text-sm font-semibold hover:border-accent disabled:opacity-40"><RotateCcw className="h-4 w-4" />Discard</button>
          <button onClick={save} disabled={!dirty || !!parseError || busy} className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-black text-accent-foreground hover:brightness-110 disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save</button>
        </div>
      </div>

      {note && (
        <div role={note.kind === "error" ? "alert" : "status"} className={`rounded border p-4 text-sm ${note.kind === "ok" ? "border-success/40 text-success" : note.kind === "warn" ? "border-warn/40 text-warn" : "border-write/40 text-write"}`}>
          <p>{note.text}</p>
          {note.problems?.length ? <ul className="mt-2 list-disc space-y-1 pl-5 font-mono text-xs">{note.problems.map((p, i) => <li key={i}>{p}</li>)}</ul> : null}
          {theirs && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => { setText(theirs.text); setBase(theirs.hash); setSaved(theirs.text); setTheirs(null); setNote({ kind: "warn", text: "Loaded their version. Your edits are gone; make them again on top of it." }); }} className="rounded border border-border px-3 py-1.5 text-xs font-semibold text-foreground">Load their version</button>
              <button onClick={() => { setBase(theirs.hash); setTheirs(null); setNote({ kind: "warn", text: "Keeping your edits. Saving now replaces their version (it goes to history)." }); }} className="rounded border border-border px-3 py-1.5 text-xs font-semibold text-foreground">Keep mine</button>
            </div>
          )}
        </div>
      )}

      {history && (
        <div className="rounded border border-border bg-card p-4">
          <h2 className="mb-2 text-xs font-black uppercase tracking-[0.2em] text-accent">Earlier versions</h2>
          {!history.length ? <p className="text-sm text-muted-foreground">None yet: the first save keeps one.</p> : (
            <ul className="max-h-48 space-y-1 overflow-auto text-sm">
              {history.map((h) => (
                <li key={h} className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs">{h.replace(/\.json$/, "")}</span>
                  <button onClick={() => specVersion(h).then((v) => { setText(v.text); setNote({ kind: "warn", text: `Loaded ${h} into the editor. Save to make it current.` }); })} className="text-xs font-semibold text-accent hover:underline">Load into editor</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <label htmlFor="spec-text" className="sr-only">spec.json</label>
      <textarea id="spec-text" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
        className="h-[70vh] w-full resize-y rounded border border-border bg-muted p-4 font-mono text-xs leading-relaxed text-foreground focus:border-accent focus:outline-none" />
      <p className={`text-xs ${parseError ? "text-write" : "text-muted-foreground"}`}>{parseError ? `Not valid JSON: ${parseError}` : dirty ? "Unsaved changes." : "No changes."}</p>
    </section>
  );
}
