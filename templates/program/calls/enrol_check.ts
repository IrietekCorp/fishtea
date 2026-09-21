/** compute call `enrol.check`: the rules the classifier never sees. Throws when the ground refuses. */
export default function enrolCheck(input: { session: any; age: number; familyId: string; existingCount: number }, ctx: { spec: any }) {
  const rules = ctx.spec.rules;
  if (!input.session) throw new Error("That camp week doesn't exist or isn't open.");
  const min = input.session.ageMin ?? rules.program.ageMin, max = input.session.ageMax ?? rules.program.ageMax;
  if (input.age < min || input.age > max) throw new Error(`${input.session.name} is for ages ${min} to ${max}.`);
  const price = Number(input.session.price ?? rules.pricing.perCamper);
  const siblingDiscount = input.existingCount > 0 ? round(price * (rules.pricing.siblingDiscountPct / 100)) : 0;
  const status = Number(input.session.spotsLeft ?? 1) <= 0 ? "waitlisted" : "confirmed";
  return { ok: true, price: round(price - siblingDiscount), siblingDiscount, status };
}
const round = (n: number) => Math.round(n * 100) / 100;
