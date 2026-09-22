/**
 * Field-level treatments by *name*, never by shape (§10): price → money, imageUrl → image, heat/rating → glyphs,
 * *At/date → date, arrays → badges, booleans → yes/no. The UI has no knowledge of any entity.
 */
import { Badge } from "./components/ui/badge";
import { money } from "./lib/utils";

const HIDDEN = new Set(["id", "visitorId", "familyId", "customerId", "registrationId", "camperId", "sessionId", "productIds", "embedding", "fts"]);
export const isHidden = (k: string) => HIDDEN.has(k);
/** "compareAtPrice" → "Compare At Price", "line1" → "Line 1". Sub-keys of a nested object come through
 *  here too, so "shipTo.line1" reads as "Ship To · Line 1" rather than "Ship To · line1". */
export const labelOf = (k: string) => k
  .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  .replace(/([a-zA-Z])(\d)/g, "$1 $2")
  .replace(/^./, (c) => c.toUpperCase());

export function Field({ name, value }: { name: string; value: unknown }) {
  if (value == null || value === "") return <span className="text-muted-foreground">—</span>;
  const n = name.toLowerCase();
  if (/price|total|subtotal|tax|shipping|amount|discount|each/.test(n) && (typeof value === "number" || !isNaN(Number(value)))) return <span className="whitespace-nowrap tabular-nums">{money(value)}</span>;
  if (/imageurl|image$/.test(n) && typeof value === "string") return <img src={value} alt="" loading="lazy" className="h-16 w-16 rounded-md object-cover" />;
  if (/url$/.test(n) && typeof value === "string") return <a href={value} className="underline" target="_blank" rel="noreferrer">link</a>;
  if (/^(heat|rating|energy)$/.test(n) && typeof value === "number") return <span aria-label={`${labelOf(name)} ${value} of 10`} title={`${value}/10`}>{"●".repeat(Math.round(value / 2))}{"○".repeat(5 - Math.round(value / 2))} <span className="sr-only">{value} of 10</span></span>;
  if (/at$|date$/i.test(name) && typeof value === "string" && !isNaN(Date.parse(value))) return <time dateTime={value}>{new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: /at$/i.test(name) ? "short" : undefined })}</time>;
  if (typeof value === "boolean") return <Badge variant={value ? "accent" : "outline"}>{value ? "yes" : "no"}</Badge>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">—</span>;
    if (typeof value[0] === "object") return <span className="text-muted-foreground">{value.length} items</span>;
    return <span className="flex flex-wrap gap-1">{value.slice(0, 8).map((v, i) => <Badge key={i}>{String(v)}</Badge>)}</span>;
  }
  if (typeof value === "object") return <code className="text-xs">{JSON.stringify(value).slice(0, 80)}</code>;
  if (/status|kind|category|tier|persona/.test(n)) return <Badge variant="outline">{String(value)}</Badge>;
  return <span>{String(value)}</span>;
}

/**
 * How interesting a field is to whoever is reading, lowest first — by *name and value shape*, never by
 * entity (§10). Anything that cannot be ranked lands in the middle rather than at either extreme.
 *
 * The two ends are what matter. A price is the first thing a shopper looks for, so it outranks everything
 * but the name. A foreign key, an audit timestamp and a raw jsonb blob are the framework's business, not
 * the reader's, so they sort to the bottom and fall off the cap — which keeps them out of a card without
 * anyone having to enumerate every entity's internal columns. They still appear when a record has nothing
 * better to show, which is what an order confirmation carrying only an id needs.
 */
export function fieldScore(key: string, value: unknown): number {
  const k = key.toLowerCase();
  if (/^(name|title|question)$/.test(k)) return 0;
  if (/^(description|answer|doc)$/.test(k)) return 9;          // rendered as the card's own description
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return 8;
  if (/id$/.test(k)) return 7;
  if (/(^|[a-z])at$|date$/.test(k)) return 6;
  if (Array.isArray(value)) return 5;
  if (/price|total|subtotal|amount|each/.test(k)) return 1;
  if (/stock|status|qty|quantity|spotsleft|capacity|age/.test(k)) return 2;
  if (/category|brand|tier|kind|persona|fulfilment|fulfillment/.test(k)) return 3;
  return 4;
}

/** The fields worth showing for these records, most interesting first, capped. */
export function rankFields(rows: Record<string, unknown>[], cap = 6, skip: string[] = []): string[] {
  const omit = new Set(skip);
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !isHidden(k) && !omit.has(k));
  const valueOf = (k: string) => rows.find((r) => r[k] != null)?.[k];
  return keys
    .map((k) => [k, fieldScore(k, valueOf(k))] as const)
    .sort((a, b) => a[1] - b[1] || keys.indexOf(a[0]) - keys.indexOf(b[0]))   // stable within a score
    .slice(0, cap)
    .map(([k]) => k);
}

/** Columns to show for a list of records: name-ish first, then scalars, capped. */
export function columnsFor(rows: Record<string, unknown>[], cap = 6): string[] {
  return rankFields(rows, cap);
}
