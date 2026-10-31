/**
 * Echoes (docs/ECHOES.md): what a visitor did with an answer that leaves the conversation.
 *
 * The conversation is the only thing that may vouch for a destination. `/echo` accepts a URL only when the
 * turn it names actually published that URL in its answer — so it is never an open redirect, and it needs
 * no signing secret, because the trail is the signature. The record the URL was found in travels to the
 * handler, which is how a handler knows which product, vendor or document was followed without the
 * browser being trusted to say so.
 *
 * Pure functions here; the engine (Engine.echo) does the reading and writing.
 */
import type { EchoVia, Spec } from "@fishtea/spec";
export { isWebUrl, hostMatches, planEcho, type EchoPlan } from "@fishtea/spec";

/**
 * Where in an answer a URL was published: the innermost object holding it as a value (a product row, a
 * link molecule), or null when the answer never said it. Matching is exact on the string — a URL that
 * differs by one parameter was not published.
 */
export function locate(pour: unknown, url: string): Record<string, unknown> | null {
  const found: { holder: Record<string, unknown> | null } = { holder: null };
  const walk = (v: unknown, holder: Record<string, unknown> | null, depth: number): boolean => {
    if (depth > 64) return false;
    if (typeof v === "string") { if (v === url) { found.holder = holder; return true; } return false; }
    if (Array.isArray(v)) { for (const x of v) if (walk(x, holder, depth + 1)) return true; return false; }
    if (v && typeof v === "object") {
      for (const x of Object.values(v as Record<string, unknown>)) if (walk(x, v as Record<string, unknown>, depth + 1)) return true;
    }
    return false;
  };
  return walk(pour, null, 0) ? found.holder ?? {} : null;
}

/** The published echo vocabulary a shell needs to build links: no handlers, nothing private. */
export function echoManifest(spec: Spec): Record<string, { via: EchoVia; analytics: string | null; cases: { hosts: string[]; via?: EchoVia; analytics: string | null | undefined }[] }> {
  const out: ReturnType<typeof echoManifest> = {};
  for (const [name, def] of Object.entries(spec.echoes ?? {})) {
    if (name === "version" || name === "doc" || !def || typeof def !== "object") continue;
    out[name] = {
      via: def.via ?? "redirect",
      analytics: def.analytics === false ? null : def.analytics ?? name,
      cases: (def.cases ?? []).map((c) => ({ hosts: c.hosts, via: c.via, analytics: c.analytics === undefined ? undefined : c.analytics || null })),
    };
  }
  return out;
}

/** What a handler is given. Everything here came from the trail, not from the browser, except `to`. */
export interface EchoHandlerInput {
  echo: string; echoId: string; to: string; via: EchoVia;
  record: Record<string, unknown>; turnId: string; shape: string | null;
  persona: string; shared: boolean;
}
/** What a handler may answer. Anything else is ignored; a non-web `location` is refused, not followed. */
export interface EchoHandlerOutput { location?: string | null; data?: Record<string, unknown> | null }

export type EchoOutcome =
  | { status: "followed"; echoId: string; location: string; via: EchoVia; analytics: string | null; recorded: true }
  | { status: "passed"; location: string; via: EchoVia; analytics: null; recorded: false; reason: string }
  | { status: "refused"; reason: string };
