/**
 * `rules.site` — the site map a front end navigates by, declared once in the spec.
 *
 *   home      the shape `/` pours
 *   sections  the top-level destinations, in menu order
 *   parents   where "up" goes from a shape that is not a section (a role → the résumé)
 *   actions   shapes that open *over* whatever section the visitor is on — contact, remember me — rather
 *             than replacing it, keyed by a short name a shell can call them by
 *   copy      the few sentences a shell needs that are about this business, not about shapes: the page's
 *             title and description, the input's placeholder, the call to action in the footer. They live
 *             here so a shell has no business in it.
 *   suggestions things a visitor might ask, in their words: the menu rotates them through the input's
 *             placeholder ("Ask anything — …") and offers the first three as chips that fill the input
 *   analytics page analytics the site's pages load (never /admin): `google`, a GA4 measurement id. The UI
 *             server writes the tag into the page's <head> at build time, and by default loads it only once
 *             the visitor accepts in a consent banner (`consent: false` loads it at once; `notice` is the
 *             banner's sentence). A site without it loads nothing.
 *   menu      how the shell wears the Ask anything menu: `layout` "card" (floating, the default) or "flush"
 *             (the full-width band under the header, no card), and what a suggestion chip does —
 *             `suggestions` "fill" (into the input, the default) or "ask" (at once).
 *   brand     the business's own marks, for a shell that would otherwise set its name in type: `logo` (an
 *             image in public/, drawn in the header at `height` and in the footer at `footerHeight`), `icons`
 *             (the favicon and touch icons, written into <head>), `themeColor`, and `image` + `url` (the
 *             picture and canonical address a shared link shows). Every path is in the site's public/ (`/…`)
 *             or an https URL — nothing else reaches the page.
 *
 * Nothing in the core reads it: it is for shells. It is in the spec, and checked, because every name in it
 * is a shape name and a typo there is a dead menu item nobody notices until a visitor does.
 */
import type { SpecLike } from "./present.ts";

export interface SiteSection { shape: string; label: string }
export interface SiteRules {
  doc?: string;
  home: string;
  sections: SiteSection[];
  parents?: Record<string, string>;
  actions?: Record<string, SiteSection>;
  copy?: { title?: string; description?: string; ask?: string; cta?: { title?: string; lead?: string; label?: string } };
  suggestions?: string[];
  analytics?: { google?: string; consent?: boolean; notice?: string };
  brand?: SiteBrand;
  menu?: { layout?: "card" | "flush"; suggestions?: "fill" | "ask" };
}

export interface SiteIcon { rel: "icon" | "apple-touch-icon"; href: string; type?: string; sizes?: string }
export interface SiteBrand {
  logo?: { src: string; alt?: string; height?: number; footerHeight?: number };
  icons?: SiteIcon[];
  themeColor?: string;
  image?: string;
  url?: string;
}

/** A path in the site's public/ ("/logo.png") or an https URL: what a brand may point at. */
const assetPath = (s: unknown) => typeof s === "string" && (/^\/(?!\/)[A-Za-z0-9._~\/-]+$/.test(s) || /^https:\/\/[^\s"<>]+$/.test(s));

function checkBrand(b: SiteBrand): string[] {
  const out: string[] = [];
  if (b.logo) {
    if (!assetPath(b.logo.src)) out.push(`rules.site.brand.logo.src: "${b.logo.src}" is neither a /path in public/ nor an https URL`);
    for (const k of ["height", "footerHeight"] as const) {
      const h = b.logo[k];
      if (h !== undefined && !(Number.isFinite(h) && h >= 12 && h <= 160)) out.push(`rules.site.brand.logo.${k}: ${h} is not a height between 12 and 160 px`);
    }
  }
  for (const [i, ic] of (b.icons ?? []).entries()) {
    if (ic.rel !== "icon" && ic.rel !== "apple-touch-icon") out.push(`rules.site.brand.icons[${i}].rel: "${ic.rel}" is not icon or apple-touch-icon`);
    if (!assetPath(ic.href)) out.push(`rules.site.brand.icons[${i}].href: "${ic.href}" is neither a /path in public/ nor an https URL`);
    if (ic.sizes !== undefined && !/^(\d+x\d+)( \d+x\d+)*$|^any$/.test(ic.sizes)) out.push(`rules.site.brand.icons[${i}].sizes: "${ic.sizes}" is not like 32x32`);
    if (ic.type !== undefined && !/^image\/[a-z0-9.+-]+$/.test(ic.type)) out.push(`rules.site.brand.icons[${i}].type: "${ic.type}" is not an image type`);
  }
  if (b.themeColor !== undefined && !/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(b.themeColor)) out.push(`rules.site.brand.themeColor: "${b.themeColor}" is not a #hex colour`);
  if (b.image !== undefined && !assetPath(b.image)) out.push(`rules.site.brand.image: "${b.image}" is neither a /path in public/ nor an https URL`);
  if (b.url !== undefined && !/^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/?$/.test(b.url)) out.push(`rules.site.brand.url: "${b.url}" is not an https origin (https://example.com)`);
  return out;
}

/** Problems with `rules.site`: shapes that do not exist, a parent that is not a section, a home off the menu. */
export function checkSite(spec: SpecLike): string[] {
  const site = (spec.rules as { site?: SiteRules }).site;
  if (!site) return [];
  const out: string[] = [];
  const known = (s: string) => s in spec.shapes && s !== "version";
  const sections = new Set((site.sections ?? []).map((s) => s.shape));
  if (!known(site.home)) out.push(`rules.site.home: no shape "${site.home}"`);
  else if (!sections.has(site.home)) out.push(`rules.site.home: "${site.home}" is not one of the sections`);
  for (const [i, s] of (site.sections ?? []).entries()) if (!known(s.shape)) out.push(`rules.site.sections[${i}]: no shape "${s.shape}"`);
  for (const [child, parent] of Object.entries(site.parents ?? {})) {
    if (!known(child)) out.push(`rules.site.parents: no shape "${child}"`);
    if (!sections.has(parent)) out.push(`rules.site.parents.${child}: "${parent}" is not a section`);
    if (sections.has(child)) out.push(`rules.site.parents.${child}: a section has no parent`);
  }
  for (const [k, a] of Object.entries(site.actions ?? {})) {
    if (!known(a.shape)) out.push(`rules.site.actions.${k}: no shape "${a.shape}"`);
    if (sections.has(a.shape)) out.push(`rules.site.actions.${k}: "${a.shape}" is a section, not something that opens over one`);
  }
  for (const [i, s] of (site.suggestions ?? []).entries()) if (typeof s !== "string" || !s.trim()) out.push(`rules.site.suggestions[${i}]: an empty suggestion`);
  const ga = site.analytics?.google;
  if (ga !== undefined && !/^G-[A-Z0-9]{4,}$/.test(ga)) out.push(`rules.site.analytics.google: "${ga}" is not a GA4 measurement id (G-…)`);
  if (site.brand) out.push(...checkBrand(site.brand));
  const menu = site.menu;
  if (menu?.layout !== undefined && menu.layout !== "card" && menu.layout !== "flush") out.push(`rules.site.menu.layout: "${menu.layout}" is not card or flush`);
  if (menu?.suggestions !== undefined && menu.suggestions !== "fill" && menu.suggestions !== "ask") out.push(`rules.site.menu.suggestions: "${menu.suggestions}" is not fill or ask`);
  return out;
}
