/**
 * Notifications are turns (BLUEPRINT D11). Authored by system or operator, queued per visitor, delivered
 * over SSE when the visitor is connected and folded into the trail as `notification` turns on resume.
 */
import type { Chip } from "../pour.ts";

export interface Event { type: "turn" | "notification" | "ping" | "reload"; data: unknown }
type Listener = (e: Event) => void;

export class Hub {
  private listeners = new Map<string, Set<Listener>>();
  subscribe(visitorId: string, fn: Listener): () => void {
    if (!this.listeners.has(visitorId)) this.listeners.set(visitorId, new Set());
    this.listeners.get(visitorId)!.add(fn);
    return () => { this.listeners.get(visitorId)?.delete(fn); };
  }
  connected(visitorId: string): boolean { return (this.listeners.get(visitorId)?.size ?? 0) > 0; }
  publish(visitorId: string, e: Event) { for (const fn of this.listeners.get(visitorId) ?? []) { try { fn(e); } catch {} } }
  broadcast(e: Event) { for (const [, set] of this.listeners) for (const fn of set) { try { fn(e); } catch {} } }
  get size() { let n = 0; for (const s of this.listeners.values()) n += s.size; return n; }
}

/** Render a notification template: "{order.id} shipped" with args; next[] args resolved. */
export function renderNotification(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_.]*)\}/g, (_: string, path: string) => {
    const v = path.split(".").reduce<any>((o: any, p: string) => (o == null ? undefined : o[p]), args);
    return v == null ? "" : String(v);
  });
}

/**
 * A notification on its way to someone who is not looking at the page.
 *
 * The in-browser path is the Hub: a connected visitor gets the turn over SSE and there is nothing to
 * deliver. A channel exists for the other case — the visitor has gone, and "your order shipped" is only
 * true if it reaches them. So a channel is handed the rendered text, the chips that would have been
 * offered, and whatever the framework knows about how to address this person.
 */
export interface Outbound {
  /** the queued notification's id, so a channel can be idempotent about retries */
  id: string;
  visitorId: string;
  text: string;
  /** the spec notification's name, absent when an operator typed it */
  name?: string;
  author: "system" | "operator";
  next: Chip[];
  /**
   * How to reach them, as far as the framework knows. `email` is null for a visitor who never became
   * known — which is not an error: a channel that cannot address someone says so and the notification
   * stays queued for their next visit, exactly as it did before there were channels.
   */
  to: { email: string | null; customerId: string | null };
}

export interface Channel {
  readonly name: string;
  deliver(n: Outbound): Promise<{ ok: boolean; detail?: string }>;
}

export type { Chip };
