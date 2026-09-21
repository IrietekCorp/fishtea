/** Dev adapter: fabricates a few items so `op.syncInventory` can be exercised with no credentials. */
import type { Adapter } from "../inventory_pull.ts";
const adapter: Adapter = {
  async fetch({ query, limit, config }) {
    const n = Math.min(limit, Number(config.count ?? 5));
    const base = (query ?? String(config.topic ?? "sample")).toLowerCase();
    return Array.from({ length: n }, (_, i) => ({
      sourceId: `${base}-${i + 1}`, name: `${base} item ${i + 1}`, description: `A ${base} item from the mock vendor feed, number ${i + 1}.`,
      brand: "MockBrand", category: String(config.category ?? base), tags: [base, i % 2 ? "new" : "classic"], price: 10 + i * 7.5, stock: 0,
      affiliateUrl: `https://vendor.example/${base}/${i + 1}?ref=fishtea`, imageUrl: `https://picsum.photos/seed/${base}${i}/480/480`,
    }));
  },
};
export default adapter;
