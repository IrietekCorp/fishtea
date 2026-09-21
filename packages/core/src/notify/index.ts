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

export type { Chip };
