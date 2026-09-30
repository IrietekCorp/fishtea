/**
 * The site map, read from the application's spec.json (`rules.site`, checked at load by @fishtea/spec's
 * site.ts): which shapes are top-level sections, and in what order; which section every other shape lives
 * under, so "up" knows where to go; which shapes are actions that open over a section rather than replace
 * it; and the few sentences of business copy a shell needs. Nothing here names a shape of any business.
 */
import spec from "@app/spec.json";

export interface Section { shape: string; label: string }
export interface Action { shape: string; label: string }
interface SiteRules { home: string; sections: Section[]; parents: Record<string, string>; actions: Record<string, Action>; copy?: { ask?: string; cta?: { title?: string; lead?: string; label?: string } } }

const rules = (spec as any).rules.site as SiteRules;
const shapes = (spec as any).shapes as Record<string, { asks: string; input: Record<string, unknown> }>;

export const business = (spec as any).business as { name: string; doc?: string };
export const home = rules.home;
export const sections = rules.sections;
export const actions = rules.actions;
/** The shell's few business sentences — the input's placeholder, the footer's call to action — from the spec. */
export const copy = { ask: rules.copy?.ask ?? "Ask anything", cta: { title: rules.copy?.cta?.title ?? "", lead: rules.copy?.cta?.lead ?? "", label: rules.copy?.cta?.label ?? actions.contact?.label ?? "" } };

export const isSection = (shape?: string) => !!shape && sections.some((s) => s.shape === shape);
export const isAction = (shape?: string) => !!shape && Object.values(actions).some((a) => a.shape === shape);
export const knownShape = (shape: string) => shape in shapes && shape !== "version";

/** The section a shape belongs to: itself for a section, its declared parent otherwise, home as a last resort. */
export function sectionOf(shape?: string): string {
  if (!shape) return home;
  if (isSection(shape)) return shape;
  return rules.parents[shape] ?? home;
}

/** Where Up goes: a child to its section, a section to home, home nowhere. */
export function parentOf(shape?: string): string | null {
  if (!shape || shape === home) return null;
  if (isSection(shape)) return home;
  return rules.parents[shape] ?? home;
}

/** A readable name for any shape: the section label, or the part of `asks` before its colon. */
export function labelOf(shape: string): string {
  const s = sections.find((x) => x.shape === shape);
  if (s) return s.label;
  const a = Object.values(actions).find((x) => x.shape === shape);
  if (a) return a.label;
  return (shapes[shape]?.asks ?? shape).split(/[:—]/)[0].trim();
}

/** Child shapes of a section, for the sitemap. */
export const childrenOf = (section: string) => Object.entries(rules.parents).filter(([, p]) => p === section).map(([c]) => c);
export const needsInput = (shape: string) => Object.values(shapes[shape]?.input ?? {}).some((t) => typeof t === "string" ? !t.includes("?") && !t.includes("=") : !String((t as any).type).includes("?"));

// ── URLs ──────────────────────────────────────────────────────────────────────
//
//   /                          home
//   /resume?industry=Fintech   a section, with its arguments
//   /resume/role?organization=Gusto   a child, under its section
//   /resume?q=fintech+leaders  something typed, re-asked on a fresh load
//   …#getInTouch               an action open over that page

export interface Route { shape?: string; args: Record<string, string>; text?: string; action?: string }

export function urlFor(r: Route): string {
  const base = r.shape && r.shape !== home ? (isSection(r.shape) ? `/${r.shape}` : `/${sectionOf(r.shape)}/${r.shape}`).replace(`/${home}/`, "/") : "/";
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(r.args ?? {})) if (v != null && v !== "" && typeof v !== "object") q.set(k, String(v));
  if (r.text && !q.size) q.set("q", r.text);
  return `${base}${q.size ? `?${q}` : ""}${r.action ? `#${r.action}` : ""}`;
}

export function parseLocation(loc: Location = location): Route {
  const parts = loc.pathname.split("/").filter(Boolean);
  // /debug lived here once; it is part of /admin now, behind a sign-in
  if (parts[0] === "debug") { location.replace("/admin/visitors"); return { args: {} }; }
  const last = parts[parts.length - 1];
  const shape = last && knownShape(last) ? last : parts.length ? undefined : home;
  const args: Record<string, string> = {};
  let text: string | undefined;
  new URLSearchParams(loc.search).forEach((v, k) => { if (k === "q") text = v; else if (!k.startsWith("utm_") && k !== "ref" && k !== "t") args[k] = v; });
  const action = loc.hash.slice(1) || undefined;
  return { shape, args, text, action: action && isAction(action) ? action : undefined };
}
