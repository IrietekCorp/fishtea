/**
 * `rules.site` — the site map a front end navigates by, declared once in the spec.
 *
 *   home      the shape `/` pours
 *   sections  the top-level destinations, in menu order
 *   parents   where "up" goes from a shape that is not a section (a role → the résumé)
 *   actions   shapes that open *over* whatever section the visitor is on — contact, remember me — rather
 *             than replacing it, keyed by a short name a shell can call them by
 *   copy      the few sentences a shell needs that are about this business, not about shapes: the input's
 *             placeholder, the call to action in the footer. They live here so a shell has no business in it.
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
  copy?: { ask?: string; cta?: { title?: string; lead?: string; label?: string } };
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
  return out;
}
