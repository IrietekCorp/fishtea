/**
 * /admin's client: the core's operator surface, as a signed-in person reaches it. The session is an
 * httpOnly cookie the browser holds; this never sees it. Anything that changes state carries
 * x-fishtea-admin, which the core requires of a cookie'd change (a page on another site cannot set it).
 */
import { CORE } from "../lib/client";
import type { PresentTree } from "@fishtea/present";

/** Fired when the core stops accepting this browser's session, so the page can ask it to sign in again. */
export const SIGNED_OUT = "fishtea-admin-signed-out";

export class AdminError extends Error {
  constructor(message: string, public status: number, public body: any) { super(message); }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${CORE}/op${path}`, {
    method,
    credentials: "include",
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(method !== "GET" ? { "x-fishtea-admin": "1" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  // the session ended (expired, signed out elsewhere, password changed in another tab): back to sign-in
  if (res.status === 403 && (j.error === "sign in at /admin" || j.mustChange)) dispatchEvent(new Event(SIGNED_OUT));
  if (!res.ok) throw new AdminError(j.error ?? `core ${res.status}`, res.status, j);
  return j as T;
}

export interface Me { operator: { username: string } | null; mustChange?: boolean }
export const me = () => call<Me>("GET", "/auth/me").catch((e) => (e instanceof AdminError && e.status === 401 ? { operator: null } : Promise.reject(e)));
export const signIn = (username: string, password: string) => call<Me>("POST", "/auth/login", { username, password });
export const signOut = () => call<{ ok: true }>("POST", "/auth/logout", {});
export const changePassword = (current: string, next: string) => call<{ ok: true }>("POST", "/auth/password", { current, next });

export interface VisitorRow { id: string; customer_id: string | null; created_at: string; last_seen: string; trails: number; turns: number; tool: boolean | null; user_agent: string | null }
export const visitors = (o: { tools?: boolean; offset?: number } = {}) =>
  call<{ visitors: VisitorRow[] }>("GET", `/visitors?limit=50&offset=${o.offset ?? 0}${o.tools ? "&tools=include" : ""}`);

export interface SessionTurn { id: string; seq: number; author: string; at: string; shape: string | null; kind: string; confidence: number | null; answered: boolean; latencyMs: number | null; utterance: any; phrase?: string }
export interface Visit { id: string; current: boolean; openedAt: string; lastAt: string; headTurnId: string | null; envelope: Record<string, unknown>; turns: SessionTurn[] }
export const visitor = (id: string) => call<{ visitor: { id: string; known: boolean; firstSeen: string; lastSeen: string }; sessions: Visit[] }>("GET", `/visitors/${encodeURIComponent(id)}`);

export interface FullTurn extends SessionTurn { trailId: string; parentId: string | null; pour: any & { present?: PresentTree }; provenance: any }
export const turn = (id: string) => call<{ turn: FullTurn }>("GET", `/turns/${encodeURIComponent(id)}`);
export const unmet = (since = "7 days") => call<{ unmet: { at: string; asked: string; campaign: string | null; visitorId: string }[] }>("GET", `/unmet?since=${encodeURIComponent(since)}`);

export const specSource = () => call<{ text: string; hash: string; path: string }>("GET", "/spec/source");
export const saveSpec = (text: string, base: string) => call<{ ok: true; hash: string; version: string; migrationNeeded: boolean }>("PUT", "/spec/source", { text, base });
export const specHistory = () => call<{ history: string[] }>("GET", "/spec/history");
export const specVersion = (name: string) => call<{ name: string; text: string }>("GET", `/spec/history/${encodeURIComponent(name)}`);

export interface Setting { id: string; section: string; path: string; group: string; label: string; type: "string" | "text" | "number" | "boolean" | "enum"; values?: string[]; value: unknown }
export const settings = () => call<{ settings: Setting[] }>("GET", "/settings");
export const saveSettings = (changes: { id: string; value: unknown }[]) => call<{ ok: true; sections: string[]; settings: Setting[] }>("PATCH", "/settings", { changes });

export interface DataField { name: string; type: string; array: boolean; optional: boolean; values?: string[]; doc?: string }
export interface DataEntity { name: string; doc?: string; title: string; columns: string[]; order: string; collect?: string; fields: DataField[]; count: number }
export type DataRow = Record<string, unknown> & { id: string; $seeded: string[] };
export const dataEntities = () => call<{ entities: DataEntity[] }>("GET", "/data");
export const dataRows = (entity: string) => call<{ rows: DataRow[] }>("GET", `/data/${encodeURIComponent(entity)}`);
export const createRow = (entity: string, row: Record<string, unknown>) => call<{ row: DataRow }>("POST", `/data/${encodeURIComponent(entity)}`, { row });
export const updateRow = (entity: string, id: string, patch: Record<string, unknown>) => call<{ row: DataRow }>("PATCH", `/data/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`, { patch });
export const deleteRow = (entity: string, id: string) => call<{ ok: boolean }>("DELETE", `/data/${encodeURIComponent(entity)}/${encodeURIComponent(id)}`);
