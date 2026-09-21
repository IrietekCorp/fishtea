/** Generic JSON feed: GET config.url (+ ?q=) returning [{...product fields}]; a bearer token from env[config.tokenEnv]. */
import type { Adapter, AdapterItem } from "../inventory_pull.ts";
const adapter: Adapter = {
  async fetch({ query, limit, config }, { env }) {
    const url = new URL(String(config.url));
    if (query) url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));
    const tokenEnv = config.tokenEnv ? env[String(config.tokenEnv)] : undefined;
    const res = await fetch(url, { headers: tokenEnv ? { authorization: `Bearer ${tokenEnv}` } : {}, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`feed ${res.status}`);
    const j: any = await res.json();
    const rows: any[] = Array.isArray(j) ? j : j.items ?? j.products ?? [];
    return rows.slice(0, limit).map<AdapterItem>((r) => ({ sourceId: String(r.sourceId ?? r.sku ?? r.id), name: r.name ?? r.title, description: r.description ?? "", brand: r.brand, category: r.category, tags: r.tags ?? [], attributes: r.attributes, price: Number(r.price), currency: r.currency, stock: Number(r.stock ?? 0), imageUrl: r.imageUrl ?? r.image, affiliateUrl: r.affiliateUrl ?? r.url }));
  },
};
export default adapter;
