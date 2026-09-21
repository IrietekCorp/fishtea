/**
 * The client (BLUEPRINT §10): utter(), resume(), SSE subscribe, visitor token. Sequence numbers so a stale
 * pour never overwrites a newer one. Holds no business logic and no state except the visitor token.
 */
export const CORE = (import.meta.env.VITE_CORE_URL as string | undefined) ?? "http://localhost:3000";
const KEY = "fishtea_visitor";

export type Utterance = { text: string } | { shape: string; args?: Record<string, unknown>; submit?: boolean; confirm?: boolean } | { arrive: true };
export interface Chip { label: string; shape: string; args?: Record<string, unknown>; gated?: boolean }
export interface Field { name: string; label: string; type: string; required: boolean; array: boolean; default?: unknown; enumValues?: string[]; doc?: string; min?: number; max?: number }
export type Pour =
  | { kind: "ask"; phrase: string; hint?: string; shape?: string; fields?: Field[]; options: Chip[]; reason: string; classifier?: any }
  | { kind: "form"; shape: string; phrase: string; hint?: string; fields: Field[]; known: Record<string, unknown>; errors?: Record<string, string>; error?: string; options?: Chip[]; classifier?: any }
  | { kind: "confirm-write"; shape: string; phrase: string; summary: string; fields: Field[]; known: Record<string, unknown>; classifier?: any }
  | { kind: "answer"; shape: string; phrase: string; vessel: "list" | "card" | "detail" | "compare" | "timeline" | "confirm"; answer: any; next: Chip[]; provenance: any; classifier?: any; stale?: boolean }
  | { kind: "notification"; author: string; name?: string | null; text: string; next: Chip[] };
export interface Response { pour: Pour; turn: { id: string; seq: number; trailId: string; parentId: string | null }; visitor: { id: string; created: boolean }; persona: string; understood?: { shape: string; confidence: number; phrase: string }; notifications: Pour[]; timings: { classifyMs: number; planMs: number; totalMs: number }; classifier: string }

export const visitorId = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const remember = (id: string) => { try { localStorage.setItem(KEY, id); } catch {} };
const headers = () => { const v = visitorId(); return { "content-type": "application/json", ...(v ? { "x-fishtea-visitor": v } : {}) }; };

let seq = 0;
export async function utter(u: Utterance, opts: { branchFrom?: string | null } = {}): Promise<Response | null> {
  const mine = ++seq;
  const res = await fetch(`${CORE}/utter`, { method: "POST", headers: headers(), credentials: "include", body: JSON.stringify({ ...u, branchFrom: opts.branchFrom ?? undefined }) });
  const j = (await res.json()) as Response;
  if (mine !== seq) return null; // a newer utterance is in flight: drop this stale pour
  if (j.visitor?.id) remember(j.visitor.id);
  return j;
}
export async function resume(): Promise<Response> {
  const q = new URLSearchParams(location.search);
  const res = await fetch(`${CORE}/?${q}`, { headers: headers(), credentials: "include" });
  const j = (await res.json()) as Response;
  if (j.visitor?.id) remember(j.visitor.id);
  return j;
}
export async function trail() { const res = await fetch(`${CORE}/trail`, { headers: headers(), credentials: "include" }); return res.json() as Promise<{ trail: any; turns: any[] }>; }
export async function rewind(turnId: string) { const res = await fetch(`${CORE}/trail/rewind`, { method: "POST", headers: headers(), credentials: "include", body: JSON.stringify({ turnId }) }); return res.json(); }

export function subscribe(onEvent: (type: string, data: any) => void): () => void {
  const v = visitorId();
  if (!v) return () => {};
  const es = new EventSource(`${CORE}/events?visitor=${v}`, { withCredentials: true });
  for (const t of ["notification", "turn", "reload", "ping"]) es.addEventListener(t, (e) => { try { onEvent(t, JSON.parse((e as MessageEvent).data)); } catch {} });
  return () => es.close();
}
