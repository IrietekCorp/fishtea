/**
 * The pours every application has and no vessel claims: the ask (nothing matched), a form (arguments
 * missing, or "did you mean…?") and a confirm-write. An answer nobody wrote a vessel for is laid out by
 * present/, from the spec.
 */
import { useState } from "react";
import type { Chip, Field, Pour } from "@fishtea/ui/lib/client";
import type { Conversation } from "./useConversation";
import { labelOf } from "./site";

export function Chips({ chips, c, label }: { chips: Chip[]; c: Conversation; label?: string }) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={label}>
      {label && <span className="mr-1 text-xs font-black uppercase tracking-[0.2em] text-accent">{label}</span>}
      {chips.map((ch, i) => (
        <button key={`${ch.shape}-${i}`} onClick={() => c.go(ch.shape, ch.args)} title={ch.gated ? "You'll be asked to identify yourself first" : undefined}
          className="rounded border border-border bg-card px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:border-accent hover:text-foreground">
          {ch.label}{ch.gated && <span className="ml-1 text-muted-foreground/60" aria-hidden>·</span>}
        </button>
      ))}
    </div>
  );
}

export function AskView({ pour, c }: { pour: Extract<Pour, { kind: "ask" }>; c: Conversation }) {
  return (
    <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <h1 className="rise text-3xl font-black tracking-tighter sm:text-4xl">{pour.phrase}</h1>
      {pour.hint && pour.hint !== pour.phrase && <p className="rise rise-1 mt-3 text-muted-foreground">{pour.hint}</p>}
      <div className="rise rise-2 mt-8"><Chips chips={pour.options} c={c} /></div>
    </section>
  );
}

const inputCls = "h-12 w-full rounded border border-border bg-background px-3 text-foreground placeholder:text-muted-foreground/60 focus:border-accent focus:outline-none";

export function FieldInput({ f, value, onChange, error }: { f: Field; value: unknown; onChange: (v: unknown) => void; error?: string }) {
  const id = `f-${f.name}`;
  const common = { id, name: f.name, required: f.required, "aria-invalid": !!error || undefined };
  let control;
  if (f.enumValues?.length) control = (
    <select {...common} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {!f.required && <option value="">—</option>}
      {f.required && value == null && <option value="" disabled>Choose…</option>}
      {f.enumValues.map((v) => <option key={v} value={v}>{v}</option>)}
    </select>
  );
  else if (f.type === "text") control = <textarea {...common} rows={5} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={`${inputCls} h-auto py-3`} />;
  else if (f.type === "boolean") control = <input {...common} type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 accent-[var(--accent)]" />;
  else control = <input {...common} type={f.type === "email" ? "email" : f.type === "int" || f.type === "number" ? "number" : "text"} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={inputCls} />;
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-xs font-black uppercase tracking-widest text-muted-foreground">{f.label}{f.required && <span className="text-accent"> *</span>}</label>
      {control}
      {f.doc && <p className="text-xs text-muted-foreground/60">{f.doc}</p>}
      {error && <p className="text-sm text-write" role="alert">{error}</p>}
    </div>
  );
}

/** Drop empty strings so an untouched optional field is absent, not "". */
export const clean = (v: Record<string, unknown>) => Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "" && x != null));

export function FormView({ pour, c, submitLabel = "Continue" }: { pour: Extract<Pour, { kind: "form" | "confirm-write" }>; c: Conversation; submitLabel?: string }) {
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...pour.known }));
  if (pour.kind === "confirm-write") return (
    <div className="space-y-6">
      <h2 className="text-2xl font-black tracking-tight">{pour.phrase}</h2>
      <dl className="grid gap-x-6 gap-y-3 rounded border border-border bg-background p-5 text-sm sm:grid-cols-[max-content_1fr]">
        {Object.entries(pour.known).filter(([, v]) => v != null && v !== "" && typeof v !== "object").map(([k, v]) => (
          <div key={k} className="contents"><dt className="text-xs font-black uppercase tracking-widest text-muted-foreground">{k}</dt><dd className="whitespace-pre-wrap text-foreground">{String(v)}</dd></div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-3">
        <button onClick={() => c.submit(pour.shape, pour.known, true)} disabled={c.busy} className="rounded bg-accent px-6 py-3 font-black uppercase tracking-tight text-accent-foreground hover:brightness-110 disabled:opacity-60">Confirm and send</button>
        <button onClick={c.back} className="rounded border border-border px-6 py-3 font-bold text-muted-foreground hover:border-accent hover:text-foreground">Edit</button>
      </div>
    </div>
  );
  const fields = pour.fields;
  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); c.submit(pour.shape, clean(values)); }}>
      {pour.hint && <p className="text-muted-foreground">{pour.hint}</p>}
      {pour.error && <p className="rounded border border-write/50 bg-write/10 p-3 text-sm text-write" role="alert">{pour.error}</p>}
      {fields.map((f) => <FieldInput key={f.name} f={f} value={values[f.name]} error={pour.errors?.[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />)}
      <button type="submit" disabled={c.busy} className="w-full rounded bg-accent px-6 py-4 text-lg font-black uppercase tracking-tight text-accent-foreground hover:brightness-110 disabled:opacity-60">
        {fields.length ? submitLabel : `Yes — ${labelOf(pour.shape)}`}
      </button>
      {pour.options?.length ? <Chips chips={pour.options} c={c} label="Or" /> : null}
    </form>
  );
}
