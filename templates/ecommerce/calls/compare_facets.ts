/** compute call `compare.facets`: (products[]) → { left, right, facets } — facets from the fields both share. */
export default function compareFacets(input: { products: any[] }) {
  const [left, right] = input.products ?? [];
  if (!left || !right) throw new Error("compare needs two products that exist");
  const facet = (label: string, l: unknown, r: unknown) => ({ label, left: l ?? "—", right: r ?? "—", same: JSON.stringify(l) === JSON.stringify(r) });
  const facets = [facet("Price", left.price, right.price), facet("Brand", left.brand, right.brand), facet("Category", left.category, right.category), facet("Tags", (left.tags ?? []).join(", "), (right.tags ?? []).join(", ")), facet("Availability", left.stock > 0 ? `${left.stock} in stock` : left.affiliateUrl ? "at vendor" : "out", right.stock > 0 ? `${right.stock} in stock` : right.affiliateUrl ? "at vendor" : "out")];
  for (const k of new Set([...Object.keys(left.attributes ?? {}), ...Object.keys(right.attributes ?? {})])) facets.push(facet(k[0].toUpperCase() + k.slice(1), Array.isArray(left.attributes?.[k]) ? left.attributes[k].join(", ") : left.attributes?.[k], Array.isArray(right.attributes?.[k]) ? right.attributes[k].join(", ") : right.attributes?.[k]));
  return { left, right, facets };
}
