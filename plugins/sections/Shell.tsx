/**
 * The sections shell: a site you navigate by the spec's `rules.site` — a header with its sections and its
 * primary action; under it, the Fishtea menu (@fishtea/ui/menu): the prompt and the trail drawer of this
 * visit's points; the section's page, any action open over it, the threads the answer offers, and a
 * footer with the sitemap. Entering a section with nothing asked is choosing a room, not a point in the
 * conversation, so it adds nothing to the trail. Diagnostics live on /admin (the framework's, behind a
 * sign-in), not on this site.
 *
 * Each shape is drawn by the application's view for it (a ui plugin's `views`), or else from the layout
 * the answer carries (`pour.present`, declared in rules.present or derived from the spec) — so a new shape
 * reads well before anyone has written a view. Every turn is a history entry: Back and Forward rewind the
 * trail, they never re-classify.
 */
import { useEffect, useState } from "react";
import { Loader2, Menu as MenuIcon, X } from "lucide-react";
import type { Pour, Response } from "@fishtea/ui/lib/client";
import { FishteaMenu } from "@fishtea/ui/menu/FishteaMenu";
import { EchoTurn } from "@fishtea/ui/lib/echo";
import type { Turn, Vessel } from "@fishtea/ui/menu/types";
import spec from "@app/spec.json";
import { useConversation, shapeOf, type Conversation, type Crumb } from "./useConversation";
import { actions, business, childrenOf, copy, home, isAction, isSection, labelOf, logo, menu, needsInput, parentOf, sectionOf, sections, social, suggestions, urlFor } from "./site";
import { SocialLinks } from "./social";
import { AskView, Chips, FormView } from "./generic";
import { PresentAnswer, type PresentHost } from "@fishtea/ui/present/Present";
import { asksConsent, reopenConsent } from "@fishtea/ui/consent";
import type { Act, Brand, Chrome, FooterProps, HeaderProps, NavLink, View } from "./types";

type Views = Partial<Record<string, View>>;

export function Shell({ views = {}, chrome = {} }: { views?: Views; chrome?: Chrome }) {
  const c = useConversation();
  const OwnHeader = chrome.header;
  const OwnFooter = chrome.footer;
  const cur = c.current?.res.pour;
  const overlay = cur && isAction(shapeOf(cur)) ? cur : null;
  const shown = c.section?.res.pour;
  const active = sectionOf(shapeOf(shown));

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {OwnHeader ? <OwnHeader {...headerProps(c, active)} /> : <Header c={c} active={active} />}
      <Menu c={c} ownHeader={!!OwnHeader} />
      {c.resumed && shown && (
        <div className="no-print border-b border-border bg-card">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 text-sm sm:px-6 lg:px-8">
            <span className="text-muted-foreground">Welcome back — you were looking at <span className="font-bold text-foreground">{(shown as any).phrase ?? labelOf(shapeOf(shown) ?? home)}</span>.</span>
            <button onClick={c.home} className="font-black uppercase tracking-widest text-accent hover:underline">Start from home</button>
            <button onClick={c.dismissResumed} className="ml-auto text-muted-foreground/60 hover:text-foreground" aria-label="Dismiss"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}
      {c.error && <div role="alert" className="border-b border-write/40 bg-write/10 px-4 py-3 text-center text-sm text-write">{c.error}</div>}

      <main className="flex-1">
        {shown ? (
          <div key={c.section!.res.turn.id} className="fade">
            <EchoTurn.Provider value={c.section!.res.turn.id}>
            <PourView pour={shown} res={c.section!.res} c={c} views={views} />
            </EchoTurn.Provider>
            {/* the UI language lays out its own threads; a vessel does unless it says otherwise */}
            {views[shapeOf(shown) ?? ""] && !views[shapeOf(shown)!]!.ownThreads && <Threads pour={shown} c={c} />}
          </div>
        ) : <Booting />}
      </main>

      {overlay && <EchoTurn.Provider value={c.current!.res.turn.id}><ActionOverlay pour={overlay} res={c.current!.res} c={c} views={views} key={c.current!.res.turn.id} /></EchoTurn.Provider>}
      {OwnFooter ? <OwnFooter {...footerProps(c, active)} /> : <Footer c={c} />}
      <Toasts c={c} />
    </div>
  );
}

/** How the layout renderer asks, and what chrome it draws: a crumb up to the section, threads minus the menu.
 *  A page's view that adds to the declared layout rather than replacing it draws `<PresentAnswer host={hostFor(c, pour)} />`. */
export const hostFor = (c: Conversation, pour: Pour): PresentHost => {
  const shape = shapeOf(pour);
  const up = parentOf(shape);
  return {
    go: c.go,
    args: (pour.kind === "answer" && pour.args) || c.section?.route.args || {},
    crumb: up && shape && !isSection(shape) ? { label: labelOf(up), go: () => c.go(up) } : null,
    offered: (ch) => isSection(ch.shape) || isAction(ch.shape),
    turnId: c.section?.res.turn.id ?? c.current?.res.turn.id ?? null,
  };
};

function PourView({ pour, res, c, views }: { pour: Pour; res: Response; c: Conversation; views: Views }) {
  if (pour.kind === "answer") {
    const V = views[pour.shape];
    if (V) return <V answer={pour.answer} pour={pour} res={res} c={c} />;
    return <PresentAnswer pour={pour} host={hostFor(c, pour)} />;
  }
  if (pour.kind === "composite") {
    // parts in tree order from the root, each drawn like any pour
    const order: string[] = [];
    const walk = (id: string) => { if (order.includes(id) || !pour.parts[id]) return; order.push(id); (pour.parts[id].children ?? []).forEach(walk); };
    walk(pour.root);
    return <>{order.map((id) => <PourView key={id} pour={pour.parts[id].of} res={res} c={c} views={views} />)}</>;
  }
  if (pour.kind === "ask") return <AskView pour={pour} c={c} />;
  if (pour.kind === "form" || pour.kind === "confirm-write") {
    // a page's view that says it draws forms gets its form and its confirmation too, as an action's does
    const V = views[pour.shape];
    if (V?.forms) return <V answer={undefined} pour={pour} res={res} c={c} />;
  }
  if (pour.kind === "form" || pour.kind === "confirm-write") return (
    <section className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <h1 className="mb-8 text-3xl font-black tracking-tighter">{pour.phrase || labelOf(pour.shape)}</h1>
      <FormView pour={pour} c={c} />
    </section>
  );
  if (pour.kind === "notification") return <section className="mx-auto max-w-4xl px-4 py-16"><p className="text-xl">{pour.text}</p><div className="mt-6"><Chips chips={pour.next} c={c} /></div></section>;
  return null;
}

/** The answer's own next[] — minus the sections, which the header already offers. */
function Threads({ pour, c }: { pour: Pour; c: Conversation }) {
  if (pour.kind !== "answer") return null;
  const chips = pour.next.filter((ch) => !isSection(ch.shape) && !isAction(ch.shape));
  if (!chips.length) return null;
  return (
    <div className="no-print border-t border-border/40 bg-muted">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"><Chips chips={chips} c={c} label="Pull a thread" /></div>
    </div>
  );
}

/* ── the frame a brand may draw itself (a ui plugin's chrome) ───────────────────────────────────────── */

const brand: Brand = { name: business.name, doc: business.doc, logo };
// real links, for new tabs and crawlers; a plain click goes in place
const plain = (e: React.MouseEvent) => !(e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
const navLink = (c: Conversation, shape: string, label: string, active: string, after?: () => void): NavLink => ({
  shape, label, active: active === shape, href: urlFor({ shape, args: {} }),
  onClick: (e) => { if (plain(e)) { e.preventDefault(); after?.(); c.go(shape); } },
});
const contactAct = (c: Conversation): Act | null => (actions.contact ? { label: actions.contact.label, go: () => c.contact() } : null);

export function headerProps(c: Conversation, active: string): HeaderProps {
  return { c, brand, home: navLink(c, home, business.name, active), sections: sections.map((s) => navLink(c, s.shape, s.label, active)), action: contactAct(c) };
}

export function footerProps(c: Conversation, active: string): FooterProps {
  const utilities: Act[] = [];
  if (actions.remember) utilities.push({ label: actions.remember.label, go: () => c.act("remember") });
  if (asksConsent()) utilities.push({ label: "Cookie settings", go: reopenConsent });
  return {
    c, brand, home: navLink(c, home, business.name, active),
    sections: sections.map((s) => ({ ...navLink(c, s.shape, s.label, active), children: childrenOf(s.shape).filter((ch) => !needsInput(ch)).map((ch) => ({ label: labelOf(ch), go: () => c.go(ch) })) })),
    utilities,
    cta: { title: copy.cta.title, lead: copy.cta.lead, action: copy.cta.label ? { label: copy.cta.label, go: () => c.contact() } : null },
    social,
  };
}

/** The business's mark: its logo when rules.site.brand has one, else its name set in type. */
function Mark({ height, footer = false }: { height: number; footer?: boolean }) {
  if (logo) return <img src={logo.src} alt={logo.alt ?? business.name} decoding={footer ? "async" : "sync"} loading={footer ? "lazy" : "eager"} style={{ height, width: "auto" }} className="block" />;
  const [first, ...rest] = business.name.toUpperCase().split(" ");
  return footer
    ? <>{business.name}<span className="text-accent">.</span></>
    : <>{first} {rest.join(" ")}<span className="text-accent">.</span></>;
}

/** The business's name, its sections (rooms: entering one adds nothing to the trail) and its primary action. */
function Header({ c, active }: { c: Conversation; active: string }) {
  const [open, setOpen] = useState(false);
  const nav = (shape: string) => { setOpen(false); c.go(shape); };
  const link = (shape: string) => ({ href: urlFor({ shape, args: {} }), onClick: (e: React.MouseEvent) => { if (plain(e)) { e.preventDefault(); nav(shape); } } });
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <a {...link(home)} aria-label={business.name} className="text-lg font-black tracking-tighter transition-colors hover:text-accent sm:text-xl">
          <Mark height={logo?.height ?? 36} />
        </a>
        <nav className="hidden items-center gap-7 lg:flex" aria-label="Sections">
          {sections.map((s) => (
            <a key={s.shape} {...link(s.shape)} aria-current={active === s.shape ? "page" : undefined}
              className={`text-sm font-medium transition-colors ${active === s.shape ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {s.label}{active === s.shape && <span className="mx-auto mt-1 block h-0.5 w-full bg-accent" />}
            </a>
          ))}
          <button onClick={() => c.contact()} className="rounded bg-accent px-5 py-2 font-semibold text-accent-foreground transition-all hover:brightness-110">{actions.contact.label}</button>
        </nav>
        <button onClick={() => setOpen(!open)} className="rounded p-2 hover:bg-card lg:hidden" aria-label="Menu" aria-expanded={open}>{open ? <X /> : <MenuIcon />}</button>
      </div>
      {open && (
        <nav className="space-y-1 border-t border-border px-4 py-3 lg:hidden" aria-label="Sections">
          {sections.map((s) => (
            <a key={s.shape} {...link(s.shape)} className={`block w-full rounded px-3 py-2 text-left text-sm font-medium ${active === s.shape ? "bg-card text-foreground" : "text-muted-foreground"}`}>{s.label}</a>
          ))}
          <button onClick={() => { setOpen(false); c.contact(); }} className="mt-2 block w-full rounded bg-accent px-3 py-2.5 text-center font-semibold text-accent-foreground">{actions.contact.label}</button>
        </nav>
      )}
    </header>
  );
}

/* ── the menu ──────────────────────────────────────────────────────────────────────────────────────── */

const layouts = ((spec as any).rules?.present?.shapes ?? {}) as Record<string, { organism?: string }[]>;

/** The vessel a point's answer poured into: the kind of pour, or for an answer, the shape of its layout. */
function vesselOf(shape: string | undefined, kind: string): Vessel {
  if (kind === "form") return "form";
  if (kind === "confirm-write") return "confirm";
  if (kind === "ask" || !shape) return "ask";
  const organisms = (layouts[shape] ?? []).map((o) => o.organism);
  if (organisms.includes("timeline")) return "timeline";
  if (organisms.some((o) => o === "grid" || o === "list" || o === "faq")) return "list";
  if (organisms.some((o) => o === "panel" || o === "facts" || o === "features")) return "detail";
  return "card";
}

const words = (s: string, n: number) => { const w = s.trim().split(/\s+/); return w.length > n ? `${w.slice(0, n).join(" ")}…` : w.join(" "); };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A crumb as the menu's trail shows it. The pill: the visitor's first words when they typed, else where
 * they went. The card: what they said (or where they went), and the answer's own phrase as its summary.
 */
function turnOf(k: Crumb): Turn {
  const room = k.shape ? (isAction(k.shape) ? sectionOf(undefined) : sectionOf(k.shape)) : home;
  const where = k.typed ? "" : k.title;
  return {
    id: k.turnId,
    index: k.step,
    roomId: room,
    roomLabel: labelOf(room),
    utterance: k.said ?? where,
    short: k.said ? words(k.said, 4) : where,
    summary: k.phrase ? cap(k.phrase) : k.section ? `${k.section} · ${k.title}` : k.title,
    shape: k.shape ?? "ask",
    vessel: vesselOf(k.shape, k.kind),
    at: k.at,
  };
}

/**
 * The Fishtea menu over this conversation, in a band right under the header: the prompt, and the trail
 * of this visit's points. Held under the header on wider screens; on a phone it scrolls with the page,
 * where a pinned prompt would take a quarter of the screen.
 */
function Menu({ c, ownHeader }: { c: Conversation; ownHeader: boolean }) {
  const turns = c.crumbs.map(turnOf);
  const onScreen = c.current?.res.turn.id;
  // in a room — a section entered with nothing asked — no point of the trail is current
  const current = onScreen && turns.some((x) => x.id === onScreen) ? onScreen : null;
  // flush: the menu is the sub-header — the page's own ground, the full width, one hairline under it. It
  // sticks under the header, whose height a brand's own header says with --shell-header-h (4rem otherwise).
  const flush = menu.layout === "flush";
  return (
    <div className={flush
      ? "no-print relative z-30 border-b border-border bg-background/95 backdrop-blur-sm md:sticky md:top-[var(--shell-header-h,4rem)]"
      : "no-print relative z-30 border-b border-border bg-muted/95 backdrop-blur-sm md:sticky md:top-[var(--shell-header-h,4rem)]"}>
     {/* flush lines up with the header above it: the shell's own header is a max-w-7xl column, so the menu
         takes that column too; a brand's own header (chrome) keeps the brand's wider gutters */}
     <div className={flush
       ? ownHeader ? "w-full px-6 py-2 md:px-12" : "mx-auto w-full max-w-7xl px-4 py-2 sm:px-6 lg:px-8"
       : "mx-auto w-full max-w-[880px] px-4 py-3 sm:px-6"}>
      <FishteaMenu
        turns={turns}
        currentTurnId={current}
        suggestions={suggestions}
        suggestionMode={menu.suggestions}
        layout={menu.layout}
        busy={c.busy}
        onSubmit={c.ask}
        onRewind={c.revisit}
        onStop={c.stop}
      />
     </div>
    </div>
  );
}

function ActionOverlay({ pour, res, c, views }: { pour: Pour; res: Response; c: Conversation; views: Views }) {
  const shape = shapeOf(pour)!;
  const V = views[shape];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") c.closeAction(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [c]);
  return (
    <div className="fade fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/85 p-4 backdrop-blur-sm sm:items-center" onClick={c.closeAction} role="dialog" aria-modal="true" aria-label={labelOf(shape)}>
      <div className="rise relative my-8 w-full max-w-3xl rounded-2xl border border-border bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={c.closeAction} className="absolute right-4 top-4 rounded-full border border-border p-2 text-muted-foreground hover:border-accent hover:text-foreground" aria-label="Close"><X className="h-5 w-5" /></button>
        <div className="p-6 sm:p-10">
          {V ? <V pour={pour} res={res} c={c} answer={pour.kind === "answer" ? pour.answer : undefined} /> : pour.kind === "form" || pour.kind === "confirm-write" ? <FormView pour={pour} c={c} /> : <p className="text-lg">{(pour as any).phrase}</p>}
        </div>
      </div>
    </div>
  );
}

function Footer({ c }: { c: Conversation }) {
  return (
    <footer className="no-print mt-0 border-t border-border/40 bg-muted">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-12">
          <div className="space-y-5 md:col-span-4">
            <h3 className="text-3xl font-black uppercase tracking-tighter"><Mark height={logo?.footerHeight ?? logo?.height ?? 28} footer /></h3>
            {business.doc && <p className="max-w-md font-medium leading-relaxed text-muted-foreground">{business.doc}</p>}
            <SocialLinks className="pt-2" />
          </div>
          <nav className="space-y-5 md:col-span-5" aria-label="Sitemap">
            <h4 className="text-xs font-black uppercase tracking-[0.2em] text-accent">Sitemap</h4>
            <ul className="grid grid-cols-2 gap-x-8 gap-y-4">
              {sections.map((s) => (
                <li key={s.shape}>
                  <button onClick={() => c.go(s.shape)} className="text-sm font-bold uppercase tracking-tighter text-muted-foreground hover:text-foreground">{s.label}</button>
                  <ul className="mt-1 space-y-1">
                    {childrenOf(s.shape).filter((ch) => !needsInput(ch)).map((ch) => (
                      <li key={ch}><button onClick={() => c.go(ch)} className="text-xs text-muted-foreground/60 hover:text-foreground">{labelOf(ch)}</button></li>
                    ))}
                  </ul>
                </li>
              ))}
              <li>
                <span className="text-sm font-bold uppercase tracking-tighter text-muted-foreground">Utilities</span>
                <ul className="mt-1 space-y-1">
                  {actions.remember && <li><button onClick={() => c.act("remember")} className="text-xs text-muted-foreground/60 hover:text-foreground">{actions.remember.label}</button></li>}
                  {asksConsent() && <li><button onClick={reopenConsent} className="text-xs text-muted-foreground/60 hover:text-foreground">Cookie settings</button></li>}
                </ul>
              </li>
            </ul>
          </nav>
          <div className="space-y-5 md:col-span-3">
            {copy.cta.title && <h4 className="text-xs font-black uppercase tracking-[0.2em] text-accent">{copy.cta.title}</h4>}
            {copy.cta.lead && <p className="text-sm font-medium text-muted-foreground">{copy.cta.lead}</p>}
            {copy.cta.label && <button onClick={() => c.contact()} className="w-full bg-accent px-6 py-4 font-black uppercase tracking-tighter text-accent-foreground transition-transform hover:scale-[1.02] active:scale-[0.98]">{copy.cta.label}</button>}
          </div>
        </div>
        <p className="mt-16 border-t border-border/40 pt-8 text-xs font-bold uppercase tracking-widest text-muted-foreground/60">© {new Date().getFullYear()} {business.name}. All rights reserved.</p>
      </div>
    </footer>
  );
}

function Toasts({ c }: { c: Conversation }) {
  if (!c.notices.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2" role="status">
      {c.notices.map((n) => <div key={n.id} className="rise max-w-sm rounded border border-accent/40 bg-card px-4 py-3 text-sm shadow-xl">{n.text}</div>)}
    </div>
  );
}

function Booting() {
  return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div>;
}
