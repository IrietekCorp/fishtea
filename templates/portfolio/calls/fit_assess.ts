/** compute call `fit.assess`: honest fit against a described role. Rules decide the verdict; the model never does. */
export default function fitAssess(input: { role: string; skills: any[]; projects: any[] }, ctx: { spec: any }) {
  const rules = ctx.spec.rules.fit ?? {};
  const strongLevels: string[] = rules.strongLevels ?? ["strong", "expert"];
  const words = input.role.toLowerCase().split(/[^a-z0-9+#.]+/).filter((w) => w.length > 2);
  const strong = (input.skills ?? []).filter((s) => strongLevels.includes(s.level)).map((s) => ({ skill: s.name, level: s.level, years: s.years, evidence: s.evidence }));
  const weaker = (input.skills ?? []).filter((s) => !strongLevels.includes(s.level)).map((s) => ({ skill: s.name, level: s.level }));
  const covered = new Set([...strong, ...weaker].flatMap((s) => s.skill.toLowerCase().split(/[^a-z0-9+#.]+/)));
  const unmatched = [...new Set(words.filter((w) => !covered.has(w) && !STOP.has(w)))].slice(0, 6);
  const gaps = [...weaker.map((w) => ({ ...w, note: "not a strength yet" })), ...unmatched.map((w) => ({ skill: w, level: "none", note: "no evidence in the portfolio" }))];
  const good = strong.length >= Number(rules.minStrongForGoodFit ?? 3);
  const verdict = good ? `Strong fit on ${strong.length} counts (${strong.slice(0, 3).map((s) => s.skill).join(", ")}); ${gaps.length ? `gaps: ${gaps.slice(0, 3).map((g) => g.skill).join(", ")}` : "no gaps found"}.` : strong.length ? `Partial fit: ${strong.map((s) => s.skill).join(", ")} are strengths; the rest is a stretch.` : `Not an obvious fit from what's in the portfolio — ask about it directly.`;
  const askNext = gaps[0] ? `Ask: how have you handled ${gaps[0].skill}?` : `Ask: which of these projects is most like this role?`;
  return { verdict, strong, gaps, askNext };
}
const STOP = new Set(["the", "and", "for", "with", "our", "you", "who", "can", "will", "have", "has", "team", "role", "someone", "looking", "need", "want", "years", "experience", "senior", "junior", "strong", "good", "great", "work", "working"]);
