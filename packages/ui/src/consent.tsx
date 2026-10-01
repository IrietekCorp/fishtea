/**
 * Consent for page analytics (`rules.site.analytics`). The page's <head> (vite.config.ts) describes the
 * analytics as `window.__fishteaAnalytics` and defines `window.fishteaLoadAnalytics`, which it calls itself
 * only when the visitor already accepted on this device, or when the site set `consent: false`. Until then
 * nothing of Google's is loaded and no cookie of theirs is set: this banner asks first.
 *
 * Accepting and declining are one click each, side by side. The answer is kept in localStorage, on this
 * device only. A shell can offer the question again (`reopenConsent`), and declining after accepting turns
 * the tag off and clears its cookies.
 */
import { useEffect, useState } from "react";

interface Analytics { google?: string; consent?: boolean; notice?: string }
type Choice = "granted" | "denied";

const KEY = "fishtea:consent";
const REOPEN = "fishtea:consent-reopen";
const config = (): Analytics | null => (typeof window !== "undefined" ? ((window as any).__fishteaAnalytics ?? null) : null);
const onAdmin = () => location.pathname === "/admin" || location.pathname.startsWith("/admin/");

/** Whether this page asks for consent: there is analytics, the site wants consent, and this is not /admin. */
export const asksConsent = (): boolean => { const a = config(); return !!a?.google && a.consent !== false && !onAdmin(); };

function stored(): Choice | null {
  try { const v = localStorage.getItem(KEY); return v === "granted" || v === "denied" ? v : null; } catch { return null; }
}
function store(v: Choice) { try { localStorage.setItem(KEY, v); } catch { /* private mode: asked again next visit */ } }

/** Turn the tag off and remove the cookies it set (_ga, _ga_<id>), on this host and its parent domain. */
function withdraw(id: string) {
  (window as any)[`ga-disable-${id}`] = true;
  const host = location.hostname;
  const domains = ["", host, `.${host}`, `.${host.split(".").slice(-2).join(".")}`];
  for (const name of document.cookie.split(";").map((c) => c.split("=")[0].trim()).filter((n) => n === "_ga" || n.startsWith("_ga_") || n === "_gid")) {
    for (const d of domains) document.cookie = `${name}=; Max-Age=0; path=/${d ? `; domain=${d}` : ""}`;
  }
}

/** Ask again: a shell's "Cookie settings" link. */
export function reopenConsent() { dispatchEvent(new Event(REOPEN)); }

export function ConsentBanner() {
  const [open, setOpen] = useState(() => asksConsent() && stored() === null);
  useEffect(() => { const on = () => asksConsent() && setOpen(true); addEventListener(REOPEN, on); return () => removeEventListener(REOPEN, on); }, []);
  const a = config();
  if (!open || !a?.google) return null;

  const choose = (v: Choice) => {
    const before = stored();
    store(v); setOpen(false);
    if (v === "granted") { (window as any)[`ga-disable-${a.google}`] = false; (window as any).fishteaLoadAnalytics?.(); }
    else if (before === "granted") withdraw(a.google!);
  };
  const notice = a.notice || "This site uses Google Analytics cookies to see which pages are read. Accept them, or decline and browse without them.";
  const btn = "flex-1 sm:flex-none min-w-28 px-5 py-2.5 text-sm font-black uppercase tracking-tighter transition-colors";
  return (
    <div role="region" aria-label="Cookie consent" className="no-print fixed inset-x-0 bottom-0 z-50 px-4 pb-4 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 border border-border bg-card p-5 shadow-2xl sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-relaxed text-muted-foreground">{notice}</p>
        <div className="flex shrink-0 gap-3">
          <button onClick={() => choose("denied")} className={`${btn} border border-border text-foreground hover:border-accent`}>Decline</button>
          <button onClick={() => choose("granted")} className={`${btn} bg-accent text-accent-foreground hover:brightness-110`}>Accept</button>
        </div>
      </div>
    </div>
  );
}
