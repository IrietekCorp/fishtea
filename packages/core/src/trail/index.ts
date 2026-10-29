/**
 * The conversation service (BLUEPRINT §6 "Trail operations").
 * A trail is an append-only tree of turns per visitor. Rewind moves the head; branch appends a child
 * to an older turn. Nothing is ever deleted.
 */
import { randomBytes } from "node:crypto";
import type { Db } from "../db/index.ts";
import type { TrailFact } from "../persona.ts";
import { EMBED_DIM } from "@fishtea/spec";

export type Author = "visitor" | "system" | "operator";
export type PourKind = "ask" | "form" | "confirm-write" | "answer" | "notification" | "composite";

export interface Turn {
  id: string; trailId: string; parentId: string | null; seq: number; author: Author; at: string;
  shape: string | null; kind: PourKind; confidence: number | null; answered: boolean; latencyMs: number | null;
  utterance: Record<string, unknown>; pour: Record<string, unknown>; provenance: Record<string, unknown>;
}
export interface Trail { id: string; visitorId: string; headTurnId: string | null; envelope: Record<string, unknown>; openedAt: string }

/**
 * Ids, and why this uses crypto randomness.
 *
 * A visitor id is not only a name — `visitorOf` in http.ts accepts it from a cookie *or* the
 * `x-fishtea-visitor` header, and whoever presents one gets that visitor's `customer_id`, and therefore
 * their persona, their cart and their orders. It is a bearer credential.
 *
 * It used to be `Date.now()` plus six characters of `Math.random()`: the time half is public, and the
 * random half is neither long enough nor unpredictable. `Math.random()` is a PRNG whose internal state
 * can be recovered from a handful of its own outputs, and an attacker can mint outputs on demand simply
 * by asking for new visitors. 96 bits from the platform CSPRNG costs nothing and removes the class.
 *
 * Existing ids keep working: this changes what new ones look like, not how they are read.
 */
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${randomBytes(12).toString("base64url")}`;

const rowTurn = (r: any): Turn => ({
  id: r.id, trailId: r.trail_id, parentId: r.parent_id, seq: r.seq, author: r.author, at: r.at instanceof Date ? r.at.toISOString() : r.at,
  shape: r.shape, kind: r.kind, confidence: r.confidence, answered: r.answered, latencyMs: r.latency_ms,
  utterance: r.utterance, pour: r.pour, provenance: r.provenance,
});
const rowTrail = (r: any): Trail => ({ id: r.id, visitorId: r.visitor_id, headTurnId: r.head_turn_id, envelope: r.envelope, openedAt: r.opened_at instanceof Date ? r.opened_at.toISOString() : r.opened_at });

export class TrailService {
  constructor(private db: Db) {}

  async ensureVisitor(id?: string | null): Promise<{ id: string; customerId: string | null; created: boolean }> {
    if (id) {
      const rows = await this.db`UPDATE conversation.visitor SET last_seen = now() WHERE id = ${id} RETURNING id, customer_id`;
      if (rows.length) return { id, customerId: rows[0].customer_id, created: false };
    }
    const vid = newId("v");
    await this.db`INSERT INTO conversation.visitor (id) VALUES (${vid})`;
    return { id: vid, customerId: null, created: true };
  }

  async visitor(id: string): Promise<{ id: string; customerId: string | null } | null> {
    const rows = await this.db`SELECT id, customer_id FROM conversation.visitor WHERE id = ${id}`;
    return rows.length ? { id: rows[0].id, customerId: rows[0].customer_id } : null;
  }

  /** A visitor as a record: when they were first and last seen. */
  async visitorRecord(id: string): Promise<{ id: string; customerId: string | null; createdAt: string; lastSeen: string } | null> {
    const rows = await this.db`SELECT id, customer_id, created_at, last_seen FROM conversation.visitor WHERE id = ${id}`;
    if (!rows.length) return null;
    const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d));
    return { id: rows[0].id, customerId: rows[0].customer_id, createdAt: iso(rows[0].created_at), lastSeen: iso(rows[0].last_seen) };
  }

  /** A visitor's trails — one per visit, see `acquireTrail` — newest first. */
  async byVisitor(visitorId: string, limit = 20): Promise<Trail[]> {
    const rows = await this.db`SELECT * FROM conversation.trail WHERE visitor_id = ${visitorId} ORDER BY opened_at DESC LIMIT ${limit}`;
    return rows.map(rowTrail);
  }

  /**
   * Visitors only tooling ever produced: every visit they made carries `envelope.tool` (or, from before
   * there was one, the `headless` campaign). One visit from a person keeps the visitor.
   */
  async toolVisitors(): Promise<{ id: string; tools: string[]; visits: number; turns: number; lastSeen: string }[]> {
    const rows = await this.db`
      SELECT v.id, v.last_seen,
             array_agg(DISTINCT coalesce(t.envelope->>'tool', 'headless')) AS tools,
             count(DISTINCT t.id)::int AS visits,
             (SELECT count(*)::int FROM conversation.turn u JOIN conversation.trail tt ON tt.id = u.trail_id WHERE tt.visitor_id = v.id) AS turns
      FROM conversation.visitor v JOIN conversation.trail t ON t.visitor_id = v.id
      GROUP BY v.id
      -- coalesce: a person's visit has no campaign, and NULL would slip through bool_and
      HAVING bool_and(t.envelope ? 'tool' OR coalesce(t.envelope->>'utm_campaign' = 'headless', false))
      ORDER BY v.last_seen DESC`;
    return rows.map((r: any) => ({ id: r.id, tools: r.tools, visits: r.visits, turns: r.turns, lastSeen: r.last_seen instanceof Date ? r.last_seen.toISOString() : String(r.last_seen) }));
  }

  /** Delete visitors and everything they said, in one transaction. */
  async deleteVisitors(ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    return this.db.begin(async (tx: any) => {
      await tx`DELETE FROM conversation.turn WHERE trail_id IN (SELECT id FROM conversation.trail WHERE visitor_id = ANY(${ids}))`;
      await tx`DELETE FROM conversation.pending_notification WHERE visitor_id = ANY(${ids})`;
      await tx`DELETE FROM conversation.trail WHERE visitor_id = ANY(${ids})`;
      const gone = await tx`DELETE FROM conversation.visitor WHERE id = ANY(${ids}) RETURNING id`;
      return gone.length;
    });
  }

  async open(visitorId: string, envelope: Record<string, unknown>): Promise<Trail> {
    const id = newId("t");
    const rows = await this.db`INSERT INTO conversation.trail (id, visitor_id, envelope) VALUES (${id}, ${visitorId}, ${this.db.json(envelope as any)}) RETURNING *`;
    return rowTrail(rows[0]);
  }

  async latest(visitorId: string): Promise<Trail | null> {
    const rows = await this.db`SELECT * FROM conversation.trail WHERE visitor_id = ${visitorId} ORDER BY opened_at DESC LIMIT 1`;
    return rows.length ? rowTrail(rows[0]) : null;
  }

  async get(trailId: string): Promise<Trail | null> {
    const rows = await this.db`SELECT * FROM conversation.trail WHERE id = ${trailId}`;
    return rows.length ? rowTrail(rows[0]) : null;
  }

  async head(trailId: string): Promise<Turn | null> {
    const rows = await this.db`SELECT t.* FROM conversation.trail tr JOIN conversation.turn t ON t.id = tr.head_turn_id WHERE tr.id = ${trailId}`;
    return rows.length ? rowTurn(rows[0]) : null;
  }

  async turn(turnId: string): Promise<Turn | null> {
    const rows = await this.db`SELECT * FROM conversation.turn WHERE id = ${turnId}`;
    return rows.length ? rowTurn(rows[0]) : null;
  }

  /** Path from head back toward the root, newest first, at most k turns. */
  async path(trailId: string, k = 6, fromTurnId?: string | null): Promise<Turn[]> {
    const rows = await this.db`
      WITH RECURSIVE up AS (
        SELECT t.*, 0 AS depth FROM conversation.turn t
        WHERE t.id = coalesce(${fromTurnId ?? null}::text, (SELECT head_turn_id FROM conversation.trail WHERE id = ${trailId}))
        UNION ALL
        SELECT p.*, up.depth + 1 FROM conversation.turn p JOIN up ON p.id = up.parent_id WHERE up.depth < ${k - 1}
      )
      SELECT * FROM up ORDER BY depth`;
    return rows.map(rowTurn);
  }

  /** Every turn on the head path (for persona derivation), oldest first. */
  async facts(trailId: string): Promise<TrailFact[]> {
    const turns = await this.path(trailId, 500);
    return turns.reverse().map((t) => ({
      shape: t.shape, at: new Date(t.at), author: t.author, answered: t.answered,
      calls: ((t.provenance as any)?.calls ?? []).map((c: any) => c.call ?? c),
      wrote: (t.provenance as any)?.wrote ?? [],
    }));
  }

  /** All turns of a trail (tree view for the UI and the TUI). */
  async turns(trailId: string): Promise<Turn[]> {
    const rows = await this.db`SELECT * FROM conversation.turn WHERE trail_id = ${trailId} ORDER BY seq`;
    return rows.map(rowTurn);
  }

  async append(trailId: string, turn: Omit<Turn, "id" | "trailId" | "seq" | "at" | "parentId"> & { parentId?: string | null; embedding?: number[] | null }): Promise<Turn> {
    const id = newId("u");
    const trail = await this.get(trailId);
    if (!trail) throw new Error(`trail ${trailId} not found`);
    const parentId = turn.parentId === undefined ? trail.headTurnId : turn.parentId;
    const seqRows = await this.db`SELECT coalesce(max(seq), 0) + 1 AS seq FROM conversation.turn WHERE trail_id = ${trailId}`;
    const seq = Number(seqRows[0].seq);
    const emb = turn.embedding && turn.embedding.length === EMBED_DIM ? `[${turn.embedding.join(",")}]` : null;
    const rows = await this.db`
      INSERT INTO conversation.turn (id, trail_id, parent_id, seq, author, shape, kind, confidence, answered, latency_ms, utterance, pour, provenance, embedding)
      VALUES (${id}, ${trailId}, ${parentId}, ${seq}, ${turn.author}, ${turn.shape}, ${turn.kind}, ${turn.confidence}, ${turn.answered}, ${turn.latencyMs},
              ${this.db.json(turn.utterance as any)}, ${this.db.json(turn.pour as any)}, ${this.db.json(turn.provenance as any)}, ${emb}::halfvec)
      RETURNING *`;
    await this.db`UPDATE conversation.trail SET head_turn_id = ${id} WHERE id = ${trailId}`;
    return rowTurn(rows[0]);
  }

  /** Move the head to an earlier turn. Nothing is deleted; the next append branches from there. */
  async rewind(trailId: string, turnId: string): Promise<Turn> {
    const t = await this.turn(turnId);
    if (!t || t.trailId !== trailId) throw new Error("turn not in this trail");
    await this.db`UPDATE conversation.trail SET head_turn_id = ${turnId} WHERE id = ${trailId}`;
    return t;
  }

  /** Turns from this visitor's *other* trails whose utterance resonates with the embedding (§7 familiarity). */
  /**
   * Replace a turn's pour once a streamed composite has finished arriving.
   *
   * Not a hole in "append-only": no turn is added, removed or reordered, and the trail's shape is
   * untouched. A streamed turn is *one* turn whose content lands in pieces, and this is the moment it
   * stops being partial — without it, resuming would show the lead and none of the parts that were
   * actually on screen.
   */
  async settle(turnId: string, pour: Record<string, unknown>, provenance: Record<string, unknown>): Promise<void> {
    await this.db`UPDATE conversation.turn
      SET pour = ${this.db.json(pour as any)}, provenance = ${this.db.json(provenance as any)}
      WHERE id = ${turnId}`;
  }

  async recall(visitorId: string, embedding: number[], threshold: number, excludeTrailId?: string, limit = 3): Promise<(Turn & { similarity: number })[]> {
    if (!embedding?.length || embedding.length !== EMBED_DIM) return [];
    const vec = `[${embedding.join(",")}]`;
    const rows = await this.db`
      SELECT t.*, 1 - (t.embedding <=> ${vec}::halfvec) AS similarity
      FROM conversation.turn t JOIN conversation.trail tr ON tr.id = t.trail_id
      WHERE tr.visitor_id = ${visitorId} AND t.author = 'visitor' AND t.embedding IS NOT NULL
        AND tr.id <> coalesce(${excludeTrailId ?? null}::text, '')
        AND 1 - (t.embedding <=> ${vec}::halfvec) >= ${threshold}
      ORDER BY t.embedding <=> ${vec}::halfvec
      LIMIT ${limit}`;
    return rows.map((r) => ({ ...rowTurn(r), similarity: Number(r.similarity) }));
  }

  async unmet(since = "7 days"): Promise<Record<string, unknown>[]> {
    const m = since.match(/^(\d+)\s*(d|h|m|days?|hours?|minutes?)$/);
    const interval = m ? `${m[1]} ${({ d: "days", h: "hours", m: "minutes" } as any)[m[2][0]]}` : since;
    return this.db.unsafe(`SELECT asked, campaign, customer_id AS "customerId", visitor_id AS "visitorId", at FROM conversation.unmet WHERE at > now() - $1::interval ORDER BY at DESC LIMIT 200`, [interval]) as any;
  }

  /**
   * What visitors actually said, paired with the shape it resolved to: an application's own
   * labelled data, which it accumulates simply by being used.
   *
   * Only turns that *worked* count as labels — answered, above the floor the engine applied at the
   * time, and carrying a shape. A turn the gate refused or the classifier gave up on is not a label
   * for the shape it guessed; it is a label for nothing, which is why `unmet()` is the other half and
   * is read separately as negatives.
   *
   * Confirmed writes are the strongest label in the trail. The visitor was shown what was about to
   * happen and said yes, so the shape is right by construction rather than by the classifier's
   * opinion of itself.
   */
  async labelled(o: { since?: string; limit?: number; minConfidence?: number } = {}): Promise<{ text: string; shape: string; persona: string | null; confidence: number | null; confirmed: boolean }[]> {
    const m = (o.since ?? "90 days").match(/^(\d+)\s*(d|h|m|days?|hours?|minutes?)$/);
    const interval = m ? `${m[1]} ${({ d: "days", h: "hours", m: "minutes" } as any)[m[2][0]]}` : (o.since ?? "90 days");
    const limit = Math.min(Math.max(Number(o.limit ?? 2000), 1), 20000);
    const floor = Number(o.minConfidence ?? 0);
    return this.db.unsafe(
      `SELECT DISTINCT ON (lower(t.utterance->>'text'), t.shape)
              t.utterance->>'text'            AS text,
              t.shape                         AS shape,
              t.utterance->>'persona'         AS persona,
              t.confidence                    AS confidence,
              (t.kind = 'confirm-write')      AS confirmed
         FROM conversation.turn t
        WHERE t.at > now() - $1::interval
          AND t.shape IS NOT NULL
          AND t.answered
          AND t.utterance->>'text' IS NOT NULL
          AND length(trim(t.utterance->>'text')) > 1
          AND coalesce(t.confidence, 1) >= $2
        ORDER BY lower(t.utterance->>'text'), t.shape, (t.kind = 'confirm-write') DESC, t.at DESC
        LIMIT $3`,
      [interval, floor, limit],
    ) as any;
  }

  /**
   * The action log: every turn, newest first, with what it did and whether it worked.
   *
   * Borrowed in spirit from json-render's devtools, which log the actions a spec fires. The difference
   * is where the data comes from — theirs is a client-side recorder, ours is the trail, which already
   * holds every turn with its provenance because that is what the trail is for. So this is a query.
   *
   * The refusals are the point. A log of what succeeded tells you less than one showing where the gate
   * turned somebody away, where the classifier gave up, and where a plan failed.
   */
  async actions(o: { since?: string; limit?: number; visitorId?: string } = {}): Promise<Record<string, unknown>[]> {
    const m = (o.since ?? "24h").match(/^(\d+)\s*(d|h|m|days?|hours?|minutes?)$/);
    const interval = m ? `${m[1]} ${({ d: "days", h: "hours", m: "minutes" } as any)[m[2][0]]}` : (o.since ?? "24 hours");
    const limit = Math.min(Math.max(Number(o.limit ?? 100), 1), 500);
    return this.db.unsafe(
      `SELECT t.id, t.seq, t.at, t.trail_id AS "trailId", tr.visitor_id AS "visitorId",
              t.author, t.shape, t.kind, t.confidence, t.answered, t.latency_ms AS "latencyMs",
              t.utterance -> 'persona'              AS persona,
              t.provenance -> 'calls'               AS calls,
              t.provenance -> 'read'                AS read,
              t.provenance -> 'wrote'               AS wrote,
              t.provenance ->> 'unmet'              AS unmet,
              t.provenance -> 'classifier' ->> 'name' AS classifier
         FROM conversation.turn t
         JOIN conversation.trail tr ON tr.id = t.trail_id
        WHERE t.at > now() - $1::interval
          AND ($2::text IS NULL OR tr.visitor_id = $2::text)
        ORDER BY t.at DESC
        LIMIT $3`,
      [interval, o.visitorId ?? null, limit],
    ) as any;
  }

  // ── notifications ────────────────────────────────────────────────────────
  async enqueueNotification(visitorId: string, n: { author: "system" | "operator"; name?: string; text: string; next?: unknown[] }): Promise<string> {
    const id = newId("n");
    await this.db`INSERT INTO conversation.pending_notification (id, visitor_id, author, name, text, next) VALUES (${id}, ${visitorId}, ${n.author}, ${n.name ?? null}, ${n.text}, ${this.db.json((n.next ?? []) as any)})`;
    return id;
  }

  async pendingNotifications(visitorId: string): Promise<{ id: string; author: "system" | "operator"; name: string | null; text: string; next: unknown[]; at: string }[]> {
    const rows = await this.db`SELECT * FROM conversation.pending_notification WHERE visitor_id = ${visitorId} AND delivered_at IS NULL ORDER BY at`;
    return rows.map((r) => ({ id: r.id, author: r.author, name: r.name, text: r.text, next: r.next, at: r.at instanceof Date ? r.at.toISOString() : r.at }));
  }

  async markDelivered(ids: string[]) {
    if (ids.length) await this.db`UPDATE conversation.pending_notification SET delivered_at = now() WHERE id = ANY(${ids})`;
  }
}
