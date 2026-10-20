/**
 * Data: the rows of the entities the spec opens to operators (`entities.<name>.admin`) — a list per
 * entity, and a form per row drawn from the entity's fields and their types. When the spec names a public
 * form that collects rows (`collect`), its link is here to copy and send, with a name filled in if you like.
 *
 * A field the seed file sets is marked: the next seed (every boot) puts its value back.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Check, Copy, ImagePlus, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { AdminError, createRow, dataEntities, dataRows, deleteRow, updateRow, type DataEntity, type DataField, type DataRow } from "./client";
import { pictureDataUrl } from "../lib/picture";
import type { Go } from "./Admin";

const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").replace(/^./, (c) => c.toUpperCase());
const show = (v: unknown) => v == null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v).startsWith("data:image") ? "(photo)" : String(v);
const cls = "w-full rounded border border-border bg-background px-3 py-2 text-sm focus:border-accent focus:outline-none";
const isPicture = (f: DataField) => f.type === "url" && /image|photo|avatar|picture|portrait/i.test(f.name);

export function Data({ parts, go }: { parts: string[]; go: Go }) {
  const [list, setList] = useState<DataEntity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { dataEntities().then((r) => setList(r.entities)).catch((e) => setError(e.message)); }, [parts.join("/")]);
  if (error) return <p role="alert" className="text-write">{error}</p>;
  if (!list) return <Loader2 className="h-5 w-5 animate-spin text-accent" aria-label="Loading" />;
  if (!list.length) return (
    <section className="max-w-2xl">
      <h1 className="mb-2 text-2xl font-black tracking-tight">Data</h1>
      <p className="text-sm text-muted-foreground">No entity is open to operators. Give one an <code className="font-mono text-foreground">"admin": true</code> in the spec to read and edit its rows here.</p>
    </section>
  );
  const entity = list.find((e) => e.name === parts[0]) ?? (parts[0] ? undefined : list[0]);
  if (!entity) return <p role="alert" className="text-write">No entity “{parts[0]}” is open to operators.</p>;
  return (
    <div className="grid gap-8 lg:grid-cols-[12rem_1fr]">
      <nav aria-label="Entities" className="flex gap-1 overflow-x-auto lg:flex-col">
        {list.map((e) => (
          <button key={e.name} onClick={() => go("data", e.name)} aria-current={e.name === entity.name ? "page" : undefined}
            className={`flex items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm font-semibold ${e.name === entity.name ? "bg-card text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {humanize(e.name)}<span className="font-mono text-xs text-muted-foreground">{e.count}</span>
          </button>
        ))}
      </nav>
      {parts[1] ? <RowEditor key={parts[1]} entity={entity} id={parts[1]} go={go} /> : <Rows entity={entity} go={go} />}
    </div>
  );
}

function Rows({ entity, go }: { entity: DataEntity; go: Go }) {
  const [rows, setRows] = useState<DataRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setRows(null); dataRows(entity.name).then((r) => setRows(r.rows)).catch((e) => setError(e.message)); }, [entity.name]);
  return (
    <section className="min-w-0">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-2xl font-black tracking-tight">{humanize(entity.name)}</h1>{entity.doc && <p className="text-sm text-muted-foreground">{entity.doc}</p>}</div>
        <button onClick={() => go("data", entity.name, "new")} className="inline-flex items-center gap-2 rounded border border-border px-4 py-2 text-sm font-bold hover:border-accent"><Plus className="h-4 w-4" />New</button>
      </div>
      {entity.collect && <CollectLink shape={entity.collect} />}
      {error && <p role="alert" className="text-write">{error}</p>}
      {!rows ? <Loader2 className="h-5 w-5 animate-spin text-accent" aria-label="Loading" /> : !rows.length ? <p className="text-sm text-muted-foreground">No rows yet.</p> : (
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-card text-xs uppercase tracking-widest text-muted-foreground">
              <tr>{entity.columns.map((c) => <th key={c} className="px-4 py-3 font-black">{humanize(c)}</th>)}<th className="px-4 py-3" /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => go("data", entity.name, r.id)} className="cursor-pointer border-t border-border hover:bg-card">
                  {entity.columns.map((c, i) => (
                    <td key={c} className={`max-w-xs truncate px-4 py-3 ${i ? "text-muted-foreground" : "font-semibold"}`}>
                      {i === 0 ? <button className="text-left hover:text-accent">{show(r[c]) || r.id}</button> : show(r[c])}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right">{r.$seeded.length > 0 && <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground" title="This row is in the seed file">seed</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** The public form's link, to copy and send; a name, when given, is filled in for them. */
function CollectLink({ shape }: { shape: string }) {
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}/${shape}${name.trim() ? `?${new URLSearchParams({ name: name.trim() })}` : ""}`;
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* the field is selectable */ } };
  return (
    <div className="mb-6 rounded border border-border bg-card p-4">
      <p className="mb-3 text-xs font-black uppercase tracking-[0.2em] text-accent">Link to send</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input aria-label="Their name (optional)" placeholder="Their name (optional)" value={name} onChange={(e) => setName(e.target.value)} className={`${cls} sm:max-w-56`} />
        <input aria-label="Link" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className={`${cls} font-mono text-xs`} />
        <button onClick={copy} className="inline-flex shrink-0 items-center justify-center gap-2 rounded bg-accent px-4 py-2 text-sm font-black text-accent-foreground hover:brightness-110">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Copy"}</button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Anyone with it can fill in the form. What they send waits here until you change its status.</p>
    </div>
  );
}

function RowEditor({ entity, id, go }: { entity: DataEntity; id: string; go: Go }) {
  const isNew = id === "new";
  const [row, setRow] = useState<DataRow | null>(isNew ? ({ id: "", $seeded: [] } as DataRow) : null);
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (isNew) return;
    dataRows(entity.name).then((r) => { const found = r.rows.find((x) => x.id === id); found ? setRow(found) : setNote({ ok: false, text: `No ${entity.name} “${id}”.` }); }).catch((e) => setNote({ ok: false, text: e.message }));
  }, [entity.name, id]);
  const fields = useMemo(() => entity.fields.filter((f) => f.name !== "id"), [entity]);
  const changed = Object.keys(edits).length > 0;

  const save = async () => {
    setBusy(true); setNote(null);
    try {
      const r = isNew ? await createRow(entity.name, edits) : await updateRow(entity.name, id, edits);
      setRow(r.row); setEdits({}); setNote({ ok: true, text: "Saved." });
      if (isNew) go("data", entity.name, r.row.id);
    } catch (e) { setNote({ ok: false, text: e instanceof AdminError ? e.message : String(e) }); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!sure) return setSure(true);
    setBusy(true);
    try { await deleteRow(entity.name, id); go("data", entity.name); } catch (e) { setNote({ ok: false, text: (e as Error).message }); setBusy(false); }
  };

  if (!row) return note ? <p role="alert" className="text-write">{note.text}</p> : <Loader2 className="h-5 w-5 animate-spin text-accent" aria-label="Loading" />;
  return (
    <section className="min-w-0 max-w-3xl">
      <div className="sticky top-14 z-20 -mx-4 mb-6 flex flex-wrap items-center justify-between gap-4 bg-background/95 px-4 py-3 backdrop-blur-sm">
        <div className="min-w-0">
          <button onClick={() => go("data", entity.name)} className="mb-1 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3 w-3" />{humanize(entity.name)}</button>
          <h1 className="truncate text-2xl font-black tracking-tight">{isNew ? `New ${humanize(entity.name).toLowerCase()}` : show(edits[entity.title] ?? row[entity.title]) || id}</h1>
        </div>
        <div className="flex gap-2">
          {!isNew && <button onClick={remove} disabled={busy} onBlur={() => setSure(false)} className={`inline-flex items-center gap-2 rounded border px-4 py-2 text-sm font-bold ${sure ? "border-write text-write" : "border-border text-muted-foreground hover:text-foreground"}`}><Trash2 className="h-4 w-4" />{sure ? "Delete for good?" : "Delete"}</button>}
          <button onClick={save} disabled={!changed || busy} className="inline-flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-black text-accent-foreground hover:brightness-110 disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save</button>
        </div>
      </div>
      {note && <p role={note.ok ? "status" : "alert"} className={`mb-6 rounded border p-4 text-sm ${note.ok ? "border-success/40 text-success" : "border-write/40 text-write"}`}>{note.text}</p>}
      {row.$seeded.length > 0 && <p className="mb-6 text-xs text-muted-foreground">This row is in the seed file. Fields marked <span className="rounded border border-border px-1 font-mono text-[10px]">seed</span> go back to the file's value on the next start; change them in <span className="font-mono">seed/{entity.name}.json</span> to keep a change.</p>}
      <div className="space-y-4 rounded border border-border bg-card p-5">
        {!isNew && <Row label="id" seeded={false}><p className="pt-2 font-mono text-xs text-muted-foreground">{id}</p></Row>}
        {fields.map((f) => {
          const value = f.name in edits ? edits[f.name] : row[f.name];
          return (
            <Row key={f.name} label={humanize(f.name)} doc={f.doc} optional={f.optional} seeded={row.$seeded.includes(f.name)} htmlFor={`f-${f.name}`}>
              <Input f={f} value={value} set={(v) => setEdits((e) => ({ ...e, [f.name]: v }))} />
            </Row>
          );
        })}
      </div>
    </section>
  );
}

function Row({ label, doc, optional, seeded, htmlFor, children }: { label: string; doc?: string; optional?: boolean; seeded: boolean; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[12rem_1fr] sm:items-start sm:gap-4">
      <label htmlFor={htmlFor} className="pt-2 text-sm font-semibold">
        {label}{optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
        {seeded && <span className="ml-2 rounded border border-border px-1 font-mono text-[10px] font-normal text-muted-foreground">seed</span>}
        {doc && <span className="block text-xs font-normal text-muted-foreground">{doc}</span>}
      </label>
      <div>{children}</div>
    </div>
  );
}

function Input({ f, value, set }: { f: DataField; value: unknown; set: (v: unknown) => void }) {
  const id = `f-${f.name}`;
  const [problem, setProblem] = useState<string | null>(null);
  if (f.array) return <textarea id={id} rows={4} value={Array.isArray(value) ? value.join("\n") : String(value ?? "")} onChange={(e) => set(e.target.value.split("\n"))} className={cls} />;
  if (f.type === "json") return <textarea id={id} rows={6} value={typeof value === "string" ? value : value == null ? "" : JSON.stringify(value, null, 2)} onChange={(e) => set(e.target.value)} className={`${cls} font-mono text-xs`} />;
  if (f.type === "enum") return <select id={id} value={String(value ?? "")} onChange={(e) => set(e.target.value)} className={cls}>{f.optional && <option value="">—</option>}{f.values?.map((v) => <option key={v} value={v}>{humanize(v)}</option>)}</select>;
  if (f.type === "boolean") return <input id={id} type="checkbox" checked={!!value} onChange={(e) => set(e.target.checked)} className="mt-3 h-4 w-4 accent-[var(--accent)]" />;
  if (f.type === "int" || f.type === "number" || f.type === "money") return <input id={id} type="number" step={f.type === "int" ? 1 : "any"} value={String(value ?? "")} onChange={(e) => set(e.target.value)} className={cls} />;
  if (f.type === "date") return <input id={id} type="date" value={String(value ?? "").slice(0, 10)} onChange={(e) => set(e.target.value)} className={cls} />;
  if (f.type === "timestamp") return <input id={id} type="datetime-local" value={value ? new Date(String(value)).toISOString().slice(0, 16) : ""} onChange={(e) => set(e.target.value)} className={cls} />;
  if (f.type === "text") return <textarea id={id} rows={6} value={String(value ?? "")} onChange={(e) => set(e.target.value)} className={cls} />;
  if (isPicture(f)) return (
    <div className="flex items-center gap-4">
      {value ? <img src={String(value)} alt="" className="h-16 w-16 shrink-0 rounded-full border border-border object-cover" /> : <div className="h-16 w-16 shrink-0 rounded-full border border-dashed border-border" />}
      <div className="min-w-0 flex-1 space-y-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded border border-border px-3 py-1.5 text-xs font-bold hover:border-accent">
          <ImagePlus className="h-4 w-4" />Upload a photo
          <input type="file" accept="image/*" className="sr-only" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; try { setProblem(null); set(await pictureDataUrl(file)); } catch (err) { setProblem((err as Error).message); } }} />
        </label>
        <input id={id} placeholder="or a URL" value={String(value ?? "").startsWith("data:") ? "" : String(value ?? "")} onChange={(e) => set(e.target.value)} className={cls} />
        {value ? <button type="button" onClick={() => set("")} className="text-xs text-muted-foreground hover:text-foreground">Remove</button> : null}
        {problem && <p role="alert" className="text-xs text-write">{problem}</p>}
      </div>
    </div>
  );
  return <input id={id} type={f.type === "email" ? "email" : f.type === "url" ? "url" : "text"} value={String(value ?? "")} onChange={(e) => set(e.target.value)} className={cls} />;
}
