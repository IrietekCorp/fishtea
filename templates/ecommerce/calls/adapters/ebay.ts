/**
 * eBay Browse API + Partner Network links. Needs EBAY_APP_ID / EBAY_CERT_ID (client-credentials OAuth) and
 * optionally EBAY_CAMPAIGN_ID for affiliate links. config: { marketplace: "EBAY_US", categoryIds: "281", minPrice, maxPrice }.
 * Verify field names against the live Browse API before relying on it.
 */
import type { Adapter, AdapterItem } from "../inventory_pull.ts";
let token: { value: string; exp: number } | null = null;
async function auth(env: NodeJS.ProcessEnv): Promise<string> {
  if (token && token.exp > Date.now()) return token.value;
  const id = env.EBAY_APP_ID, secret = env.EBAY_CERT_ID;
  if (!id || !secret) throw new Error("EBAY_APP_ID / EBAY_CERT_ID not set");
  const res = await fetch(`https://api.${env.EBAY_SANDBOX ? "sandbox." : ""}ebay.com/identity/v1/oauth2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64") }, body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope" });
  if (!res.ok) throw new Error(`ebay auth ${res.status}`);
  const j: any = await res.json();
  token = { value: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return token.value;
}
const adapter: Adapter = {
  async fetch({ query, limit, config }, { env }) {
    const t = await auth(env);
    const params = new URLSearchParams({ q: query ?? String(config.query ?? "accessories"), limit: String(Math.min(limit, 200)) });
    if (config.categoryIds) params.set("category_ids", String(config.categoryIds));
    const filters = ["buyingOptions:{FIXED_PRICE}", "conditions:{NEW}"];
    if (config.minPrice || config.maxPrice) filters.push(`price:[${config.minPrice ?? ""}..${config.maxPrice ?? ""}],priceCurrency:USD`);
    params.set("filter", filters.join(","));
    const res = await fetch(`https://api.${env.EBAY_SANDBOX ? "sandbox." : ""}ebay.com/buy/browse/v1/item_summary/search?${params}`, { headers: { authorization: `Bearer ${t}`, "X-EBAY-C-MARKETPLACE-ID": String(config.marketplace ?? "EBAY_US"), ...(env.EBAY_CAMPAIGN_ID ? { "X-EBAY-C-ENDUSERCTX": `affiliateCampaignId=${env.EBAY_CAMPAIGN_ID}` } : {}) }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`ebay search ${res.status}`);
    const j: any = await res.json();
    return (j.itemSummaries ?? []).map<AdapterItem>((it: any) => ({ sourceId: it.itemId, name: it.title, description: it.shortDescription ?? it.title, brand: it.brand, category: it.categories?.[0]?.categoryName ?? String(config.category ?? "ebay"), tags: (it.categories ?? []).map((c: any) => String(c.categoryName).toLowerCase()), price: Number(it.price?.value ?? 0), currency: it.price?.currency, stock: 0, imageUrl: it.image?.imageUrl, affiliateUrl: it.itemAffiliateWebUrl ?? it.itemWebUrl, attributes: { condition: it.condition, seller: it.seller?.username } }));
  },
};
export default adapter;
