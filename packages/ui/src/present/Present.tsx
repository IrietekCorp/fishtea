/**
 * Draws `pour.present` — the layout the core resolves for every answer from `rules.present`, or derives
 * from the spec (`@fishtea/spec`'s present.ts): organisms lay out parts of the answer, molecules render
 * one row each, atoms one value. It needs no spec of its own, only the tree the answer carries.
 *
 * Styled through the theme tokens alone (background, card, muted, border, foreground, accent…), so it
 * wears whatever design system the application's ui plugins give it. A host — the framework's container,
 * or a shell plugin — tells it how to ask a turn and what the turn on screen was asked with (`PresentHost`).
 *
 * Several pieces are adapted from 21st.dev components, restyled to the tokens and without their
 * dependencies (base-ui, radix, cva, the shadcn `cn`):
 *   timeline   cubby-ui/timeline, shadcnui-blocks/timeline-02    the rail, markers, company-led entry
 *   features   hirael/feature-08 (MIT)                           hairline frame, survey marks, spotlight
 *   stats      designali-in/stats-2, ephraimduncan/stats-cards-with-links   big figure, link footer
 *   facets     cnippet-dev/v-toggle-10                           chips with counts, a total, Clear
 *   faq        diarmuradi/faq-11                                 accordions in columns by group, first open
 *   chips      cnippet-dev/v-meter-6                             a level drawn on its scale
 *   steps      slide-cn/timeline                                 numbered markers for an ordered process
 */
import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import {
  Activity, ArrowRight, BarChart3, BookOpen, Brain, Briefcase, Building2, Calendar, ChevronDown, Code2, Compass, Cpu, ExternalLink,
  Globe, GraduationCap, HeartHandshake, Layers, Link2, Mail, Mic, Network, Newspaper, Plane, Printer, Quote, Rocket, ShieldCheck,
  SlidersHorizontal, Sparkles, Star, UserCheck, X, Zap, type LucideIcon,
} from "lucide-react";
import type { Chip, Pour } from "../lib/client";
import { echoLink, useEchoTurn } from "../lib/echo";
import {
  bind, read, rowsOf, text,
  type Action, type Go, type MoleculeDef, type PresentTree, type ResolvedOrganism, type TagSource,
} from "@fishtea/present";

/**
 * What a host gives the renderer. Only `go` is required: everything else is chrome a host may or may not
 * have — a crumb back to where this shape lives, the thread chips it draws itself, the chips it already
 * offers elsewhere (a menu, an action button) and so drops from the threads.
 */
export interface PresentHost {
  /** ask a turn */
  go(shape: string, args?: Record<string, unknown>): void;
  /** the arguments the turn on screen was asked with — what facets and tags refine */
  args?: Record<string, unknown>;
  /** the way up, drawn above the page */
  crumb?: { label: string; go(): void } | null;
  /** draw the threads (next[] the page did not already offer); a host that draws next[] itself says false */
  threads?: boolean;
  /** a chip the host already offers elsewhere, so it is not repeated as a thread */
  offered?(chip: Chip): boolean;
  /** the turn on screen: an external link names it so following the link echoes it (docs/ECHOES.md) */
  turnId?: string | null;
}

/** An external link from an answer. With the application's echoes declared it reports itself; otherwise a plain link. */
function OutLink({ href, turnId, className, children }: { href: string; turnId?: string | null; className: string; children: ReactNode }) {
  const onScreen = useEchoTurn();
  const a = echoLink(href, { turnId: turnId ?? onScreen });
  if (!a) return null;
  return <a {...a} className={className}>{children}</a>;
}

// ── atoms ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The icon vocabulary: generic words, never a business's. The data carries its own words (a press item's
 * kind, an organism's `icons`), and `rules.present.icons` maps them onto these — "podcast" → "mic".
 */
const ICONS: Record<string, LucideIcon> = {
  mic: Mic, book: BookOpen, graduation: GraduationCap, newspaper: Newspaper, sparkles: Sparkles, briefcase: Briefcase,
  zap: Zap, network: Network, user: UserCheck, shield: ShieldCheck, layers: Layers, activity: Activity, compass: Compass,
  handshake: HeartHandshake, brain: Brain, code: Code2, cpu: Cpu, globe: Globe, plane: Plane, building: Building2,
  calendar: Calendar, rocket: Rocket, star: Star, chart: BarChart3, mail: Mail, link: Link2,
};
const iconFor = (k: string | undefined, words?: Record<string, string>) => {
  if (!k) return undefined;
  const w = k.toLowerCase();
  return ICONS[(words?.[w] ?? words?.[k] ?? w).toLowerCase()];
};

const Kicker = ({ children, className = "" }: { children: ReactNode; className?: string }) =>
  <p className={`text-xs font-black uppercase tracking-[0.2em] text-accent ${className}`}>{children}</p>;

const paragraphs = (t: string) => t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

function Prose({ value, className = "" }: { value: string; className?: string }) {
  return <div className={`space-y-4 leading-relaxed ${className}`}>{paragraphs(value).map((p, i) => <p key={i}>{p}</p>)}</div>;
}

/** Two-tone: the words the accent takes are the ones after the split. */
function Split({ text: t, accent, split }: { text: string; accent?: string; split?: "first" | "headline" }) {
  let [a, b] = [t, accent ?? ""];
  if (!accent && split === "first") { const [f, ...r] = t.split(" "); [a, b] = [f, r.join(" ")]; }
  if (!accent && split === "headline") {
    const at = t.toLowerCase().lastIndexOf(" the ");
    if (at > 0) [a, b] = [t.slice(0, at + 4), t.slice(at + 5)];
    else { const w = t.split(" "); [a, b] = [w.slice(0, -2).join(" "), w.slice(-2).join(" ")]; }
  }
  return <>{a}{b && <> <span className="text-accent">{b}</span></>}</>;
}

function TagList({ tags, onPick, active }: { tags: string[]; onPick?: (t: string) => void; active?: Set<string> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => {
        const on = active?.has(t.toLowerCase());
        const cls = `rounded border px-3 py-1 font-mono text-xs transition-colors ${on ? "border-accent bg-accent text-accent-foreground" : "border-border bg-card text-muted-foreground"}`;
        return onPick
          ? <button key={t} aria-pressed={on} onClick={(e) => { e.stopPropagation(); onPick(t); }} className={`${cls} ${on ? "" : "hover:border-accent hover:text-foreground"}`}>{t}</button>
          : <span key={t} className={cls}>{t}</span>;
      })}
    </div>
  );
}

/** A level on its scale — v-meter-6's idea, drawn as the brand's dots. */
function Meter({ value, levels }: { value: string; levels: string[] }) {
  const n = levels.indexOf(value) + 1;
  return (
    <span className="flex gap-0.5" role="meter" aria-valuemin={1} aria-valuemax={levels.length} aria-valuenow={n} aria-label={value}>
      {levels.map((l, i) => <span key={l} className={`h-1.5 w-1.5 rounded-full ${i < n ? "bg-accent" : "bg-border"}`} />)}
    </span>
  );
}

// ── asking ────────────────────────────────────────────────────────────────────────────────────────

interface Ctx { host: PresentHost; shape: string; args: Record<string, unknown>; active: Set<string>; icons?: Record<string, string> }

/**
 * Ask a turn. A turn for the shape already on screen *refines* it: the current arguments are kept and
 * the one given is toggled — set, or cleared when it already had that value — so a tag or a facet
 * narrows the page instead of replacing its other filters.
 */
function ask(x: Ctx, go: Go, scope: unknown) {
  const args = Object.fromEntries(Object.entries(go.args ?? {}).map(([k, b]) => [k, bind(b, scope)]));
  if (go.shape !== x.shape) return x.host.go(go.shape, args);
  const keep = Object.fromEntries(Object.entries(x.args).filter(([, v]) => v != null && v !== ""));
  for (const [k, v] of Object.entries(args)) {
    if (String(keep[k] ?? "").toLowerCase() === String(v ?? "").toLowerCase()) delete keep[k];
    else keep[k] = v;
  }
  x.host.go(x.shape, keep);
}

// ── molecules ─────────────────────────────────────────────────────────────────────────────────────

interface Filled {
  eyebrow: string; title: string; subtitle: string; body: string; meta: string; number: string; hint: string; cta: string;
  tags: { source: TagSource; values: string[] }[]; bullets: string[]; quotes: Said[]; level?: string; quiet: boolean;
  image?: string; href?: string; icon?: LucideIcon;
}

function fill(m: MoleculeDef, row: unknown, icons?: Record<string, string>): Filled {
  const tags = (Array.isArray(m.tags) ? m.tags : []).map((source) => {
    const v = read(row, source.from);
    return { source, values: Array.isArray(v) ? v.map(String) : [] };
  }).filter((t) => t.values.length);
  const bullets = m.bullets ? read(row, m.bullets) : undefined;
  const quotes = m.quotes ? read(row, m.quotes) : undefined;
  return {
    eyebrow: text(m.eyebrow, row), title: text(m.title, row), subtitle: text(m.subtitle, row), body: text(m.body, row), meta: text(m.meta, row),
    number: text(m.number, row), hint: text(m.hint, row), cta: text(m.cta, row),
    tags, bullets: Array.isArray(bullets) ? bullets.map((b) => (typeof b === "object" && b ? text("$name", b) : String(b))) : [],
    quotes: Array.isArray(quotes) ? quotes.map(said).filter((q) => q.words) : [],
    level: m.level ? text(`$${m.level}`, row) || undefined : undefined,
    quiet: !!bind(m.quiet, row) && bind(m.quiet, row) !== "false",
    image: m.image ? (read(row, m.image) as string | undefined) || undefined : undefined,
    href: m.href ? (read(row, m.href) as string | undefined) || undefined : undefined,
    icon: iconFor(text(m.icon, row), icons),
  };
}

/** One quote carried inside a row: the words, who said them, and their face. */
interface Said { words: string; name: string; role: string; image?: string }
const said = (q: unknown): Said => {
  const r = (q && typeof q === "object" ? q : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : "");
  return {
    words: s("quote") || s("description"), name: s("name"),
    role: [s("title"), s("company")].filter(Boolean).join(" · "), image: s("imageUrl") || s("image_url") || undefined,
  };
};

/** A quote inside a row: its opening line, the whole of it a click away. */
function Aside({ q }: { q: Said }) {
  const [open, setOpen] = useState(false);
  // "Read all" only when the clamp actually hides something, which depends on the width it is given
  const [long, setLong] = useState(false);
  const text = useRef<HTMLQuoteElement>(null);
  useLayoutEffect(() => {
    const el = text.current;
    if (!el || open) return;
    const measure = () => setLong(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);
  return (
    <figure className="relative mt-5 overflow-hidden rounded-lg border border-border bg-card p-5">
      <Quote aria-hidden className="absolute -right-2 -top-2 h-16 w-16 text-accent opacity-5" />
      <blockquote ref={text} className={`relative text-sm italic leading-relaxed text-foreground/90 ${open ? "" : "line-clamp-3"}`}>“{q.words}”</blockquote>
      <figcaption className="mt-4 flex items-center gap-3">
        {q.image && <img src={q.image} alt="" loading="lazy" className="h-8 w-8 shrink-0 rounded-full border border-accent object-cover" />}
        <p className="min-w-0 flex-1 text-xs"><span className="font-black">{q.name}</span>{q.role && <span className="text-muted-foreground"> · {q.role}</span>}</p>
        {(long || open) && <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="no-print shrink-0 text-xs font-black uppercase tracking-widest text-accent hover:underline">{open ? "Less" : "Read all"}</button>}
      </figcaption>
    </figure>
  );
}

interface MolProps { m: MoleculeDef; row: unknown; x: Ctx; i: number; icon?: LucideIcon; last?: boolean }

function Tags({ f, row, x }: { f: Filled; row: unknown; x: Ctx }) {
  if (!f.tags.length) return null;
  return (
    <div className="relative z-10 flex flex-wrap gap-1.5">
      {f.tags.map(({ source, values }) => (
        <TagList key={source.from} tags={values} active={x.active}
          onPick={source.go ? (t) => ask(x, source.go!, { ...(row as object), item: t, $item: t }) : undefined} />
      ))}
    </div>
  );
}

function Molecule({ m, row, x, i, icon, last }: MolProps) {
  const f = fill(m, row, x.icons);
  const Icon = f.icon ?? icon;
  const open = m.go ? () => ask(x, m.go!, row) : undefined;
  const rise = i < 4 ? `rise rise-${i + 1}` : "rise";
  const external = f.href && (
    <OutLink href={f.href} turnId={x.host.turnId}
      className="relative z-10 inline-flex items-center gap-2 self-start whitespace-nowrap rounded border border-border px-5 py-2.5 text-sm font-semibold text-muted-foreground transition-all hover:border-accent hover:text-accent">
      {open ? "Visit" : f.cta || "Open"} <ExternalLink size={13} />
    </OutLink>
  );

  switch (m.as) {
    case "quote":
      return (
        <figure className={`${rise} relative flex h-full flex-col justify-between overflow-hidden rounded-lg border border-border bg-card p-8 sm:p-10`}>
          <Quote aria-hidden className="absolute -right-4 -top-4 h-32 w-32 text-accent opacity-5" />
          <blockquote className="relative mb-8 text-lg font-medium italic leading-relaxed">“{f.body}”</blockquote>
          <figcaption className="flex items-center gap-4 border-t border-border/40 pt-6">
            {f.image && <img src={f.image} alt="" className="h-12 w-12 rounded-full border-2 border-accent object-cover" />}
            <div><p className="font-black">{f.title}</p>{f.subtitle && <p className="text-xs font-bold uppercase tracking-widest text-accent">{f.subtitle}</p>}</div>
          </figcaption>
        </figure>
      );
    case "disclosure":
      return (
        <details open={i === 0} className="group rounded-lg border border-border bg-card px-5 py-4 open:border-accent/40">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold text-muted-foreground group-open:text-foreground">
            <span>{f.eyebrow && <Kicker className="mb-1">{f.eyebrow}</Kicker>}{f.title}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-accent transition-transform group-open:rotate-180" />
          </summary>
          <Prose value={f.body} className="mt-3 text-sm text-muted-foreground" />
        </details>
      );
    case "prompt":
      return (
        <button onClick={open} className={`${rise} group flex w-full items-center justify-between gap-4 rounded-lg border border-border bg-card p-6 text-left transition-colors hover:border-accent`}>
          <div>{f.eyebrow && <Kicker className="mb-2">{f.eyebrow}</Kicker>}<p className="text-lg font-bold">{f.title}</p></div>
          <ArrowRight className="h-5 w-5 shrink-0 text-accent transition-transform group-hover:translate-x-1" />
        </button>
      );
    case "row":
      return (
        <li className="flex gap-3 border-l-2 border-border pl-4 leading-relaxed text-muted-foreground transition-colors hover:border-accent">
          <span className="text-accent">▸</span>
          <span className="flex-1">{open ? <button onClick={open} className="font-bold text-foreground hover:text-accent">{f.title}</button> : f.title}{f.body && <span className="block text-sm">{f.body}</span>}</span>
          {f.level && m.levels ? <Meter value={f.level} levels={m.levels} /> : f.meta && <span className="shrink-0 font-mono text-xs text-accent">{f.meta}</span>}
        </li>
      );
    case "chip": {
      const Tag = open ? "button" : "span";
      return (
        <Tag onClick={open} title={f.hint || undefined}
          className={`inline-flex items-center gap-2 rounded border border-border bg-card px-3 py-1 font-mono text-xs text-muted-foreground ${open ? "hover:border-accent hover:text-foreground" : ""}`}>
          {f.title}{f.level && m.levels && <Meter value={f.level} levels={m.levels} />}
        </Tag>
      );
    }
    case "highlight": {
      const body = <>{f.eyebrow && <p className="mb-1 font-mono text-xs text-accent">{f.eyebrow}</p>}<p className="mb-1.5 text-sm font-bold">{f.title}</p>{f.body && <p className="text-xs leading-relaxed text-muted-foreground">{f.body}</p>}</>;
      const cls = "group flex gap-3 rounded border border-border bg-card p-4 text-left transition-colors hover:border-accent/40";
      if (f.href) return <OutLink href={f.href} turnId={x.host.turnId} className={cls}><ExternalLink size={12} className="mt-1 shrink-0 text-accent" /><div>{body}</div></OutLink>;
      return open ? <button onClick={open} className={cls}><div>{body}</div></button> : <div className={cls}><div>{body}</div></div>;
    }
    case "step":
      return (
        <div className="h-full rounded-lg border border-border bg-background p-6 shadow-lg transition-all hover:border-accent/30 sm:p-8">
          <div className="mb-4 select-none text-6xl font-black text-accent opacity-10 sm:text-7xl">{f.number || String(i + 1).padStart(2, "0")}</div>
          {Icon && <div className="mb-6 flex h-12 w-12 items-center justify-center rounded border border-border bg-card"><Icon className="h-6 w-6 text-accent" strokeWidth={2} /></div>}
          <h3 className="mb-3 text-lg font-black tracking-tight sm:text-xl">{f.title}</h3>
          {f.body && <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">{f.body}</p>}
        </div>
      );
    case "event":
      return <Event f={f} row={row} x={x} open={open} last={!!last} />;
    case "feature":
      return <FeatureCard f={f} open={open} icon={Icon} />;
    default: {
      // A tile: one hairline frame, the row's icon as a watermark, the title set large, and what a click
      // does in a ruled foot. No accent edge and no lift — the frame takes the accent on hover, and that
      // is all. A card that opens a shape is a stretched button under its title, so an external link or a
      // tag inside it stays its own control rather than a link nested in a button.
      const short = f.title.length <= 14;
      return (
        <article className={`${rise} group relative flex h-full w-full flex-col justify-between overflow-hidden rounded-lg border border-border bg-card p-8 text-left transition-colors sm:p-10 ${open ? "hover:border-accent/50" : ""}`}>
          {Icon && <div aria-hidden className="pointer-events-none absolute -right-4 -top-4 opacity-5 transition-opacity group-hover:opacity-10"><Icon className="h-32 w-32 text-accent" /></div>}
          <div className="relative min-w-0">
            {f.eyebrow && <Kicker className="mb-4">{f.eyebrow}</Kicker>}
            <h3 className={`mb-4 font-black uppercase tracking-tight text-foreground ${short ? "text-3xl sm:text-4xl" : "text-xl leading-tight sm:text-2xl"} ${Icon ? "pr-12" : ""}`}>
              {open ? <button onClick={open} className="text-left uppercase after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-accent">{f.title}</button> : f.title}
            </h3>
            {f.subtitle && <p className="mb-4 text-lg font-bold leading-tight text-foreground">{f.subtitle}</p>}
            {f.body && <p className={`text-sm leading-relaxed text-muted-foreground ${open ? "line-clamp-4" : ""}`}>{f.body}</p>}
            {f.tags.length > 0 && <div className="mt-6"><Tags f={f} row={row} x={x} /></div>}
            {f.meta && <p className="mt-4 font-mono text-xs text-muted-foreground/60">{f.meta}</p>}
          </div>
          {(open || external) && (
            <div className="relative mt-10 flex items-center justify-between gap-4 border-t border-border/40 pt-6">
              {open
                ? <span aria-hidden className="text-xs font-black uppercase tracking-widest text-foreground transition-colors group-hover:text-accent">{f.cta || "View details"}</span>
                : <span />}
              {external || <ArrowRight aria-hidden className="h-5 w-5 -translate-x-4 text-accent opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />}
            </div>
          )}
        </article>
      );
    }
  }
}

/**
 * One entry on the rail — the marker and line from cubby-ui/timeline, the company-led header, date and
 * badges from shadcnui-blocks/timeline-02. A quiet entry keeps its place on the rail but folds its detail.
 */
function Event({ f, row, x, open, last }: { f: Filled; row: unknown; x: Ctx; open?: () => void; last: boolean }) {
  return (
    <li className={`group/item relative ms-8 ${last ? "" : "pb-12"} ${f.quiet ? "opacity-40 transition-opacity hover:opacity-80" : ""}`}>
      <span aria-hidden className={`absolute -left-8 top-1 h-4 w-4 -translate-x-1/2 rounded-full border-2 ${f.quiet ? "border-border bg-background" : "border-accent bg-background group-hover/item:bg-accent"} transition-colors`} />
      {!last && <span aria-hidden className="absolute -left-8 top-6 h-[calc(100%-1.25rem)] w-0.5 -translate-x-1/2 bg-border" />}
      <div className="mb-1 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          {open ? <button onClick={open} className="text-lg font-black tracking-tight text-foreground hover:text-accent">{f.title}</button> : <h3 className="text-lg font-black tracking-tight">{f.title}</h3>}
          {f.eyebrow && <span className="ml-2 text-sm text-muted-foreground">{f.eyebrow}</span>}
        </div>
        {f.meta && <time className="shrink-0 font-mono text-xs text-accent tabular-nums">{f.meta}</time>}
      </div>
      {f.subtitle && <p className="mb-3 text-sm font-semibold italic text-muted-foreground">{f.subtitle}</p>}
      {!f.quiet && (
        <>
          {(f.body || f.bullets.length > 0) && (
            <ul className="space-y-1.5">
              {[f.body, ...f.bullets].filter(Boolean).map((b, j) => <li key={j} className="flex gap-2 text-sm leading-relaxed text-muted-foreground"><span className="mt-0.5 shrink-0 text-accent">▸</span>{b}</li>)}
            </ul>
          )}
          {f.tags.length > 0 && <div className="no-print mt-3"><Tags f={f} row={row} x={x} /></div>}
          {f.quotes.map((q, j) => <Aside key={j} q={q} />)}
        </>
      )}
    </li>
  );
}

/** hirael/feature-08: hairline frame, survey-mark corners, a spotlight that follows the pointer. */
function FeatureCard({ f, open, icon: Icon }: { f: Filled; open?: () => void; icon?: LucideIcon }) {
  const track = (e: PointerEvent<HTMLElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - b.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - b.top}px`);
  };
  const cross = (pos: string) => (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" className={`pointer-events-none absolute z-10 size-3.5 text-muted-foreground/60 ${pos}`}><path d="M5 12h14" /><path d="M12 5v14" /></svg>
  );
  return (
    <div onPointerMove={track} className="group relative flex h-full w-full flex-col gap-6 bg-card px-6 pb-6 pt-8 text-left">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-[radial-gradient(circle_200px_at_var(--mx)_var(--my),color-mix(in_oklch,var(--color-accent)_12%,transparent),transparent_70%)]" />
      <div className="absolute -inset-y-4 -start-px w-px bg-border" /><div className="absolute -inset-y-4 -end-px w-px bg-border" />
      <div className="absolute -inset-x-4 -top-px h-px bg-border" /><div className="absolute -inset-x-4 -bottom-px h-px bg-border" />
      {cross("left-0 top-0 -translate-x-1/2 -translate-y-1/2")}{cross("bottom-0 right-0 translate-x-1/2 translate-y-1/2")}
      {Icon && <div className="relative z-10 flex w-fit items-center justify-center rounded-sm border border-border bg-background p-3 transition-colors duration-300 group-hover:border-accent/40"><Icon className="size-5 text-accent" strokeWidth={1.5} /></div>}
      <div className="relative z-10 flex flex-1 flex-col gap-2">
        {f.eyebrow && <Kicker>{f.eyebrow}</Kicker>}
        <h3 className="text-lg font-black tracking-tight text-foreground">{f.title}</h3>
        {f.body && <p className="text-sm leading-relaxed text-muted-foreground">{f.body}</p>}
      </div>
      {open && <button onClick={open} className="relative z-10 inline-flex items-center gap-2 self-start text-sm font-bold uppercase tracking-widest text-accent transition-all hover:gap-3">{f.cta || "Open"} <ArrowRight className="h-4 w-4" /></button>}
    </div>
  );
}

// ── organisms ─────────────────────────────────────────────────────────────────────────────────────

interface OrgProps { o: ResolvedOrganism; answer: unknown; scope: Record<string, unknown>; x: Ctx }

function Heading({ o, scope, className = "mb-6" }: { o: ResolvedOrganism; scope: unknown; className?: string }) {
  const k = text(o.kicker, scope), t = text(o.title, scope), a = text(o.accent, scope), l = o.organism === "hero" || o.organism === "callout" ? "" : text(o.lead, scope);
  if (!k && !t && !l) return null;
  const center = o.align === "center" ? "text-center" : "";
  const big = !!(a || (k && t));
  return (
    <div className={`${className} ${center}`}>
      {k && <Kicker className="mb-2">{k}</Kicker>}
      {t && (big ? <h2 className="text-3xl font-black tracking-tighter sm:text-4xl md:text-5xl"><Split text={t} accent={a || undefined} /></h2> : <Kicker>{t}</Kicker>)}
      {l && <p className={`mt-4 max-w-2xl text-base italic text-muted-foreground sm:text-lg ${o.align === "center" ? "mx-auto" : ""}`}>{l}</p>}
    </div>
  );
}

const gridCols = (n: number | undefined, count: number) =>
  n === 1 ? "" : n === 2 ? "md:grid-cols-2" : n === 3 ? "md:grid-cols-2 lg:grid-cols-3" : count >= 4 && count % 3 !== 0 ? "md:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-2 lg:grid-cols-3";

function groupsOf(o: ResolvedOrganism, rows: unknown[]): [string, unknown[]][] {
  if (!o.group) return [["", rows]];
  const out = new Map<string, unknown[]>();
  for (const r of rows) {
    const v = String(read(r, o.group) ?? "");
    const k = o.groupLabel?.[v] ?? v;
    out.set(k, [...(out.get(k) ?? []), r]);
  }
  // groupLabel's order is the page's order; groups it does not name follow, as they came
  const order = o.groupLabel ? [...new Set(Object.values(o.groupLabel))] : [];
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  return [...out].sort(([a], [b]) => rank(a) - rank(b));
}

function Organism({ o, answer, scope, x }: OrgProps) {
  const rows = rowsOf(o, answer);
  const m = o.molecule;
  const icon = (i: number) => (o.icons?.length ? iconFor(o.icons[i % o.icons.length], x.icons) : undefined);
  const rowsOrEmpty = (node: ReactNode) => {
    if (rows.length) return node;
    const e = text(o.empty, scope);
    return e ? <section className="mb-14"><Heading o={o} scope={scope} /><p className="text-muted-foreground">{e}</p></section> : null;
  };

  switch (o.organism) {
    case "hero": {
      const [title, accent, kicker, lead, meta, sub] = [text(o.title, scope), text(o.accent, scope), text(o.kicker, scope), text(o.lead, scope), text(o.meta, scope), text(o.subtitle, scope)];
      const center = o.align === "center";
      return (
        <div className={`rise mb-12 ${center ? "text-center" : ""}`}>
          {kicker && <Kicker className="mb-3">{kicker}</Kicker>}
          <div className={`flex flex-col gap-4 ${center ? "items-center" : "sm:flex-row sm:items-start sm:justify-between"}`}>
            <h1 className="text-4xl font-black tracking-tighter sm:text-5xl md:text-6xl"><Split text={title} accent={accent || undefined} split={o.split} /></h1>
            {meta && <span className="shrink-0 font-mono text-sm text-accent sm:pt-3">{meta}</span>}
            {!center && o.actions?.length ? <div className="no-print flex shrink-0 gap-3 self-start">{o.actions.map((a, i) => <ActionButton key={i} a={a} scope={scope} x={x} primary={a.primary ?? i === 0} />)}</div> : null}
          </div>
          {o.contact?.length ? <Contact items={o.contact} scope={scope} center={center} turnId={x.host.turnId} /> : null}
          {sub && <p className="mt-3 text-lg font-semibold italic text-muted-foreground">{sub}</p>}
          {lead && <Prose value={lead} className={`mt-5 max-w-3xl text-base text-muted-foreground sm:text-lg ${center ? "mx-auto" : ""}`} />}
        </div>
      );
    }
    case "prose": {
      const v = text(o.from ? `$${o.from}` : o.lead, answer);
      return v ? <section className="mb-14"><Heading o={o} scope={scope} /><Prose value={v} className="max-w-3xl text-muted-foreground" /></section> : null;
    }
    case "tags": {
      const pick = o.tagGo ? (t: string) => ask(x, o.tagGo!, { ...scope, item: t, $item: t }) : undefined;
      return rowsOrEmpty(<section className="mb-14"><Heading o={o} scope={scope} className="mb-4" /><TagList tags={rows.map(String)} onPick={pick} active={x.active} /></section>);
    }
    case "stats": return <Stats o={o} scope={scope} x={x} />;
    case "facets": return <Facets o={o} answer={answer} scope={scope} x={x} />;
    case "list":
      return rowsOrEmpty(
        <section className="mb-14"><Heading o={o} scope={scope} />
          <ul className="space-y-3">{rows.map((r, i) => <Molecule key={i} m={typeof r === "object" ? { ...m!, as: "row" } : { as: "row", title: "$" }} row={r} x={x} i={i} />)}</ul>
        </section>);
    case "timeline":
      return rowsOrEmpty(
        <section className="mb-14"><Heading o={o} scope={scope} className="mb-8" />
          <ol className="flex flex-col">{rows.map((r, i) => <Molecule key={(r as any)?.id ?? i} m={{ ...m!, as: "event" }} row={r} x={x} i={i} last={i === rows.length - 1} />)}</ol>
        </section>);
    case "features":
      return rowsOrEmpty(
        <section className="mb-14"><Heading o={o} scope={scope} className="mb-10" />
          <div className={`grid grid-cols-1 gap-8 ${gridCols(o.columns ?? 3, rows.length)}`}>{rows.map((r, i) => <Molecule key={(r as any)?.id ?? i} m={{ ...m!, as: "feature" }} row={r} x={x} i={i} icon={icon(i)} />)}</div>
        </section>);
    case "steps":
      return rowsOrEmpty(
        <section className="mb-14"><Heading o={o} scope={scope} className="mb-10" />
          {o.compact ? (
            <ol className={`mx-auto grid max-w-5xl gap-6 ${rows.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
              {rows.map((r, i) => { const f = fill(m!, r, x.icons); return (
                <li key={(r as any)?.id ?? i} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-black text-accent-foreground">{f.number || i + 1}</span>
                  <div><p className="font-bold">{f.title}</p>{f.body && <p className="text-sm text-muted-foreground">{f.body}</p>}</div>
                </li>); })}
            </ol>
          ) : <div className={`grid grid-cols-1 gap-6 sm:gap-8 ${gridCols(o.columns, rows.length)}`}>{rows.map((r, i) => <Molecule key={(r as any)?.id ?? i} m={{ ...m!, as: "step" }} row={r} x={x} i={i} icon={icon(i)} />)}</div>}
        </section>);
    case "chips": {
      const groups = groupsOf(o, rows);
      return rowsOrEmpty(
        <section className="mb-14"><Heading o={o} scope={scope} className="mb-8" />
          <div className="space-y-5">
            {groups.map(([g, rs]) => (
              <div key={g} className={g ? "flex flex-col gap-3 sm:flex-row sm:gap-6" : ""}>
                {g && <span className="w-36 shrink-0 text-sm font-bold text-foreground">{g}</span>}
                <div className="flex flex-wrap gap-2">{rs.map((r, i) => <Molecule key={(r as any)?.id ?? i} m={{ ...m!, as: "chip" }} row={r} x={x} i={i} />)}</div>
              </div>
            ))}
          </div>
        </section>);
    }
    case "quotes":
      return rowsOrEmpty(<section className="mb-14"><Heading o={o} scope={scope} /><div className="space-y-8">{rows.map((r, i) => <Molecule key={(r as any)?.id ?? i} m={{ ...m!, as: "quote" }} row={r} x={x} i={i} />)}</div></section>);
    case "prompts":
      return rowsOrEmpty(<section className="mb-14"><Heading o={o} scope={scope} /><div className="space-y-3">{rows.map((r, i) => <Molecule key={(r as any)?.id ?? i} m={{ ...m!, as: "prompt" }} row={r} x={x} i={i} />)}</div></section>);
    case "faq": {
      // diarmuradi/faq-11: grouped, the groups sit in columns and each opens on its first question
      const groups = groupsOf(o, rows);
      return rowsOrEmpty(
        <section className="mb-14"><Heading o={o} scope={scope} />
          <div className={groups.length > 1 ? "flex flex-col gap-6 md:flex-row md:gap-10" : ""}>
            {groups.map(([g, rs]) => (
              <div key={g} className="flex flex-1 flex-col gap-4">
                {g && <h3 className="text-lg font-black tracking-tight">{g}</h3>}
                <div className="space-y-2">{rs.map((r, i) => <Molecule key={(r as any)?.id ?? i} m={{ ...m!, as: "disclosure" }} row={r} x={x} i={i} />)}</div>
              </div>
            ))}
          </div>
        </section>);
    }
    case "panel":
      return (
        <section className="rise mb-14 overflow-hidden rounded-lg border border-border bg-card">
          <div className="grid gap-8 p-6 sm:p-8 md:grid-cols-3">
            {(o.blocks ?? []).map((b, i) => {
              const v = text(`$${b.from}`, answer);
              return v ? <div key={b.label} className={i === 0 ? "md:col-span-1" : "md:col-span-2 md:col-start-2"}><Kicker className="mb-2">{b.label}</Kicker><p className={`leading-relaxed ${i === 0 ? "font-medium text-foreground" : "text-muted-foreground"}`}>{v}</p></div> : null;
            })}
          </div>
        </section>
      );
    case "callout": {
      const t = text(o.title, scope), l = text(o.lead, scope);
      if (t && (l || o.actions?.length)) return (
        <div className="mb-14 rounded-lg border border-border bg-gradient-to-br from-card to-background p-8 text-center shadow-2xl sm:p-12">
          <h3 className="mb-4 text-2xl font-black tracking-tighter sm:text-3xl">{t}</h3>
          {l && <p className="mx-auto mb-8 max-w-2xl text-base italic text-muted-foreground sm:text-lg">{l}</p>}
          <div className="flex flex-wrap justify-center gap-3">{(o.actions ?? []).map((a, i) => <ActionButton key={i} a={a} scope={scope} x={x} primary={a.primary ?? i === 0} />)}</div>
        </div>
      );
      const v = l || t;
      return v ? <p className="mb-12 rounded border border-accent/20 bg-accent/5 p-5 italic text-muted-foreground">{v}</p> : null;
    }
    case "actions":
      return <div className={`no-print mb-14 flex flex-wrap gap-3 ${o.align === "center" ? "justify-center" : ""}`}>{(o.actions ?? []).map((a, i) => <ActionButton key={i} a={a} scope={scope} x={x} primary={a.primary ?? i === 0} />)}</div>;
    case "facts": {
      const v = o.from && o.from !== "$" ? read(answer, o.from) : answer;
      if (v == null || v === "") return null;
      return <section className="mb-14"><Heading o={o} scope={scope} /><Facts v={v} /></section>;
    }
    default: {
      const groups = groupsOf(o, rows);
      const columns = o.groupLayout === "columns" && groups.length > 1;
      return rowsOrEmpty(
        <section className="mb-14"><Heading o={o} scope={scope} />
          <div className={columns ? `grid grid-cols-1 gap-10 ${groups.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3"}` : ""}>
            {groups.map(([g, rs]) => (
              <div key={g} className={columns ? "" : "mb-10 last:mb-0"}>
                {g && <Kicker className={columns ? "mb-5" : "mb-6"}>{g}</Kicker>}
                <div className={columns ? "space-y-4" : `grid grid-cols-1 gap-6 ${gridCols(o.columns ?? 2, rs.length)}`}>
                  {rs.map((r, i) => <Molecule key={(r as any)?.id ?? i} m={m!} row={r} x={x} i={i} icon={icon(i)} />)}
                </div>
              </div>
            ))}
          </div>
        </section>);
    }
  }
}

/** designali-in/stats-2's figure, with stats-cards-with-links' footer when the figure opens something. */
function Stats({ o, scope, x }: { o: ResolvedOrganism; scope: Record<string, unknown>; x: Ctx }) {
  const stats = (o.stats ?? []).map((s) => ({ s, value: text(s.value, scope), label: text(s.label, scope), detail: text(s.detail, scope) })).filter((s) => s.value && s.value !== "0");
  if (!stats.length) return null;
  return (
    <section className="mb-14"><Heading o={o} scope={scope} />
      <dl className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${stats.length >= 4 ? "lg:grid-cols-4" : stats.length === 3 ? "lg:grid-cols-3" : ""}`}>
        {stats.map(({ s, value, label, detail }, i) => (
          <div key={i} className={`rise ${i < 4 ? `rise-${i + 1}` : ""} flex flex-col justify-between rounded-lg border border-border bg-card`}>
            <div className="p-6">
              <dt className="text-xs font-black uppercase tracking-[0.2em] text-muted-foreground">{label}</dt>
              <dd className="mt-3 text-5xl font-black tracking-tighter text-accent">{value}</dd>
              {detail && <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail}</dd>}
            </div>
            {s.go && <button onClick={() => ask(x, s.go!, scope)} className="no-print border-t border-border px-6 py-3 text-right text-xs font-black uppercase tracking-widest text-accent hover:bg-background">View →</button>}
          </div>
        ))}
      </dl>
    </section>
  );
}

/** cnippet-dev/v-toggle-10: a panel of chips with counts, a summary of what is set, and a way to clear it. */
function Facets({ o, answer, scope, x }: { o: ResolvedOrganism; answer: unknown; scope: Record<string, unknown>; x: Ctx }) {
  const facets = (o.facets ?? []).map((f) => {
    const src = f.from ? read(answer, f.from) : undefined;
    const values = f.field
      ? [...new Set((Array.isArray(src) ? src : []).flatMap((r) => { const v = read(r, f.field!); return Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]; }))].sort()
      : Array.isArray(src) ? src.map(String) : [];
    const counted = f.countIn ? (read(answer, f.countIn.from) as unknown[] | undefined) ?? [] : undefined;
    const count = (v: string) => counted?.filter((r) => { const x = read(r, f.countIn!.field); return Array.isArray(x) ? x.map(String).includes(v) : String(x) === v; }).length;
    const current = x.args[f.arg] == null ? undefined : String(x.args[f.arg]);
    return { f, values, count, current };
  }).filter((f) => f.values.length || f.current);
  const set = facets.filter((f) => f.current);
  const clear = () => x.host.go(x.shape, Object.fromEntries(Object.entries(x.args).filter(([k]) => !(o.facets ?? []).some((f) => f.arg === k))));
  const pick = (arg: string, v: string) => ask(x, { shape: x.shape, args: { [arg]: v } }, scope);
  const t = text(o.title, scope);
  return (
    <section className="no-print rise rise-1 mb-12 space-y-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-accent"><SlidersHorizontal className="h-3.5 w-3.5" />{t && <Kicker>{t}</Kicker>}</div>
        {set.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {text(o.summary, scope) && <span className="text-muted-foreground">{text(o.summary, scope)}</span>}
            {set.map(({ f, current }) => (
              <button key={f.arg} onClick={() => pick(f.arg, current!)} className="inline-flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-xs font-bold text-accent-foreground" aria-label={`Remove ${current}`}>{current} <X className="h-3 w-3" /></button>
            ))}
            <button onClick={clear} className="text-xs font-black uppercase tracking-widest text-accent hover:underline">Clear</button>
          </div>
        )}
      </div>
      {facets.filter((x) => x.values.length).map(({ f, values, count, current }) => (
        <div key={f.arg} className="flex flex-col gap-2 sm:flex-row sm:gap-4">
          <span className="w-24 shrink-0 pt-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">{f.label}</span>
          <div className="flex flex-wrap gap-1.5">
            {values.map((v) => {
              const on = current?.toLowerCase() === v.toLowerCase();
              const n = count(v);
              return (
                <button key={v} onClick={() => pick(f.arg, v)} aria-pressed={on}
                  className={`inline-flex items-center gap-1.5 rounded border px-3 py-1 font-mono text-xs transition-colors ${on ? "border-accent bg-accent text-accent-foreground" : "border-border bg-background text-muted-foreground hover:border-accent hover:text-foreground"}`}>
                  {v}{n != null && <span className={`rounded px-1 text-[10px] ${on ? "bg-black/20" : "bg-card text-muted-foreground/60"}`}>{n}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {text(o.hint, scope) && <p className="text-xs text-muted-foreground/60">{text(o.hint, scope)}</p>}
    </section>
  );
}

/** A hero's contact line: where, and how to reach them, the reachable ones as links. */
function Contact({ items, scope, center, turnId }: { items: Action[]; scope: unknown; center: boolean; turnId?: string | null }) {
  const shown = items.map((a) => ({ label: text(a.label, scope), href: a.href ? text(a.href, scope) : "" })).filter((a) => a.label);
  if (!shown.length) return null;
  return (
    <ul className={`mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground ${center ? "justify-center" : ""}`}>
      {shown.map((a, i) => (
        <li key={i} className="flex items-center gap-3">
          {i > 0 && <span aria-hidden className="text-accent">·</span>}
          {a.href && /^(mailto|tel):/i.test(a.href)
            ? <a href={a.href} rel="noreferrer" className="font-semibold text-foreground underline-offset-4 hover:text-accent hover:underline">{a.label}</a>
            : a.href ? <OutLink href={a.href} turnId={turnId} className="font-semibold text-foreground underline-offset-4 hover:text-accent hover:underline">{a.label}</OutLink> : <span>{a.label}</span>}
        </li>
      ))}
    </ul>
  );
}

function ActionButton({ a, scope, x, primary }: { a: Action; scope: unknown; x: Ctx; primary: boolean }) {
  const cls = primary ? "inline-flex items-center gap-2 rounded bg-accent px-6 py-3 font-black text-accent-foreground hover:brightness-110" : "inline-flex items-center gap-2 rounded border border-border px-6 py-3 font-bold text-muted-foreground hover:border-accent hover:text-foreground";
  const label = text(a.label, scope);
  if (a.print) return <button onClick={() => print()} className={`no-print ${cls}`}><Printer size={16} /> {label}</button>;
  if (a.href) { const href = text(a.href, scope); return href ? <OutLink href={href} turnId={x.host.turnId} className={cls}>{label} <ExternalLink size={14} /></OutLink> : null; }
  if (!a.shape) return null;
  return <button onClick={() => ask(x, { shape: a.shape!, args: a.args }, scope)} className={cls}>{label}</button>;
}

/** The last resort, for a value no organism claims: readable, never raw JSON. */
function Facts({ v }: { v: unknown }) {
  if (Array.isArray(v)) return <ul className="space-y-2">{v.map((x, i) => <li key={i} className="rounded border border-border bg-card p-3 text-sm text-muted-foreground"><Facts v={x} /></li>)}</ul>;
  if (v && typeof v === "object") return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      {Object.entries(v).filter(([k, x]) => k !== "id" && x != null && x !== "").map(([k, x]) => (
        <div key={k} className="contents"><dt className="text-xs font-black uppercase tracking-widest text-muted-foreground">{k}</dt><dd className="text-foreground"><Facts v={x} /></dd></div>
      ))}
    </dl>
  );
  return <>{String(v)}</>;
}

// ── the pour ──────────────────────────────────────────────────────────────────────────────────────

const WIDTH = { narrow: "max-w-4xl", normal: "max-w-5xl", wide: "max-w-7xl" } as const;
const key = (s: string, a: Record<string, unknown>) => `${s}:${JSON.stringify(Object.entries(a).filter(([, v]) => v != null).sort())}`;

/** Chips a molecule, a tag, a stat or an action already offers (same shape, same arguments) are not repeated as threads. */
function leftover(next: Chip[], answer: unknown, scope: unknown, tree: PresentTree, host: PresentHost): Chip[] {
  const offered = new Set<string>();
  const add = (g: Go | undefined, row: unknown) => g && offered.add(key(g.shape, Object.fromEntries(Object.entries(g.args ?? {}).map(([k, b]) => [k, b === "$" ? row : bind(b, row)]))));
  for (const o of tree.organisms) {
    for (const a of o.actions ?? []) if (a.shape) add({ shape: a.shape, args: a.args }, scope);
    for (const s of o.stats ?? []) add(s.go, scope);
    const rows = rowsOf(o, answer);
    if (o.organism === "tags") { for (const t of rows) add(o.tagGo, { item: t, $item: t }); continue; }
    if (!o.molecule) continue;
    for (const r of rows) {
      add(o.molecule.go, r);
      for (const t of o.molecule.tags ?? []) for (const v of (read(r, t.from) as string[] | undefined) ?? []) add(t.go, { ...(r as object), item: v, $item: v });
    }
  }
  return next.filter((ch) => !host.offered?.(ch) && !offered.has(key(ch.shape, ch.args ?? {})));
}

type AnswerPour = Extract<Pour, { kind: "answer" }> & { present?: PresentTree };

/** Whether this answer should be drawn from its layout: the application declared one for its shape. */
export const declaredLayout = (pour: Pour): pour is AnswerPour & { present: PresentTree } =>
  pour.kind === "answer" && (pour as AnswerPour).present?.source === "declared";

export function PresentAnswer({ pour, host }: { pour: AnswerPour; host: PresentHost }) {
  const answer = pour.answer;
  const tree = pour.present;
  if (!tree) return null;
  const args = host.args ?? {};
  const scope = { ...(answer && typeof answer === "object" && !Array.isArray(answer) ? answer : {}), $phrase: pour.phrase, $args: args, $answer: answer } as Record<string, unknown>;
  const x: Ctx = { host, shape: pour.shape, args, icons: tree.icons, active: new Set(Object.values(args).filter((v) => typeof v === "string").map((v) => (v as string).toLowerCase())) };
  const threads = host.threads === false ? [] : leftover(pour.next, answer, scope, tree, host);

  // consecutive organisms of one width share a container; a band breaks out to the full width
  const runs: { band: boolean; width: keyof typeof WIDTH; items: ResolvedOrganism[] }[] = [];
  for (const o of tree.organisms) {
    const band = !!o.band, width = o.width ?? "normal", last = runs[runs.length - 1];
    if (last && last.band === band && last.width === width) last.items.push(o);
    else runs.push({ band, width, items: [o] });
  }
  return (
    <div className="print-plain" data-present={pour.shape} data-present-source={tree.source}>
      {runs.map((run, i) => (
        <section key={i} className={`${run.band ? "bg-muted py-16 sm:py-24" : `${i === 0 ? "pt-14 sm:pt-20" : "pt-4"} ${i === runs.length - 1 ? "pb-6" : ""}`}`}>
          <div className={`mx-auto ${WIDTH[run.width]} px-4 sm:px-6 lg:px-8`}>
            {i === 0 && host.crumb && <button onClick={host.crumb.go} className="no-print mb-6 text-xs font-black uppercase tracking-[0.2em] text-muted-foreground hover:text-accent">{host.crumb.label} /</button>}
            {run.items.map((o, j) => <Organism key={j} o={o} answer={answer} scope={scope} x={x} />)}
          </div>
        </section>
      ))}
      {threads.length > 0 && (
        <div className="no-print border-t border-border/40 bg-muted">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-8 sm:px-6 lg:px-8">
            <span className="mr-1 text-xs font-black uppercase tracking-[0.2em] text-accent">Pull a thread</span>
            {threads.map((ch, i) => (
              <button key={`${ch.shape}-${i}`} onClick={() => host.go(ch.shape, ch.args)}
                className="rounded border border-border bg-card px-3 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:border-accent hover:text-foreground">{ch.label}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
