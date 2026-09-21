/**
 * compute call `inventory.pull`: for each active vendor, load calls/adapters/<adapter>.ts and ask it for items.
 * Adapters normalise a vendor's feed into the product shape products.upsert accepts. Credentials come from env,
 * never from the spec; an adapter that lacks its credentials returns [] with a note rather than throwing.
 */
export interface AdapterItem { sourceId: string; name: string; description?: string; brand?: string; category?: string; tags?: string[]; attributes?: Record<string, unknown>; price: number; currency?: string; compareAtPrice?: number; stock?: number; imageUrl?: string; affiliateUrl?: string; fulfilment?: "local" | "affiliate" | "dropship" }
export interface Adapter { fetch(q: { query?: string | null; limit: number; config: Record<string, unknown> }, ctx: { env: NodeJS.ProcessEnv; resolve: (p: string) => string; spec: any }): Promise<AdapterItem[]> }

export default async function inventoryPull(input: { vendors: any[]; query?: string | null; limit?: number }, ctx: { spec: any; resolve: (p: string) => string }) {
  const limit = Math.min(Number(input.limit ?? 50), Number(ctx.spec.rules.inventory?.maxItemsPerVendor ?? 200));
  const items: (AdapterItem & { vendorId: string })[] = [];
  const byVendor: Record<string, { pulled: number; note?: string }> = {};
  for (const v of input.vendors ?? []) {
    if (v.adapter === "local") { byVendor[v.name] = { pulled: 0, note: "local catalog: nothing to pull" }; continue; }
    try {
      const mod = (await import(ctx.resolve(`calls/adapters/${v.adapter}.ts`))) as { default: Adapter };
      const got = await mod.default.fetch({ query: input.query, limit, config: v.config ?? {} }, { env: process.env, resolve: ctx.resolve, spec: ctx.spec });
      for (const it of got) items.push({ ...it, vendorId: v.id, fulfilment: it.fulfilment ?? (it.affiliateUrl ? "affiliate" : "local") });
      byVendor[v.name] = { pulled: got.length };
    } catch (e) {
      byVendor[v.name] = { pulled: 0, note: (e as Error).message };
    }
  }
  return { items, byVendor };
}
