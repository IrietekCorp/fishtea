import type { TypeSpec } from "./types.ts";

export interface EntityDef {
  doc?: string;
  fields: Record<string, TypeSpec>;
  index?: string[];
  embed?: string[];
  unique?: string[];
  /**
   * Rows an operator reads and edits at /admin → Data. `true` takes the defaults; otherwise `title` (the
   * field each row is called by), `columns` (the fields its list shows), `order` (the field it is sorted
   * by, newest or highest first) and `collect` (the shape of a public form that adds rows, whose link
   * /admin offers to copy and send).
   */
  admin?: true | EntityAdmin;
  /**
   * How seed/<entity>.json meets rows already there. `upsert` (the default) writes every listed field on
   * every start, so the seed file is the truth. `insert` adds the rows that are missing and leaves the
   * rest alone, so what an operator changed at /admin → Data stays changed.
   */
  seed?: "upsert" | "insert";
}
export interface EntityAdmin { title?: string; columns?: string[]; order?: string; collect?: string }

export interface CallDef {
  kind: "query" | "mutation" | "compute" | "external";
  doc?: string;
  in: Record<string, TypeSpec>;
  out: TypeSpec;
  impl: { sql?: string; module?: string; url?: string; doc?: string };
  transaction?: boolean;
  /**
   * This call's own budget in milliseconds, in place of `rules.calls.timeoutMs` (×1 for compute, ×4
   * otherwise). For the few calls that honestly take longer — a vendor feed, a sync — so that loosening
   * them does not loosen every SQL call with them.
   */
  timeoutMs?: number;
}

export interface PlanStep {
  id?: string;
  call: string;
  with?: Record<string, unknown>;
  after?: string[];
}

export interface NextDef {
  label?: string;
  shape: string;
  args?: Record<string, unknown>;
  each?: string;
  /**
   * Fire when this form field changes rather than when somebody clicks.
   *
   * The interesting part is what it is *not*: json-render's equivalent mutates a client-side state tree,
   * which is a second memory beside the trail. This sends the same utterance a click would have sent, so
   * the turn is gated by persona, planned, given provenance and appended like any other.
   */
  on?: { field: string };
}

export type VesselName = "list" | "card" | "detail" | "compare" | "timeline" | "confirm";

export interface ShapeDef {
  asks: string;
  doc?: string;
  input: Record<string, TypeSpec>;
  answer: TypeSpec;
  effect: "read" | "write";
  allow: string[];
  plan?: PlanStep[];
  assemble?: unknown;
  phrase?: string;
  vessel?: VesselName;
  next?: NextDef[];
  triggers?: string[];
  /**
   * Sibling shapes whose answers pour beside this one, as parts of one composite.
   *
   * Each is planned in its own right and keeps its own vessel and provenance — this composes answers,
   * it does not merge them. A composed shape must be a `read` the asking persona is allowed, so a
   * composite can never smuggle in a write or something the gate would have refused on its own.
   */
  compose?: string[];
  /**
   * `false` keeps this shape out of the classifier's tool list. It is still a shape — reachable as a
   * composite part, a chip, a greeting or a posted shape, and gated by `allow` like any other — but
   * nobody's words are classified to it. For a part that only makes sense beside its lead: offered to
   * the classifier, it competes with the lead for the same utterances and, being smaller, often wins.
   */
  classify?: boolean;
  /**
   * Operator shapes only: when the core runs this job by itself (admin/jobs.ts). `daily` is times of day
   * in UTC ("05:00"); a time missed while the core was down runs when it comes back. `afterDeploy` runs it
   * once when the release — spec, calls, seed, framework — has not had a successful run yet, so a fresh
   * deploy fills what it needs and a plain restart does not.
   */
  schedule?: { daily?: string[]; afterDeploy?: boolean; args?: Record<string, unknown> };
}

export interface GreetingDef { shape?: string; hint?: string; resume?: boolean; offer?: string[] }

export interface NotificationDef { to: "visitor" | "operator"; text: string; doc?: string; next?: NextDef[] }

/**
 * How the browser reaches `/echo` for an echo it reports.
 *
 * - `redirect` — the link *is* the echo: `/echo?…` records it, runs the handler and answers 302 to the
 *   destination (or what the handler made of it).
 * - `beacon` — the link goes straight to the destination and the echo is reported beside it
 *   (`navigator.sendBeacon`). For a destination that must not be reached through a redirect.
 */
export type EchoVia = "redirect" | "beacon";

/** A per-destination override, matched on the destination's host; the first case that matches wins. */
export interface EchoCase {
  /** hostnames; `*.example.com` also matches example.com itself */
  hosts: string[];
  via?: EchoVia;
  /** a different handler for these destinations, or `false` for none */
  handler?: string | false;
  /** a different analytics event name, or `false` to report none */
  analytics?: string | false;
  doc?: string;
}

/**
 * An echo: what a visitor did with an answer that leaves the conversation — following an outbound link,
 * today. It is recorded as a reverb of the turn whose answer offered it (`conversation.echo`), never as a
 * turn: it does not move the head and is not something to rewind to. docs/ECHOES.md.
 */
export interface EchoDef {
  doc?: string;
  /** default `redirect` */
  via?: EchoVia;
  /**
   * A compute call that decides the outcome: it receives the echo (destination, the record in the answer
   * that carried it, the turn, the echo id) and may return `{ location, data }` — a rewritten destination
   * and facts to keep with the echo. Without one the destination is used as published.
   */
  handler?: string;
  /** personas who may echo this; absent means every persona */
  allow?: string[];
  /** the analytics event a shell reports for it (GA4 naming); default the echo's own name; `false` for none */
  analytics?: string | false;
  cases?: EchoCase[];
}

export interface Spec {
  fishtea: string;
  business: { id: string; name: string; doc?: string; locale?: string; currency?: string; version: string };
  entities: { version: string; doc?: string } & Record<string, EntityDef | string | undefined>;
  calls: { version: string; doc?: string } & Record<string, CallDef | string | undefined>;
  rules: {
    version: string;
    doc?: string;
    writes?: { confirmAlways?: boolean; minConfidence?: number };
    /** `fallback`: the shape to answer with, the visitor's words as its `arg`, when the classifier chooses nothing */
    classify?: { budgetMs?: number; floor?: number; contextTurns?: number; maxTokens?: number; fallback?: { shape: string; arg: string } };
    calls?: { timeoutMs?: number };
    familiarity?: { threshold?: number };
    /** how answers are laid out: molecules per entity, organisms per shape (see present.ts) */
    present?: import("./present.ts").PresentRules;
    /** the site map a shell navigates by (see site.ts) */
    site?: import("./site.ts").SiteRules;
    [k: string]: unknown;
  };
  shapes: { version: string; doc?: string } & Record<string, ShapeDef | string | undefined>;
  personas: { version: string; doc?: string } & Record<string, { when: string; doc?: string } | string | undefined>;
  envelope: { version: string; doc?: string; accept: string[]; greeting: Record<string, GreetingDef> };
  notifications?: { version: string; doc?: string } & Record<string, NotificationDef | string | undefined>;
  /** outbound reverbs of a turn (format 1.2) */
  echoes?: { version: string; doc?: string } & Record<string, EchoDef | string | undefined>;
  operator?: { version: string; doc?: string; shapes?: Record<string, ShapeDef>; reports?: Record<string, ReportDef> };
}

/**
 * A report: a page of /admin → Reports, read-only, each panel one query call drawn one way.
 *
 * Every panel's call is asked with the report's period as `from` and `to` (dates, inclusive), when it
 * declares them. `tiles` draws the first row, a tile per column; `line` draws rows over `x` (a date), one
 * line per `y` column; `bar` draws one bar per row, `x` the label and the first `y` the length; `table`
 * draws the rows. `columns` picks and orders what is shown, `labels` names a column for people, `format`
 * says how a value reads (money in the row's `currency` when it has one).
 */
export type ReportFormat = "int" | "number" | "money" | "percent" | "date" | "text" | "link";
export interface ReportPanel {
  title: string; doc?: string; call: string; view: "tiles" | "line" | "bar" | "table";
  x?: string; y?: string[]; columns?: string[]; labels?: Record<string, string>; format?: Record<string, ReportFormat>;
  width?: "full" | "half";
}
export interface ReportDef { label: string; doc?: string; panels: ReportPanel[] }
export const operatorReports = (s: Spec): [string, ReportDef][] => Object.entries(s.operator?.reports ?? {});

const META = new Set(["version", "doc"]);

/** Iterate the named members of a sectioned map, skipping `version` and `doc`. */
export function members<T>(section: Record<string, unknown> | undefined): [string, T][] {
  if (!section) return [];
  return Object.entries(section).filter(([k]) => !META.has(k)) as [string, T][];
}

export const entities = (s: Spec) => members<EntityDef>(s.entities);
export const calls = (s: Spec) => members<CallDef>(s.calls);
export const shapes = (s: Spec) => members<ShapeDef>(s.shapes);
export const personas = (s: Spec) => members<{ when: string; doc?: string }>(s.personas);
export const notifications = (s: Spec) => members<NotificationDef>(s.notifications);
export const echoes = (s: Spec) => members<EchoDef>(s.echoes);
export const operatorShapes = (s: Spec): [string, ShapeDef][] => Object.entries(s.operator?.shapes ?? {});

export function getShape(s: Spec, name: string): ShapeDef | undefined {
  const consumer = (s.shapes as any)[name];
  if (consumer && typeof consumer === "object") return consumer as ShapeDef;
  return s.operator?.shapes?.[name];
}
export function getCall(s: Spec, name: string): CallDef | undefined {
  const c = (s.calls as any)[name];
  return c && typeof c === "object" ? (c as CallDef) : undefined;
}
export function getEntity(s: Spec, name: string): EntityDef | undefined {
  const e = (s.entities as any)[name];
  return e && typeof e === "object" ? (e as EntityDef) : undefined;
}
