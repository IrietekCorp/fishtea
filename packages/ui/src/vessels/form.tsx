import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "../components/ui/button";
import { Input, Textarea, Select } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Checkbox } from "../components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "../components/ui/alert-dialog";
import type { Field as FieldDef } from "../lib/client";

/** form and confirm-write: fields from the shape's input schema; knowns pre-filled; writes confirm in an AlertDialog with a focus trap. */
export function FormVessel({ shape, fields, known, errors, error, hint, phrase, write, summary, onSubmit }: { shape: string; fields: FieldDef[]; known: Record<string, unknown>; errors?: Record<string, string>; error?: string; hint?: string; phrase: string; write: boolean; summary?: string; onSubmit: (args: Record<string, unknown>, confirm: boolean) => void }) {
  const flat = flatten(fields, known);
  const { register, handleSubmit, getValues, setFocus, formState } = useForm({ defaultValues: flat.defaults });
  const [confirming, setConfirming] = useState<Record<string, unknown> | null>(null);
  const firstEmpty = useRef<string | null>(flat.fields.find((f) => f.required && (flat.defaults[f.key] == null || flat.defaults[f.key] === ""))?.key ?? null);
  useEffect(() => { if (firstEmpty.current) setFocus(firstEmpty.current as any); }, [setFocus]);

  const submit = (values: Record<string, unknown>) => {
    const args = unflatten(values, flat.fields);
    if (write) setConfirming(args); else onSubmit(args, false);
  };
  const skip = !fields.length && write;
  return (
    <Card>
      <CardHeader><CardTitle>{phrase}</CardTitle>{(hint || error) && <CardDescription className={error ? "text-write" : ""}>{error ?? hint}</CardDescription>}</CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(submit)} className="grid gap-3 sm:grid-cols-2" aria-describedby={error ? `${shape}-error` : undefined}>
          {flat.fields.map((f) => (
            <div key={f.key} className={f.type === "text" || f.type === "json" ? "sm:col-span-2" : ""}>
              <Label htmlFor={`${shape}-${f.key}`}>{f.label}{f.required && <span aria-hidden className="text-write"> *</span>}</Label>
              <FieldInput f={f} id={`${shape}-${f.key}`} register={register} invalid={!!errors?.[f.key]} />
              {(errors?.[f.key] || f.doc) && <p className={`mt-1 text-xs ${errors?.[f.key] ? "text-write" : "text-muted-foreground"}`} id={`${shape}-${f.key}-desc`}>{errors?.[f.key] ?? f.doc}</p>}
            </div>
          ))}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" variant={write ? "write" : "default"} disabled={formState.isSubmitting}>{write ? (skip ? "Confirm" : "Review & confirm") : "Answer"}</Button>
          </div>
        </form>
      </CardContent>
      <AlertDialog open={!!confirming} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Confirm: {phrase}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              <p className="mb-2">{summary ?? "This will change data."}</p>
              <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">{Object.entries(confirming ?? {}).map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd></div>)}</dl>
            </div>
          </AlertDialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const a = confirming!; setConfirming(null); onSubmit(a, true); }}>Confirm</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

interface Flat { key: string; label: string; type: string; required: boolean; array: boolean; enumValues?: string[]; doc?: string; min?: number; max?: number; path: string[] }

function flatten(fields: FieldDef[], known: Record<string, unknown>): { fields: Flat[]; defaults: Record<string, unknown> } {
  const out: Flat[] = [];
  const defaults: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === "json" && known[f.name] && typeof known[f.name] === "object" && !Array.isArray(known[f.name])) {
      for (const [k, v] of Object.entries(known[f.name] as object)) { out.push({ key: `${f.name}.${k}`, label: `${f.label} · ${k}`, type: "string", required: f.required, array: false, path: [f.name, k] }); defaults[`${f.name}.${k}`] = v ?? ""; }
      continue;
    }
    if (f.type === "json" && !known[f.name] && SHIP_TO.test(f.name)) {
      for (const k of ["name", "line1", "city", "region", "postal", "country"]) { out.push({ key: `${f.name}.${k}`, label: `${f.label} · ${k}`, type: "string", required: f.required, array: false, path: [f.name, k] }); defaults[`${f.name}.${k}`] = k === "country" ? "US" : ""; }
      continue;
    }
    out.push({ key: f.name, label: f.label, type: f.type, required: f.required, array: f.array, enumValues: f.enumValues, doc: f.doc, min: f.min, max: f.max, path: [f.name] });
    const v = known[f.name] ?? f.default;
    defaults[f.name] = v == null ? (f.type === "boolean" ? false : "") : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : v;
  }
  return { fields: out, defaults };
}
const SHIP_TO = /ship|address/i;

function unflatten(values: Record<string, unknown>, fields: Flat[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    let v: unknown = values[f.key];
    if (v === "" || v == null) continue;
    if (f.array) v = String(v).split(",").map((s) => s.trim()).filter(Boolean);
    else if (f.type === "int") v = parseInt(String(v), 10);
    else if (f.type === "number" || f.type === "money") v = Number(v);
    else if (f.type === "boolean") v = Boolean(v);
    else if (f.type === "json") { try { v = JSON.parse(String(v)); } catch {} }
    if (f.path.length === 2) { (out[f.path[0]] ??= {}) as any; (out[f.path[0]] as any)[f.path[1]] = v; } else out[f.path[0]] = v;
  }
  return out;
}

function FieldInput({ f, id, register, invalid }: { f: Flat; id: string; register: any; invalid: boolean }) {
  const common = { id, "aria-invalid": invalid || undefined, "aria-describedby": f.doc || invalid ? `${id}-desc` : undefined, ...register(f.key, { required: f.required }) };
  if (f.enumValues) return <Select {...common}><option value="">—</option>{f.enumValues.map((v) => <option key={v} value={v}>{v}</option>)}</Select>;
  if (f.type === "boolean") return <div className="mt-2"><Checkbox id={id} {...register(f.key)} /></div>;
  if (f.type === "text" || f.type === "json") return <Textarea {...common} rows={3} />;
  if (f.type === "int" || f.type === "number" || f.type === "money") return <Input {...common} type="number" step={f.type === "int" ? 1 : "0.01"} min={f.min} max={f.max} inputMode="decimal" />;
  if (f.type === "email") return <Input {...common} type="email" autoComplete="email" />;
  if (f.type === "date") return <Input {...common} type="date" />;
  return <Input {...common} type="text" placeholder={f.array ? "comma separated" : undefined} />;
}
