/**
 * The answer side's UI language: what an answer *looks like*, stated in the spec the way the question
 * side's triggers state what a question *means*.
 *
 * Three layers, in atomic-design terms:
 *
 *   atoms      a field's type (text, date, url, string[], enum…) decides how one value reads
 *   molecules  one per entity — which of its fields is the title, the eyebrow, the body, the link —
 *              so a project reads the same wherever a shape pours one
 *   organisms  per shape, an ordered list of sections (hero, grid, timeline, quotes, faq…) that says
 *              which part of the answer each one lays out
 *
 * Every layer is declared in `rules.present` when someone has an opinion, and *derived* from the spec
 * when nobody has: field types and names give a molecule, a shape's answer type gives its organisms,
 * and a shape's `next[]` with `each: "answer.x"` says what clicking a molecule in `x` asks. That
 * derivation is the "training": no model chooses a widget at request time, so the same answer always
 * renders the same way and a new shape renders sensibly before anyone has designed for it.
 *
 * It stays a layout, not a program: bindings read fields, format them and count rows, and nothing in
 * this file decides what the business does — rules live in `spec.rules` and compute modules. The
 * filters are a closed set; a new one is a change here, reviewed, not something a spec can define.
 *
 * Nothing here is React, and the file lives in two places, kept identical: `@fishtea/spec`
 * (`src/present.ts`), where the core resolves the tree it sends with each answer (`pour.present`) and
 * `fishtea validate` checks the declarations; and an application's site shell
 * (`site/src/fishtea/present/grammar.ts`), which resolves the same tree when a core sends none.
 */
export type Scalar = string | number | boolean | null | undefined;

/**
 * A binding. `$path` reads a value; any other string is a template in which `{path}` is replaced, with
 * filters after a bar: `{d|date}`, `{d|year}`, `{s|upper}`, `{rows|count}`, `{rows|count:kind=patent}`
 * (rows whose field equals a value), `{name|before:·}` / `{name|after:·}` (either side of a separator,
 * trimmed), `{n|pad}` (two digits) and `{problem|or:description}` (another field when this one is empty). A template's ` · `-separated segments disappear when everything in
 * them is empty, so "{pillar} · {year}" never dangles. Plain text is a literal. The object form picks by a
 * field's value: `{ by: "$kind", map: { podcast: "Listen" } }`.
 *
 * Organism bindings also see `$$phrase` (the pour's phrase), `$$args` (the arguments the turn was asked
 * with) and `$$answer` (the answer itself, for an answer that is a list).
 */
export type Bind = string | { by: string; map: Record<string, string>; else?: string };

export type MoleculeKind = "card" | "feature" | "quote" | "row" | "disclosure" | "prompt" | "event" | "highlight" | "chip" | "step";

export interface Go { shape: string; args?: Record<string, Bind> }

/** A string[] field shown as tags, and what clicking one asks (the tag bound as `$item`). */
export interface TagSource { from: string; go?: Go }

export interface MoleculeDef {
  as?: MoleculeKind;
  eyebrow?: Bind; title?: Bind; subtitle?: Bind; body?: Bind; meta?: Bind;
  /** a step's number; the row's position when empty */
  number?: Bind;
  /** a tooltip */
  hint?: Bind;
  /** a string[] field (or several) shown as tags */
  tags?: string | TagSource[];
  /** a string[] field shown as a bulleted list */
  bullets?: string;
  /**
   * a field of rows shown as short quotes inside this one (a role's colleagues, in their words): each is
   * read for `quote` or `description` (the words), `name`, `title` and `company`, and `imageUrl`
   */
  quotes?: string;
  /** an ordinal field drawn as a meter, and its scale, low to high; derived from an enum named `level` */
  level?: string; levels?: string[];
  /** when this binds to something truthy the row is shown quietly — dimmed, its detail folded away */
  quiet?: Bind;
  image?: string; href?: string; cta?: Bind; icon?: Bind;
  /** the turn a click on this molecule asks; derived from the shape's next[] when absent */
  go?: Go;
  /** the turn a click on one of its tags asks, the tag's text bound as `$item` */
  tagGo?: Go;
}

export type OrganismKind =
  | "hero" | "prose" | "grid" | "features" | "list" | "timeline" | "quotes" | "faq" | "prompts"
  | "tags" | "panel" | "callout" | "actions" | "facts" | "stats" | "facets" | "chips" | "steps";

/** A turn to ask, a link to open, or (`print`) the browser's print dialog. */
export interface Action { label: Bind; shape?: string; args?: Record<string, Bind>; href?: Bind; primary?: boolean; print?: boolean }

/** One figure: a big value, what it counts, and optionally the turn that shows the rows behind it. */
export interface StatDef { value: Bind; label: Bind; detail?: Bind; go?: Go }

/**
 * One way to narrow the shape's own answer: its values are a string[] at `from`, or the distinct values
 * of `field` across the rows at `from`. Picking one re-asks this shape with `arg` set (or cleared, when
 * it was already set), keeping the other facets' arguments. `countIn` counts the rows carrying each value.
 * With no `from` it offers nothing to pick, and shows only as a chip to remove while its argument is set
 * (a typed search, a free-text focus).
 */
export interface FacetDef { label: string; arg: string; from?: string; field?: string; countIn?: { from: string; field: string } }

export interface OrganismDef {
  organism: OrganismKind;
  /** the part of the answer this lays out: a field of it, or "$" for the answer itself */
  from?: string;
  kicker?: Bind; title?: Bind; accent?: Bind; lead?: Bind; meta?: Bind; subtitle?: Bind;
  /** an entity name, or a molecule written in place */
  molecule?: string | MoleculeDef;
  /** keep only rows whose field is one of these values */
  where?: Record<string, string[]>;
  group?: string;
  columns?: 1 | 2 | 3;
  /** panel: labelled blocks of text read from the answer */
  blocks?: { label: string; from: string }[];
  actions?: Action[];
  /** shown in place of the organism when `from` is empty; nothing when absent */
  empty?: Bind;
  /** stats: the figures */
  stats?: StatDef[];
  /** facets: the ways to narrow; `summary` shows while any is set, `hint` below them */
  facets?: FacetDef[];
  summary?: Bind; hint?: Bind;
  /** a label per group value; values sharing a label share a group */
  groupLabel?: Record<string, string>;
  /** how groups sit: stacked (default), side by side, or as label-then-items rows */
  groupLayout?: "stack" | "columns" | "rows";
  /** icon words given to rows in turn, for rows that carry none */
  icons?: string[];
  /** hero: which words take the accent — all but the first, or the idea after the last " the " */
  split?: "first" | "headline";
  width?: "narrow" | "normal" | "wide";
  align?: "start" | "center";
  /** set on a full-bleed band of the alternate background */
  band?: boolean;
  /** steps: small numbered items in a row, not cards */
  compact?: boolean;
}

export interface PresentRules {
  doc?: string;
  /**
   * The words a molecule's `icon` binding may produce, mapped onto a renderer's icon vocabulary: a press
   * item's kind "podcast" → "mic". A word the map does not name is looked up as itself.
   */
  icons?: Record<string, string>;
  molecules?: Record<string, MoleculeDef>;
  shapes?: Record<string, OrganismDef[]>;
}

// ── the spec, read loosely: this module is shared by the site and a CLI ────────────────────────────

type FieldDef = { type: string; optional?: boolean; values?: string[] };
interface NextDef { label: string; shape: string; args?: Record<string, string>; each?: string }
interface ShapeDef { asks: string; answer: unknown; next?: NextDef[]; phrase?: string }
export interface SpecLike {
  entities: Record<string, unknown>;
  shapes: Record<string, unknown>;
  rules: { present?: PresentRules; site?: { parents?: Record<string, string> } } & Record<string, unknown>;
}

/** Where a resolved piece came from, so a reader can tell an opinion from an inference. */
export type Source = "declared" | "derived";

const entityFields = (spec: SpecLike, name: string): Record<string, FieldDef> | null => {
  const e = spec.entities[name] as { fields?: Record<string, FieldDef> } | undefined;
  return e && typeof e === "object" && e.fields ? e.fields : null;
};

/** `project[]` → { entity: "project", many: true }; `text?` → { scalar: "text" }. */
export function parseType(t: unknown, spec: SpecLike): { entity?: string; many: boolean; scalar?: string; object?: Record<string, unknown> } {
  if (t && typeof t === "object") return { many: false, object: t as Record<string, unknown> };
  const s = String(t ?? "json").replace(/[?]$/, "").replace(/=.*$/, "");
  const many = s.endsWith("[]");
  const base = many ? s.slice(0, -2) : s;
  return entityFields(spec, base) ? { entity: base, many } : { scalar: base, many };
}

// ── bindings ──────────────────────────────────────────────────────────────────────────────────────

export function read(scope: unknown, path: string): unknown {
  if (path === "$" || path === "") return scope;
  return path.replace(/^\$/, "").split(".").reduce<unknown>((v, k) => (v == null ? undefined : (v as Record<string, unknown>)[k]), scope);
}

const FILTERS: Record<string, (v: unknown, arg: string | undefined, scope: unknown) => string> = {
  or: (v, arg, scope) => show(v) || (arg ? show(read(scope, arg)) : ""),
  date: (v) => (v ? new Date(String(v)).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : ""),
  year: (v) => (v ? String(new Date(String(v)).getUTCFullYear()) : ""),
  count: (v, arg) => {
    if (!Array.isArray(v)) return "";
    if (!arg) return String(v.length);
    const [k, want] = arg.split("=");
    return String(v.filter((r) => String(read(r, k)) === want).length);
  },
  upper: (v) => (v == null ? "" : String(v).toUpperCase()),
  before: (v, sep = "·") => { const s = show(v); const i = s.indexOf(sep); return i < 0 ? "" : s.slice(0, i).trim(); },
  after: (v, sep = "·") => { const s = show(v); const i = s.indexOf(sep); return (i < 0 ? s : s.slice(i + sep.length)).trim(); },
  pad: (v) => (v == null || v === "" ? "" : String(v).padStart(2, "0")),
};

const show = (v: unknown): string => (v == null ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? "" : String(v));

/** Resolve a binding against a scope. A `$path` returns the raw value; everything else, a string. */
export function bind(b: Bind | undefined, scope: unknown): unknown {
  if (b == null) return undefined;
  if (typeof b === "object") return b.map[show(read(scope, b.by))] ?? b.else;
  if (/^\$\$?[\w.]*$/.test(b)) return read(scope, b);
  if (!b.includes("{")) return b;
  const fill = (seg: string) => {
    let empty = true;
    const out = seg.replace(/\{([\w.$]+)(?:\|(\w+)(?::([^}]*))?)?\}/g, (_, p: string, f?: string, arg?: string) => {
      const v = read(scope, p);
      const s = f && FILTERS[f] ? FILTERS[f](v, arg, scope) : show(v);
      if (s) empty = false;
      return s;
    });
    return /\{/.test(seg) && empty ? "" : out;
  };
  return b.split(" · ").map(fill).filter(Boolean).join(" · ");
}

export const text = (b: Bind | undefined, scope: unknown): string => show(bind(b, scope));

// ── molecules ─────────────────────────────────────────────────────────────────────────────────────

const pick = (keys: string[], names: string[]) => names.find((n) => keys.includes(n));

/**
 * A molecule from field names and types alone. `types` is the entity's declared fields, widened with a
 * row's own keys — calls rename columns (a project's `summary` arrives as `description`), and the row
 * is what is actually on the page.
 */
export function deriveMolecule(types: Record<string, string>): MoleculeDef {
  const keys = Object.keys(types);
  const of = (t: string) => keys.filter((k) => types[k] === t);
  const title = pick(keys, ["name", "title", "question", "organization", "label", "headline"]);
  const body = pick(keys, ["description", "summary", "answer", "quote", "text", "detail", "note", "evidence"]) ?? of("text")[0];
  const kind = pick(keys, ["kind", "type", "topic", "category"]);
  const where = pick(keys, ["organization", "outlet", "company", "role"]);
  const when = pick(keys, ["period", "date", "year", "startDate"]) ?? of("date")[0];
  const tags = pick(keys, ["skills", "technologies", "tags"]) ?? of("string[]")[0];
  const m: MoleculeDef = {
    title: title && `$${title}`,
    body: body && `$${body}`,
    eyebrow: [kind, where !== title ? where : undefined].filter(Boolean).map((k) => `{${k}}`).join(" · ") || undefined,
    meta: when ? (types[when] === "date" || types[when] === "timestamp" ? `{${when}|date}` : `$${when}`) : undefined,
    tags,
    href: pick(keys, ["url", "href", "link"]),
    image: pick(keys, ["imageUrl", "image", "avatar", "photo"]),
  };
  if (keys.includes("quote") || (keys.includes("company") && body && keys.includes("name"))) {
    return { as: "quote", body: body && `$${body}`, title: "$name", subtitle: pick(keys, ["title"]) ? "{title} @ {company}" : "$company", image: m.image };
  }
  if (keys.includes("question") && keys.includes("answer")) return { as: "disclosure", title: "$question", body: "$answer", eyebrow: kind && `$${kind}` };
  if (!body && !tags && title) return { as: "row", title: m.title, meta: m.meta };
  return { as: "card", ...m };
}

const typeOfValue = (v: unknown): string =>
  Array.isArray(v) ? (v.every((x) => typeof x === "string") ? "string[]" : "json") :
  typeof v === "number" ? "int" : typeof v === "boolean" ? "boolean" :
  typeof v === "string" ? (/^\d{4}-\d{2}-\d{2}T/.test(v) ? "date" : /^https?:/.test(v) ? "url" : v.length > 90 ? "text" : "string") : "json";

export function typesOf(spec: SpecLike, entity?: string, row?: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, f] of Object.entries(entity ? entityFields(spec, entity) ?? {} : {})) if (k !== "id") out[k] = f.type;
  if (row && typeof row === "object" && !Array.isArray(row)) for (const [k, v] of Object.entries(row)) if (k !== "id" && !(k in out) && v != null) out[k] = typeOfValue(v);
  return out;
}

/**
 * An enum named `level` is an ordinal: draw it as a meter on its declared scale, and read a row that has
 * one as a competency — a chip that says its level at a glance and its evidence on hover.
 */
function withLevel(spec: SpecLike, entity: string | undefined, m: MoleculeDef): MoleculeDef {
  const f = entity ? entityFields(spec, entity)?.level : undefined;
  if (f?.type !== "enum" || !f.values?.length) return m;
  return { ...m, as: "chip", level: "level", levels: f.values, hint: m.body ? `{level} · {${String(m.body).replace(/^\$/, "")}}` : "$level", body: undefined, eyebrow: undefined };
}

/** The tag fields of a molecule, one shape whatever way they were written. */
export const tagSources = (m: MoleculeDef): TagSource[] =>
  !m.tags ? [] : typeof m.tags === "string" ? [{ from: m.tags, go: m.tagGo }] : m.tags.map((t) => ({ ...t, go: t.go ?? m.tagGo }));

/** The molecule for an entity: the declared one, or what its fields suggest. */
export function moleculeFor(spec: SpecLike, entity?: string, inline?: MoleculeDef, sample?: unknown): { def: MoleculeDef; source: Source } {
  const declared = inline ?? (entity ? spec.rules.present?.molecules?.[entity] : undefined);
  const derived = withLevel(spec, entity, deriveMolecule(typesOf(spec, entity, sample)));
  // A declared molecule is the whole opinion: a slot it leaves out is left out on purpose, not filled in.
  return declared ? { def: declared, source: "declared" } : { def: derived, source: "derived" };
}

/**
 * next[] speaks of `$item` (the row); a molecule's bindings read the row directly. `$item.name` becomes
 * `$name`, a bare `$item` becomes `$`, and `$item` inside a sentence ("Tell me about $item.name")
 * becomes a template, `{name}`.
 */
function fromItem(v: string): string {
  if (/^\$item(\.[\w.]+)?$/.test(v)) return v.replace(/^\$item\.?/, "$");
  return v.includes("$item") ? v.replace(/\$item\.([\w.]+)/g, "{$1}").replace(/\$item\b/g, "{$}") : v;
}

/** What clicking a row of `from` asks, read off the shape's `next[]` — the spec already says it. */
export function goFor(spec: SpecLike, shape: string, from: string): Go | undefined {
  const s = spec.shapes[shape] as ShapeDef | undefined;
  const n = s?.next?.find((x) => x.each === (from === "$" ? "answer" : `answer.${from}`));
  if (!n) return undefined;
  return { shape: n.shape, args: Object.fromEntries(Object.entries(n.args ?? {}).map(([k, v]) => [k, fromItem(String(v))])) };
}

// ── organisms ─────────────────────────────────────────────────────────────────────────────────────

const LIST_ORGANISM: Partial<Record<MoleculeKind, OrganismKind>> = { quote: "quotes", disclosure: "faq", prompt: "prompts", event: "timeline", row: "list", feature: "features", chip: "chips", step: "steps" };

/**
 * A shape's organisms from its answer type, for a shape nobody has laid out: a hero from its most
 * name-like field and its phrase, then each other field in declaration order as the section its type
 * suggests.
 */
export function deriveOrganisms(spec: SpecLike, shape: string): OrganismDef[] {
  const s = spec.shapes[shape] as ShapeDef | undefined;
  if (!s) return [];
  const t = parseType(s.answer, spec);
  if (t.entity && t.many) return [{ organism: "hero", title: "$$phrase" }, { organism: "grid", from: "$", molecule: t.entity }];
  if (t.entity) {
    const m = moleculeFor(spec, t.entity).def;
    return [
      { organism: "hero", kicker: m.eyebrow, title: m.title, subtitle: m.subtitle, lead: m.body },
      ...tagSources(m).map((t) => ({ organism: "tags", from: t.from }) as OrganismDef),
      ...(m.href ? [{ organism: "actions", actions: [{ label: "Visit", href: `$${m.href}` }] } as OrganismDef] : []),
    ];
  }
  if (!t.object) return [{ organism: "hero", title: "$$phrase" }, { organism: "facts", from: "$" }];

  const fields = Object.entries(t.object).map(([k, v]) => [k, String(v)] as const);
  const keys = fields.map(([k]) => k);
  const head = pick(keys, ["name", "title", "headline", "organization", "verdict", "question"]);
  const lead = fields.find(([k, v]) => k !== head && v.replace("?", "") === "text")?.[0];
  const out: OrganismDef[] = [{ organism: "hero", title: head ? `$${head}` : "$$phrase", lead: lead && `$${lead}` }];
  const links: Action[] = [];
  for (const [k, raw] of fields) {
    if (k === head || k === lead) continue;
    const ft = parseType(raw, spec);
    if (ft.entity) {
      const m = moleculeFor(spec, ft.entity).def;
      out.push({ organism: (ft.many && LIST_ORGANISM[m.as ?? "card"]) || "grid", from: k, title: humanize(k), molecule: ft.entity });
    } else if (ft.scalar === "url") links.push({ label: humanize(k.replace(/Url$/, "")), href: `$${k}` });
    else if (ft.scalar === "text") out.push({ organism: "prose", from: k, title: humanize(k) });
    else if (ft.scalar === "string[]" || (ft.many && ft.scalar === "string")) out.push({ organism: "tags", from: k, title: humanize(k) });
    else if (ft.scalar === "json") out.push({ organism: "list", from: k, title: humanize(k) });
    else if (ft.scalar !== "boolean") out.push({ organism: "facts", from: k, title: humanize(k) });
  }
  if (links.length) out.push({ organism: "actions", actions: links });
  return out;
}

export const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

export function organismsFor(spec: SpecLike, shape: string): { defs: OrganismDef[]; source: Source } {
  const declared = spec.rules.present?.shapes?.[shape];
  return declared ? { defs: declared, source: "declared" } : { defs: deriveOrganisms(spec, shape), source: "derived" };
}

/** The entity a section's rows are, from the shape's answer type — so `from: "work"` knows it holds projects. */
export function entityAt(spec: SpecLike, shape: string, from?: string): string | undefined {
  const s = spec.shapes[shape] as ShapeDef | undefined;
  if (!s || !from) return undefined;
  const t = parseType(s.answer, spec);
  if (from === "$") return t.entity;
  return t.object ? parseType(t.object[from], spec).entity : undefined;
}

/** Rows for a section: the value at `from`, as a list, filtered by `where`. */
export function rowsOf(o: OrganismDef, answer: unknown): unknown[] {
  const v = read(answer, o.from ?? "$");
  const rows = Array.isArray(v) ? v : v == null ? [] : [v];
  if (!o.where) return rows;
  return rows.filter((r) => Object.entries(o.where!).every(([k, vals]) => vals.includes(String(read(r, k)))));
}

// ── resolving: the tree a renderer draws ──────────────────────────────────────────────────────────

/** The molecule kind an organism draws its rows as, unless the molecule says otherwise. */
const ROW_KIND: Partial<Record<OrganismKind, MoleculeKind>> = {
  timeline: "event", list: "row", features: "feature", quotes: "quote", faq: "disclosure", prompts: "prompt", chips: "chip", steps: "step",
};
const HAS_ROWS: OrganismKind[] = ["grid", "features", "list", "timeline", "quotes", "faq", "prompts", "chips", "steps"];

/** An organism with everything a renderer would otherwise have to look up in the spec already filled in. */
export interface ResolvedOrganism extends OrganismDef {
  molecule?: MoleculeDef & { tags?: TagSource[] };
  /** where the molecule came from */
  moleculeSource?: Source | "inline";
  /** tags: what clicking one asks */
  tagGo?: Go;
}
export interface PresentTree { shape: string; source: Source; organisms: ResolvedOrganism[]; icons?: Record<string, string> }

/**
 * A shape's organisms with each one's molecule chosen (declared, inline, or derived from the entity and
 * the first row), its click and its tags' clicks read off `next[]`. Pure: the same spec and answer give
 * the same tree, which is what lets the core send it with the answer and a test pin it.
 */
export function resolve(spec: SpecLike, shape: string, answer?: unknown): PresentTree {
  const { defs, source } = organismsFor(spec, shape);
  const organisms = defs.map((o): ResolvedOrganism => {
    if (o.organism === "tags") {
      const g = goFor(spec, shape, o.from ?? "");
      return { ...o, molecule: undefined, tagGo: g && { shape: g.shape, args: Object.fromEntries(Object.entries(g.args ?? {}).map(([k, v]) => [k, v === "$" ? "$item" : v])) } };
    }
    if (!HAS_ROWS.includes(o.organism)) return { ...o, molecule: undefined };
    const rows = answer === undefined ? [] : rowsOf(o, answer);
    const entity = typeof o.molecule === "string" ? o.molecule : entityAt(spec, shape, o.from);
    const inline = typeof o.molecule === "object" ? o.molecule : undefined;
    const { def, source: ms } = moleculeFor(spec, entity, inline, rows[0]);
    const m: MoleculeDef = { ...def };
    const fixed = inline?.as ?? (entity ? spec.rules.present?.molecules?.[entity]?.as : undefined);
    const want = ROW_KIND[o.organism];
    if (want && !fixed && (o.organism !== "grid")) m.as = want;
    m.go ??= goFor(spec, shape, o.from ?? "$");
    const tags = tagSources(m).map((t) => {
      if (t.go) return t;
      const g = goFor(spec, shape, t.from);
      return { from: t.from, go: g && { shape: g.shape, args: Object.fromEntries(Object.entries(g.args ?? {}).map(([k, v]) => [k, v === "$" ? "$item" : v])) } };
    });
    return { ...o, molecule: { ...m, tags: tags.length ? tags : undefined, tagGo: undefined }, moleculeSource: inline ? "inline" : ms };
  });
  const icons = spec.rules.present?.icons;
  return { shape, source, organisms, ...(icons ? { icons } : {}) };
}

// ── checking ──────────────────────────────────────────────────────────────────────────────────────

const SHAPE_KINDS: OrganismKind[] = ["hero", "prose", "grid", "features", "list", "timeline", "quotes", "faq", "prompts", "tags", "panel", "callout", "actions", "facts", "stats", "facets", "chips", "steps"];
const MOLECULE_KINDS: MoleculeKind[] = ["card", "feature", "quote", "row", "disclosure", "prompt", "event", "highlight", "chip", "step"];

function checkMolecule(spec: SpecLike, at: string, m: MoleculeDef, out: string[]) {
  if (m.as && !MOLECULE_KINDS.includes(m.as)) out.push(`${at}: "${m.as}" is not a molecule (${MOLECULE_KINDS.join(", ")})`);
  for (const g of [m.go, m.tagGo, ...tagSources(m).map((t) => t.go)]) if (g && !(g.shape in spec.shapes)) out.push(`${at}: no shape "${g.shape}"`);
}

/** Problems a reader should fix: unknown organisms, `from` fields the answer does not have, shapes that do not exist. */
export function check(spec: SpecLike): string[] {
  const p = spec.rules.present;
  const out: string[] = [];
  if (!p) return out;
  for (const [e, m] of Object.entries(p.molecules ?? {})) {
    if (!entityFields(spec, e)) out.push(`present.molecules.${e}: no entity "${e}"`);
    checkMolecule(spec, `present.molecules.${e}`, m, out);
  }
  for (const [shape, defs] of Object.entries(p.shapes ?? {})) {
    const s = spec.shapes[shape] as ShapeDef | undefined;
    if (!s) { out.push(`present.shapes.${shape}: no such shape`); continue; }
    const t = parseType(s.answer, spec);
    const fields = t.object ? Object.keys(t.object) : t.entity ? Object.keys(entityFields(spec, t.entity) ?? {}) : [];
    defs.forEach((o, i) => {
      const at = `present.shapes.${shape}[${i}]`;
      if (!SHAPE_KINDS.includes(o.organism)) out.push(`${at}: "${o.organism}" is not an organism (${SHAPE_KINDS.join(", ")})`);
      const root = o.from?.split(".")[0];
      if (root && root !== "$" && fields.length && !fields.includes(root)) out.push(`${at}: the answer has no "${root}" (it has ${fields.join(", ")})`);
      if (typeof o.molecule === "string" && !entityFields(spec, o.molecule)) out.push(`${at}: no entity "${o.molecule}"`);
      if (typeof o.molecule === "object") checkMolecule(spec, `${at}.molecule`, o.molecule, out);
      const inputs = Object.keys((s as unknown as { input?: Record<string, unknown> }).input ?? {});
      for (const f of o.facets ?? []) {
        if (!inputs.includes(f.arg)) out.push(`${at}: facet "${f.label}" sets "${f.arg}", which ${shape} does not take (it takes ${inputs.join(", ") || "nothing"})`);
        const r = f.from?.split(".")[0];
        if (r && r !== "$" && fields.length && !fields.includes(r)) out.push(`${at}: facet "${f.label}" reads "${r}", which the answer does not have`);
      }
      for (const st of o.stats ?? []) if (st.go && !(st.go.shape in spec.shapes)) out.push(`${at}: stat goes to no shape "${st.go.shape}"`);
      for (const a of o.actions ?? []) if (a.shape && !(a.shape in spec.shapes)) out.push(`${at}: no shape "${a.shape}"`);
    });
  }
  return out;
}
