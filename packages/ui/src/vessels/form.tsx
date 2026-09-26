import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "../components/ui/button";
import { Input, Textarea, Select } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Checkbox } from "../components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "../components/ui/alert-dialog";
import { labelOf } from "../fields";
import type { Field as FieldDef } from "../lib/client";

/** form and confirm-write: fields from the shape's input schema; knowns pre-filled; writes confirm in an AlertDialog with a focus trap. */
export function FormVessel({ shape, fields, known, errors, error, hint, phrase, write, summary, onSubmit, watch: watchChips, onFire }: { shape: string; fields: FieldDef[]; known: Record<string, unknown>; errors?: Record<string, string>; error?: string; hint?: string; phrase: string; write: boolean; summary?: string; onSubmit: (args: Record<string, unknown>, confirm: boolean) => void; watch?: { field: string; shape: string; args?: Record<string, unknown> }[]; onFire?: (c: { shape: string; args?: Record<string, unknown> }) => void }) {
  const flat = flatten(fields, known);
  const { register, handleSubmit, getValues, setFocus, formState, watch } = useForm({ defaultValues: flat.defaults });

  /**
   * A chip that fires on a field changing rather than on a click.
   *
   * It sends the same utterance the click would have, so the turn is gated, planned and on the trail —
   * nothing is kept here. `useRef` holds the last value seen so a re-render does not re-fire, and the
   * first render never fires: this reacts to a *change*, not to existing.
   */
  const seen = useRef<Record<string, unknown>>({});
  const values = watch();
  useEffect(() => {
    for (const w of watchChips ?? []) {
      // A watched field may be named by its flat key ("shipTo.country") or by its leaf ("country").
      const key = flat.fields.find((f) => f.key === w.field || f.path.at(-1) === w.field)?.key ?? w.field;
      const now = (values as Record<string, unknown>)[key];
      if (!(key in seen.current)) { seen.current[key] = now; continue; }
      if (seen.current[key] === now) continue;
      seen.current[key] = now;
      if (now !== undefined && now !== "") onFire?.({ shape: w.shape, args: { ...(w.args ?? {}), [w.field]: now } });
    }
  }, [values, watchChips, onFire, flat.fields]);
  const [confirming, setConfirming] = useState<Record<string, unknown> | null>(null);
  const firstEmpty = useRef<string | null>(flat.fields.find((f) => f.required && (flat.defaults[f.key] == null || flat.defaults[f.key] === ""))?.key ?? null);
  useEffect(() => { if (firstEmpty.current) setFocus(firstEmpty.current as any); }, [setFocus]);

  const submit = (values: Record<string, unknown>) => {
    const args = unflatten(values, flat.fields);
    if (write) setConfirming(args); else onSubmit(args, false);
  };
  const skip = !fields.length && write;

  /**
   * What to say under a field: the server's complaint if it made one, otherwise the browser's.
   *
   * react-hook-form blocks submission on a missing required field but renders nothing itself, so before
   * this the button simply did nothing and never said why. Its errors are keyed by path, so a nested
   * field arrives as errors.shipTo.line1 rather than errors["shipTo.line1"].
   */
  const problemFor = (key: string): string | undefined => {
    if (errors?.[key]) return errors[key];
    const hit = key.split(".").reduce<any>((o, part) => (o == null ? o : o[part]), formState.errors as any);
    if (!hit?.type) return undefined;
    return hit.message || (hit.type === "required" ? "Required" : "Check this");
  };
  return (
    <Card>
      <CardHeader><CardTitle>{phrase}</CardTitle>{(hint || error) && <CardDescription className={error ? "text-write" : ""}>{error ?? hint}</CardDescription>}</CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(submit)} className="grid gap-3 sm:grid-cols-2" aria-describedby={error ? `${shape}-error` : undefined}>
          {flat.fields.map((f) => (
            <div key={f.key} className={f.type === "text" || f.type === "json" ? "sm:col-span-2" : ""}>
              <Label htmlFor={`${shape}-${f.key}`}>{f.label}{f.required && <span aria-hidden className="text-write"> *</span>}</Label>
              <FieldInput f={f} id={`${shape}-${f.key}`} register={register} invalid={!!problemFor(f.key)} />
              {(problemFor(f.key) || f.doc) && <p className={`mt-1 text-xs ${problemFor(f.key) ? "text-write" : "text-muted-foreground"}`} id={`${shape}-${f.key}-desc`}>{problemFor(f.key) ?? f.doc}</p>}
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

export interface Flat { key: string; label: string; type: string; required: boolean; array: boolean; enumValues?: string[]; doc?: string; min?: number; max?: number; path: string[] }

export function flatten(fields: FieldDef[], known: Record<string, unknown>): { fields: Flat[]; defaults: Record<string, unknown> } {
  const out: Flat[] = [];
  const defaults: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === "json") {
      const obj = known[f.name];
      const partial = obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
      // An address always offers its full set of lines. Rendering only the keys the server echoed back
      // meant a sub-field left blank was dropped by unflatten(), came back missing, and could never be
      // filled again — submit checkout without a city and the city input was simply gone.
      const canonical = SHIP_TO.test(f.name) ? ADDRESS_KEYS : [];
      const keys = [...new Set([...canonical, ...Object.keys(partial ?? {})])];
      if (keys.length) {
        for (const k of keys) {
          out.push({ key: `${f.name}.${k}`, label: `${f.label} · ${labelOf(k)}`, type: "string", required: f.required, array: false, path: [f.name, k] });
          const v = partial?.[k];
          defaults[`${f.name}.${k}`] = v ?? (k === "country" ? "US" : "");
        }
        continue;
      }
    }
    out.push({ key: f.name, label: f.label, type: f.type, required: f.required, array: f.array, enumValues: f.enumValues, doc: f.doc, min: f.min, max: f.max, path: [f.name] });
    const v = known[f.name] ?? f.default;
    defaults[f.name] = v == null ? (f.type === "boolean" ? false : "") : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : v;
  }
  return { fields: out, defaults };
}
const SHIP_TO = /ship|address/i;
const ADDRESS_KEYS = ["name", "line1", "city", "region", "postal", "country"];

/**
 * Read one field's value out of whatever react-hook-form handed back.
 *
 * A dot in a registered name is a *path* to react-hook-form, so `register("shipTo.line1")` writes to
 * `{ shipTo: { line1 } }`. But `defaultValues` is stored as given, and we give it flat dotted keys — so
 * the submitted values are a **hybrid**: a stale `"shipTo.line1": ""` from the defaults sitting next to
 * the live `shipTo.line1` the visitor actually typed.
 *
 * So the path wins and the flat key is only a fallback. Reading flat-first looks harmless and is not: the
 * empty default shadows the real value, every address line is dropped as "empty", and the order goes out
 * with nothing but its country. Reading path-first still supports a purely flat object, because the path
 * lookup simply misses and falls through.
 */
function valueAt(values: Record<string, unknown>, path: string[]): unknown {
  const nested = path.reduce<any>((o, part) => (o == null ? undefined : o[part]), values);
  if (nested !== undefined && nested !== "") return nested;
  const flat = values[path.join(".")];
  return flat !== undefined && flat !== "" ? flat : nested ?? flat;
}

export function unflatten(values: Record<string, unknown>, fields: Flat[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    let v: unknown = valueAt(values, f.path);
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
  // `register(..., { required })` is react-hook-form *validation*; it sets no DOM attribute. Without
  // aria-required the asterisk in the label is decoration a screen reader never hears.
  const common = { id, "aria-required": f.required || undefined, "aria-invalid": invalid || undefined, "aria-describedby": f.doc || invalid ? `${id}-desc` : undefined, ...register(f.key, { required: f.required }) };
  if (f.enumValues) return <Select {...common}><option value="">—</option>{f.enumValues.map((v) => <option key={v} value={v}>{v}</option>)}</Select>;
  if (f.type === "boolean") return <div className="mt-2"><Checkbox id={id} {...register(f.key)} /></div>;
  if (f.type === "text" || f.type === "json") return <Textarea {...common} rows={3} />;
  if (f.type === "int" || f.type === "number" || f.type === "money") return <Input {...common} type="number" step={f.type === "int" ? 1 : "0.01"} min={f.min} max={f.max} inputMode="decimal" />;
  if (f.type === "email") return <Input {...common} type="email" autoComplete="email" />;
  if (f.type === "date") return <Input {...common} type="date" />;
  return <Input {...common} type="text" placeholder={f.array ? "comma separated" : undefined} />;
}
