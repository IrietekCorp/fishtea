/** compute call `pricing.quote`: (campers) → totals with the sibling discount from rules.pricing */
export default function pricingQuote(input: { campers?: number }, ctx: { spec: any }) {
  const { perCamper, siblingDiscountPct } = ctx.spec.rules.pricing;
  const campers = Math.max(1, Math.floor(Number(input.campers ?? 1)));
  const siblingDiscount = Math.round(perCamper * (siblingDiscountPct / 100) * (campers - 1) * 100) / 100;
  const total = perCamper * campers - siblingDiscount;
  const note = campers > 1 ? `${siblingDiscountPct}% off each sibling after the first. Scholarships available.` : `Sibling discount: ${siblingDiscountPct}% off the second camper. Scholarships available.`;
  return { campers, each: perCamper, siblingDiscount, total, note };
}
