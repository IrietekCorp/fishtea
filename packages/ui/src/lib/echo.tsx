/**
 * Echo links (docs/ECHOES.md): an outbound link that reports itself to the conversation it came from.
 *
 * The page's <head> carries the application's echoes as `window.__fishteaEchoes` — transport, analytics
 * name and host cases only; a handler's name never reaches the browser. `planEcho` is the same function
 * the core judges an echo by (@fishtea/echo is @fishtea/spec's echo.ts), so the link a page draws and the
 * outcome the core gives it cannot disagree about which case applies.
 *
 *   redirect  href is `${CORE}/echo?…`; the core records it and answers 302.
 *   beacon    href is the destination itself; a click reports it with navigator.sendBeacon.
 *
 * Either way a click also reports the echo's analytics event to gtag, which exists only once the visitor
 * accepted analytics (consent.tsx) — so declining is honoured without a check here. `transport_type:
 * "beacon"` lets the event survive the page leaving.
 *
 * With no echoes declared, no turn to name, or a destination that is not http(s), this is an ordinary
 * link: echoing is something an application opts into, never a way for a page to lose its links.
 */
import { createContext, useContext, type AnchorHTMLAttributes, type ReactNode } from "react";
import { isWebUrl, planEcho, type EchoDef } from "@fishtea/echo";
import { CORE, visitorId } from "./client";

/**
 * The turn on screen, for links drawn deep inside a vessel that knows nothing of turns (a `*Url` field,
 * a molecule). The container and a shell provide it where they draw a turn.
 */
export const EchoTurn = createContext<string | null>(null);
export const useEchoTurn = () => useContext(EchoTurn);

type Manifest = Record<string, Pick<EchoDef, "via" | "analytics" | "cases">>;
const manifest = (): Manifest | null => (typeof window !== "undefined" ? ((window as any).__fishteaEchoes ?? null) : null);

export interface EchoOptions {
  /** the turn whose answer published this link */
  turnId?: string | null;
  /** which echo (spec `echoes.<name>`); default "outbound" */
  echo?: string;
  /** a paid link: adds rel="sponsored", which affiliate programmes and search engines ask of one */
  sponsored?: boolean;
  /** extra analytics parameters (GA4 naming), e.g. { item_id, item_brand } */
  params?: Record<string, string | number | boolean | null | undefined>;
}

export interface EchoAnchorProps {
  href: string; target: "_blank"; rel: string;
  onClick?: () => void; onAuxClick?: (e: { button: number }) => void;
  "data-echo"?: string;
}

function report(name: string | null, to: string, echo: string, params: EchoOptions["params"]) {
  const gtag = typeof window !== "undefined" ? (window as any).gtag : undefined;
  if (!name || typeof gtag !== "function") return;
  let domain = "";
  try { domain = new URL(to).hostname; } catch { /* isWebUrl already said yes */ }
  gtag("event", name, { link_url: to, link_domain: domain, outbound: true, echo, transport_type: "beacon", ...(params ?? {}) });
}

/**
 * The anchor attributes for an outbound link to `to`, or null when `to` is not a link at all (draw no
 * anchor). Spread them onto an <a>.
 */
export function echoLink(to: string | null | undefined, o: EchoOptions = {}): EchoAnchorProps | null {
  if (!to) return null;
  if (!isWebUrl(to)) return /^(mailto|tel):/i.test(to) ? { href: to, target: "_blank", rel: "noopener" } : null;
  const echo = o.echo ?? "outbound";
  const rel = `noopener${o.sponsored ? " sponsored" : ""}`;
  const def = manifest()?.[echo];
  if (!def || !o.turnId) return { href: to, target: "_blank", rel };

  const plan = planEcho(echo, def as EchoDef, to);
  if (plan.via === "redirect") {
    const q = new URLSearchParams({ echo, turn: o.turnId, to });
    return { href: `${CORE}/echo?${q}`, target: "_blank", rel, "data-echo": echo, onClick: () => report(plan.analytics, to, echo, o.params) };
  }
  const beacon = () => {
    report(plan.analytics, to, echo, o.params);
    const body = JSON.stringify({ echo, turn: o.turnId, to, visitor: visitorId() ?? undefined });
    try { navigator.sendBeacon(`${CORE}/echo`, new Blob([body], { type: "text/plain" })); } catch { /* a lost echo never blocks the link */ }
  };
  return { href: to, target: "_blank", rel, "data-echo": echo, onClick: beacon, onAuxClick: (e) => { if (e.button === 1) beacon(); } };
}

/** An outbound <a> that echoes, for views that would rather not spread props. */
export function EchoAnchor({ to, children, className, title, ...o }: EchoOptions & { to: string | null | undefined; children: ReactNode; className?: string; title?: string } & Pick<AnchorHTMLAttributes<HTMLAnchorElement>, "aria-label">) {
  const a = echoLink(to, o);
  if (!a) return <span className={className}>{children}</span>;
  return <a {...a} className={className} title={title} aria-label={o["aria-label"]}>{children}</a>;
}
