/**
 * The menu's trail as a reference rather than a replay (see useConversation): newest first, each place once
 * at its latest visit, at most `max` of them (12), none older than `hours` (24). A place is the words typed
 * (in any case and spacing) or, for a click, the shape and its arguments in any order. Pure, so it can be
 * tested without a page.
 */
export interface TrailPoint {
  turnId: string; step: number; typed: boolean; said?: string; shape?: string; at: string;
  route: { shape?: string; args?: Record<string, unknown> };
}

export const trailLimits = (o: { max?: number; hours?: number } = {}) => ({
  max: Math.max(1, Number(o.max ?? 12) || 12),
  hours: Math.max(0.1, Number(o.hours ?? 24) || 24),
});

export const placeOf = (k: TrailPoint) => k.typed && k.said
  ? `said:${k.said.toLowerCase().replace(/\s+/g, " ").trim()}`
  : `at:${JSON.stringify([k.route.shape ?? k.shape ?? "", Object.entries(k.route.args ?? {}).map(([a, v]) => [a, String(v)]).sort()])}`;

/** From points in the order they happened, the trail as shown. Steps count from the newest. */
export function tidy<T extends TrailPoint>(cs: T[], limits: { max?: number; hours?: number } = {}, now = Date.now()): T[] {
  const { max, hours } = trailLimits(limits);
  const seen = new Set<string>(), out: T[] = [];
  for (let i = cs.length - 1; i >= 0 && out.length < max; i--) {
    const k = cs[i]!, key = placeOf(k);
    if (seen.has(key)) continue;
    seen.add(key);
    if (now - new Date(k.at).getTime() > hours * 3600e3) continue;
    out.push(k);
  }
  return out.map((k, i) => ({ ...k, step: i + 1 }));
}
