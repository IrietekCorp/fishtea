/**
 * compute call `tax.quote`: (lines, shipTo) → { subtotal, shipping, tax, rate, jurisdiction, total }
 * Rules come from spec.rules (pricing.freeShippingOver, tax.table); the model never sees them.
 */
import { readFileSync } from "node:fs";

let table: Record<string, number> | null = null;

export default function taxQuote(input: { lines: any[]; shipTo: any }, ctx: { spec: any; resolve: (p: string) => string }) {
  const rules = ctx.spec.rules;
  if (rules.tax?.shipToRequired && !input.shipTo?.country) throw new Error("shipTo.country is required to quote tax");
  if (!table) table = JSON.parse(readFileSync(ctx.resolve("rules/" + (rules.tax?.table ?? "tax_rates.json")), "utf8"));
  const lines = Array.isArray(input.lines) ? input.lines : [];
  const subtotal = round(lines.reduce((s, l) => s + Number(l.price ?? 0) * Number(l.qty ?? 1), 0));
  const country = String(input.shipTo.country ?? "US").toUpperCase();
  const region = String(input.shipTo.region ?? "").toUpperCase();
  const key = `${country}-${region}`;
  const rate = table![key] ?? table![country] ?? 0;
  const jurisdiction = table![key] !== undefined ? key : country;
  const shipping = subtotal >= (rules.pricing?.freeShippingOver ?? Infinity) || subtotal === 0 ? 0 : Number(rules.pricing?.flatShipping ?? 0);
  const tax = round(subtotal * rate);
  return { subtotal, shipping, tax, rate, jurisdiction, total: round(subtotal + shipping + tax) };
}

const round = (n: number) => Math.round(n * 100 + Number.EPSILON) / 100;
