/**
 * Echoes, the part both sides need: which transport, handler and analytics event an echo uses for a
 * destination. Pure and dependency-free on purpose — the core imports it through @fishtea/spec and the
 * browser through the `@fishtea/echo` alias (packages/ui/vite.config.ts), the way present.ts is shared,
 * so a link is built by exactly the rule the core will judge it by. docs/ECHOES.md.
 */
import type { EchoCase, EchoDef, EchoVia } from "./spec.ts";
export type { EchoCase, EchoDef, EchoVia };

/** Only http(s) ever leaves through /echo: no javascript:, data:, or protocol-relative tricks. */
export function isWebUrl(u: unknown): u is string {
  if (typeof u !== "string" || u.length > 4096) return false;
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:"; } catch { return false; }
}

/** `*.example.com` matches example.com and any subdomain of it; a bare host matches itself and its www. */
export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, ""), p = pattern.toLowerCase();
  if (p.startsWith("*.")) { const base = p.slice(2); return h === base || h.endsWith(`.${base}`); }
  return h === p || h === `www.${p}`;
}

export interface EchoPlan { via: EchoVia; handler: string | null; analytics: string | null; case: number | null }

/** The echo's effective transport, handler and analytics event for this destination; the first matching case wins. */
export function planEcho(name: string, def: EchoDef, url: string): EchoPlan {
  let host = "";
  try { host = new URL(url).hostname; } catch { /* not a URL: no case can match */ }
  const i = host ? (def.cases ?? []).findIndex((c: EchoCase) => c.hosts.some((p) => hostMatches(host, p))) : -1;
  const c = i >= 0 ? def.cases![i] : undefined;
  const handler = c && c.handler !== undefined ? c.handler || null : def.handler ?? null;
  const analytics = c && c.analytics !== undefined ? c.analytics || null : def.analytics === false ? null : def.analytics ?? name;
  return { via: c?.via ?? def.via ?? "redirect", handler, analytics, case: i >= 0 ? i : null };
}
