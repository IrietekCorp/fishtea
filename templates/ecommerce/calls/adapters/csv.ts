/** CSV feed adapter: config.file (relative to the app dir) or config.url; header row names the product fields. */
import { readFileSync } from "node:fs";
import type { Adapter, AdapterItem } from "../inventory_pull.ts";
function parse(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const cells = (l: string) => { const out: string[] = []; let cur = "", q = false; for (const c of l) { if (c === '"') q = !q; else if (c === "," && !q) { out.push(cur); cur = ""; } else cur += c; } out.push(cur); return out.map((s) => s.trim()); };
  const head = cells(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(cells(l).map((v, i) => [head[i], v])));
}
const adapter: Adapter = {
  async fetch({ query, limit, config }, ctx) {
    const text = config.url ? await (await fetch(String(config.url), { signal: AbortSignal.timeout(10000) })).text() : readFileSync(ctx.resolve(String(config.file ?? "seed/feed.csv")), "utf8");
    const rows = parse(text).filter((r) => !query || JSON.stringify(r).toLowerCase().includes(query.toLowerCase()));
    return rows.slice(0, limit).map<AdapterItem>((r) => ({ sourceId: r.sourceId ?? r.sku ?? r.id, name: r.name ?? r.title, description: r.description ?? "", brand: r.brand, category: r.category, tags: (r.tags ?? "").split("|").map((s) => s.trim()).filter(Boolean), price: Number(r.price), currency: r.currency, stock: r.stock ? Number(r.stock) : 0, imageUrl: r.imageUrl || undefined, affiliateUrl: r.affiliateUrl || r.url || undefined }));
  },
};
export default adapter;
