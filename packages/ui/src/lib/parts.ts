/**
 * Composites arrive in pieces: the lead with the response, each part after it over /events. Both the
 * framework's container and the sections shell fold them in with this, so the two cannot drift apart.
 */
import type { Pour } from "./client";

/** What /events carries for a composite: a `part` (one part landing) or `settled` (nothing more is coming). */
export type StreamedPart = { turnId: string; _settled: true } | { turnId: string; id: string; part: any; _settled?: false };

/**
 * Fold one streamed part (or the settled marker) into a composite pour.
 *
 * Pure, because it is applied from two places: live, when the part arrives after its response, and
 * replayed, when it arrived before. A flat parts map is what makes this a merge rather than a rebuild.
 */
export function patchPart(pour: Pour, d: StreamedPart): Pour {
  if (pour.kind !== "composite") return pour;
  const next = { ...pour, parts: { ...pour.parts }, pending: [...(pour.pending ?? [])] };
  if (d._settled) { next.pending = []; return next; }          // whatever has not arrived is not coming

  // Idempotent, because the same part can be folded in more than once: React invokes a state updater
  // twice under StrictMode, an SSE stream can redeliver after a reconnect, and a part buffered before
  // its response could otherwise be applied on top of one already there. Caught by a browser test
  // counting three verify strips for a two-part composite.
  if (next.parts[d.id]) return pour;

  next.parts[d.id] = d.part;
  const root = next.parts[next.root];
  if (root && !(root.children ?? []).includes(d.id)) next.parts[next.root] = { ...root, children: [...(root.children ?? []), d.id] };
  next.pending = next.pending.filter((n) => n !== d.id);
  const chips = d.part?.of?.next ?? [];
  next.next = [...next.next, ...chips.filter((c: any) => !next.next.some((x) => x.shape === c.shape && JSON.stringify(x.args ?? {}) === JSON.stringify(c.args ?? {})))];
  if (d.part?.of?.provenance) next.provenance = [...next.provenance, d.part.of.provenance];
  return next;
}
