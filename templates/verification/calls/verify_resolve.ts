/** compute call `verify.resolve`: attestation + engagement on file + the claim → status and the *minimal* result for the purpose. */
export default function verifyResolve(input: { request: any; attestation: any; engagement: any }, ctx: { spec: any }) {
  const rules = ctx.spec.rules;
  const req = input.request;
  if (!req) throw new Error("request not found");
  const purpose = String(req.purpose ?? "other");
  const fields: string[] = rules.disclosure?.fieldsByPurpose?.[purpose] ?? rules.disclosure?.fieldsByPurpose?.other ?? ["datesMatch"];
  const eng = input.engagement && typeof input.engagement === "object" ? input.engagement : null;
  if (!input.attestation?.confirms) return { status: "declined", result: pick({ confirmed: false, note: input.attestation?.note ?? "Verifier did not confirm" }, ["confirmed", "note"]) };
  const titleMatches = eng && req.claimTitle ? String(eng.title).toLowerCase().includes(String(req.claimTitle).toLowerCase()) : eng ? null : null;
  const datesMatch = eng && (req.claimStart || req.claimEnd) ? withinMonths(req.claimStart, eng.startDate, 2) && (req.claimEnd ? withinMonths(req.claimEnd, eng.endDate, 2) : true) : eng ? null : null;
  const current = eng ? eng.status === "current" && !eng.endDate : null;
  const all = { confirmed: true, titleMatches, datesMatch, current, note: input.attestation.note ?? null };
  for (const k of rules.disclosure?.neverDisclose ?? []) delete (all as any)[k];
  return { status: "verified", result: pick(all, ["confirmed", ...fields, "note"]) };
}
const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
function withinMonths(a?: string | null, b?: string | null, months = 2): boolean | null {
  if (!a || !b) return a || b ? false : null;
  const d = Math.abs(new Date(a).getTime() - new Date(b).getTime()) / (30 * 86400e3);
  return d <= months;
}
