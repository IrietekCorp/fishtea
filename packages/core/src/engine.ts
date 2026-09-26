/**
 * The engine: one utterance in, one pour out (BLUEPRINT §3 "Request lifecycle").
 * Provably UI-free: headless.ts and http.ts are both thin callers of Engine.
 */
import { type App, type ShapeDef, type ToolSpec, deriveTools, deriveOperatorTools, getShape, inputSchema, shapes as specShapes, notifications as specNotifications, entities as specEntities, parseType, snake, deriveForm } from "@fishtea/spec";
import type { Db } from "./db/index.ts";
import { bindCalls, type BoundCall } from "./calls/index.ts";
import { TrailService, type Turn, type Author, type PourKind } from "./trail/index.ts";
import { derivePersona, allowedShapes, checkPersonas, type Identity } from "./persona.ts";
import { Planner, PlanError, resolve as resolveRefs, type Provenance } from "./plan/index.ts";
import { type Pour, type Chip, type ClassMeta, askPour, formPour, confirmPour, answerPour, compositePour, type AnswerPour, chip, phraseFor, nextChips } from "./pour.ts";
import type { Classifier, ClassifyResult } from "./classify/index.ts";
import { LexicalClassifier, tokens } from "./classify/lexical.ts";
import { Hub, renderNotification, type Channel, type Outbound } from "./notify/index.ts";

export type Utterance =
  | { text: string }
  | { shape: string; args?: Record<string, unknown>; submit?: boolean; confirm?: boolean }
  | { arrive: true };

export interface Envelope { referrer?: string; utm_source?: string; utm_campaign?: string; coupon?: string; cookie?: string; issuedUrl?: string; userAgent?: string; locale?: string; [k: string]: string | undefined }

export interface UtterOptions { visitorId?: string | null; envelope?: Envelope; hadToken?: boolean; branchFrom?: string | null }

export interface Response {
  pour: Pour;
  turn: { id: string; seq: number; trailId: string; parentId: string | null };
  visitor: { id: string; created: boolean };
  persona: string;
  understood?: { shape: string; confidence: number; phrase: string };
  notifications: Pour[];
  timings: { classifyMs: number; planMs: number; totalMs: number };
  classifier: string;
}

const ENVELOPE_RULES: Record<string, RegExp> = {
  referrer: /^.{0,512}$/, utm_source: /^[\w.-]{0,64}$/, utm_campaign: /^[\w .-]{0,64}$/, coupon: /^[A-Z0-9-]{3,32}$/,
  cookie: /^[\w-]{0,64}$/, issuedUrl: /^[\w-]{0,64}$/, userAgent: /^.{0,256}$/, locale: /^[a-zA-Z-]{2,16}$/,
};

/** Allowlisted keys, length- and pattern-validated; stored as data, never interpolated (§7, §12.3). */
export function parseEnvelope(app: App, raw: Record<string, unknown>): Envelope {
  const out: Envelope = {};
  for (const key of app.spec.envelope.accept) {
    const v = raw[key];
    if (typeof v !== "string" || !v) continue;
    const rule = ENVELOPE_RULES[key] ?? /^.{0,128}$/;
    if (rule.test(v)) out[key] = v;
  }
  return out;
}

const escapeContext = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/[<>{}]/g, "").slice(0, 160);

export interface EngineOptions { app: App; db: Db; classifier?: Classifier; strict?: boolean; log?: (s: string) => void; channels?: Channel[] }

export class Engine {
  app: App;
  db: Db;
  classifier: Classifier;
  trails: TrailService;
  hub = new Hub();
  strict: boolean;
  private calls!: Map<string, BoundCall>;
  private planner!: Planner;
  private tools!: ToolSpec[];
  private log: (s: string) => void;
  private lexicalGate = new LexicalClassifier();
  /** where a notification goes when the visitor is not connected; empty means it simply waits for them */
  channels: Channel[];

  constructor(opts: EngineOptions) {
    this.app = opts.app;
    this.db = opts.db;
    this.classifier = opts.classifier ?? new LexicalClassifier();
    this.strict = opts.strict ?? process.env.FISHTEA_STRICT === "1";
    this.log = opts.log ?? (() => {});
    this.channels = opts.channels ?? [];
    this.trails = new TrailService(this.db);
    this.bind();
  }

  /** (Re)bind everything derived from the spec. Called on load and on hot-reload of non-entity sections. */
  bind() {
    const problems = checkPersonas(this.app.spec);
    if (problems.length) throw new Error(problems.join("\n"));
    this.calls = bindCalls(this.app);
    this.planner = new Planner(this.app, this.calls, this.db);
    this.tools = deriveTools(this.app.spec);
  }

  get spec() { return this.app.spec; }
  get toolSpecs() { return this.tools; }
  get operatorTools() { return deriveOperatorTools(this.app.spec); }
  /** One tool-name subset per persona (deduplicated): what the pool pre-warms. */
  get personaSubsets(): string[][] {
    const seen = new Set<string>();
    const out: string[][] = [];
    for (const [name] of Object.entries(this.app.spec.personas).filter(([k]) => k !== "version" && k !== "doc")) {
      const names = allowedShapes(this.app.spec, name).sort();
      const key = names.join(",");
      if (names.length && !seen.has(key)) { seen.add(key); out.push(names); }
    }
    return out;
  }

  /** Swap the spec (hot reload). Entities changes require a migration first; the caller decides. */
  async reload(app: App) {
    this.app = app;
    this.bind();
    if (this.classifier.reload) await this.classifier.reload(this.tools, this.personaSubsets).catch((e) => this.log(`classifier reload failed: ${e.message}`));
    if (this.classifier instanceof LexicalClassifier) await this.primeLexical();
    this.hub.broadcast({ type: "reload", data: { version: app.spec.business.version, hashes: app.hashes } });
  }

  /** Distinct values of indexed array fields, so the dev classifier can fill mood/style arguments. */
  async primeLexical() {
    if (!(this.classifier instanceof LexicalClassifier)) return;
    const vocab: Record<string, string[]> = {};
    for (const [name, ent] of specEntities(this.app.spec)) {
      for (const f of ent.index ?? []) {
        const t = parseType(ent.fields[f]);
        if (!t.array || t.base !== "string") continue;
        const rows = await this.db.unsafe(`SELECT DISTINCT unnest("${snake(f)}") AS v FROM business."${snake(name)}" LIMIT 500`).catch(() => [] as any[]);
        const values = rows.map((r: any) => String(r.v));
        for (const key of [f, f.replace(/s$/, ""), f.replace(/Tags?$/, "").replace(/s$/, "")]) vocab[key] = [...new Set([...(vocab[key] ?? []), ...values])];
      }
    }
    this.classifier.setVocab(vocab);
  }

  // ── identity & persona ───────────────────────────────────────────────────

  private async identity(visitor: { id: string; customerId: string | null }, trailEnvelope: Envelope): Promise<Identity> {
    let email: string | null = null;
    if (visitor.customerId) {
      // whichever entity the customer_id points at (customer, family, …): the first entity with an email field
      for (const [name, ent] of specEntities(this.app.spec)) {
        if (!("email" in ent.fields)) continue;
        const rows = await this.db.unsafe(`SELECT email FROM business."${snake(name)}" WHERE id = $1`, [visitor.customerId]).catch(() => [] as any[]);
        if (rows.length) { email = rows[0].email; break; }
      }
    }
    // "known" is what the *visit* brought (§7): the cookie or issued token stored on the trail's envelope
    return { email, customerId: visitor.customerId, cookie: trailEnvelope.cookie ?? null, issuedUrl: trailEnvelope.issuedUrl ?? null };
  }

  private async persona(trailId: string, identity: Identity): Promise<string> {
    const facts = await this.trails.facts(trailId);
    return derivePersona(this.app.spec, { identity, trail: facts });
  }

  /**
   * The trail for this request: the latest one, or a new one when the visit is new (no trail, or the last
   * turn is older than rules.trail.sessionGapHours). A new trail for a returning visitor is seeded with the
   * previous head so "the homepage is the resumed conversation" holds across visits (§7).
   */
  private async acquireTrail(visitor: { id: string; created: boolean }, envelope: Envelope, hadToken: boolean): Promise<{ trail: Awaited<ReturnType<TrailService["latest"]>> & {}; fresh: boolean }> {
    const gapMs = Number((this.app.spec.rules as any).trail?.sessionGapHours ?? 4) * 3600e3;
    let trail = await this.trails.latest(visitor.id);
    const head = trail ? await this.trails.head(trail.id) : null;
    const stale = !!trail && (head ? Date.now() - new Date(head.at).getTime() > gapMs : Date.now() - new Date(trail.openedAt).getTime() > gapMs);
    if (trail && !stale) return { trail, fresh: false };
    const env: Envelope = { ...envelope };
    if (hadToken && !env.cookie) env.cookie = visitor.id;
    const previous = trail;
    trail = await this.trails.open(visitor.id, env);
    if (previous) await this.seedFrom(previous.id, trail.id);
    return { trail, fresh: true };
  }

  /** Copy the previous trail's head pour into a new trail as a system turn: the return-visit homepage. */
  private async seedFrom(previousTrailId: string, trailId: string) {
    const prev = await this.trails.head(previousTrailId);
    if (!prev || prev.kind === "notification" || prev.kind === "ask") return;
    await this.trails.append(trailId, { author: "system", shape: prev.shape, kind: prev.kind, confidence: null, answered: true, latencyMs: null, utterance: { resumedFrom: prev.id, args: (prev.utterance as any).known ?? (prev.utterance as any).args ?? {} }, pour: prev.pour, provenance: { ...(prev.provenance as any), resumedFrom: prev.id } });
  }

  // ── resume: the homepage ─────────────────────────────────────────────────

  async resume(opts: UtterOptions = {}): Promise<Response> {
    const t0 = performance.now();
    const envelope = parseEnvelope(this.app, opts.envelope ?? {});
    const visitor = await this.trails.ensureVisitor(opts.visitorId);
    const hadToken = !!opts.visitorId && !visitor.created;
    const { trail } = await this.acquireTrail(visitor, envelope, hadToken);
    const identity = await this.identity(visitor, trail.envelope as Envelope);
    const persona = await this.persona(trail.id, identity);
    const greeting = this.app.spec.envelope.greeting[persona] ?? this.app.spec.envelope.greeting.stranger;
    const offers = (greeting.offer ?? []).map((s) => chip(this.app.spec, s, undefined, undefined, persona)).filter((c): c is Chip => !!c);
    const notifications = await this.flushNotifications(visitor.id, trail.id);

    const head = await this.trails.head(trail.id);
    let pour: Pour;
    let turn: Turn;
    let planMs = 0;
    if (head && greeting.resume !== false && head.kind !== "notification") {
      pour = head.pour as unknown as Pour;
      // re-validate an answer: stock may have changed, so re-run a read plan
      if (pour.kind === "answer") {
        const shape = getShape(this.app.spec, pour.shape);
        if (shape && shape.effect === "read" && shape.allow.includes(persona)) {
          try {
            const args = (head.utterance as any).known ?? (head.utterance as any).args ?? {};
            const t1 = performance.now();
            const { answer, provenance } = await this.planner.run({ shapeName: pour.shape, shape, args, visitor, persona });
            planMs = performance.now() - t1;
            pour = answerPour(this.app.spec, pour.shape, shape, args, answer, provenance, persona);
          } catch { pour = { ...pour, stale: true }; }
        }
      }
      if (pour.kind === "ask" || pour.kind === "form") { const existing: Chip[] = pour.options ?? []; pour = { ...pour, options: [...existing, ...offers.filter((o) => !existing.some((c) => c.shape === o.shape))] } as Pour; }
      if (pour.kind === "answer") { const nx = pour.next; pour = { ...pour, next: [...nx, ...offers.filter((o) => !nx.some((c) => c.shape === o.shape))] }; }
      turn = head;
    } else {
      const gshape = greeting.shape ? getShape(this.app.spec, greeting.shape) : undefined;
      pour = askPour({ phrase: greeting.hint ?? `Welcome to ${this.app.spec.business.name}`, hint: greeting.hint, shape: greeting.shape, fields: gshape ? deriveForm(gshape) : undefined, options: [...(greeting.shape ? [chip(this.app.spec, greeting.shape, undefined, undefined, persona)!] : []), ...offers], reason: "greeting" });
      turn = await this.trails.append(trail.id, { author: "system", shape: greeting.shape ?? null, kind: "ask", confidence: null, answered: true, latencyMs: Math.round(performance.now() - t0), utterance: { arrive: true, envelope }, pour: pour as unknown as Record<string, unknown>, provenance: { shape: greeting.shape ?? null, calls: [], read: [], wrote: [], at: new Date().toISOString(), records: 0, greeting: persona } });
    }
    return {
      pour, notifications, persona,
      turn: { id: turn.id, seq: turn.seq, trailId: turn.trailId, parentId: turn.parentId },
      visitor: { id: visitor.id, created: visitor.created },
      timings: { classifyMs: 0, planMs: Math.round(planMs), totalMs: Math.round(performance.now() - t0) },
      classifier: this.classifier.name,
    };
  }

  private async flushNotifications(visitorId: string, trailId: string): Promise<Pour[]> {
    const pending = await this.trails.pendingNotifications(visitorId);
    const pours: Pour[] = [];
    for (const n of pending) {
      const pour: Pour = { kind: "notification", author: n.author, name: n.name, text: n.text, next: n.next as Chip[] };
      await this.trails.append(trailId, { author: n.author, shape: null, kind: "notification", confidence: null, answered: true, latencyMs: null, utterance: { notification: n.name ?? "operator" }, pour: pour as unknown as Record<string, unknown>, provenance: { shape: null, calls: [], read: [], wrote: [], at: n.at, records: 0 } });
      pours.push(pour);
    }
    await this.trails.markDelivered(pending.map((n) => n.id));
    return pours;
  }

  // ── utter: one turn ──────────────────────────────────────────────────────

  async utter(utterance: Utterance, opts: UtterOptions = {}): Promise<Response> {
    if ("arrive" in utterance) return this.resume(opts);
    const t0 = performance.now();
    const envelope = parseEnvelope(this.app, opts.envelope ?? {});
    const visitor = await this.trails.ensureVisitor(opts.visitorId);
    const hadToken = !!opts.visitorId && !visitor.created;
    const { trail } = await this.acquireTrail(visitor, envelope, hadToken);
    if (opts.branchFrom) await this.trails.rewind(trail.id, opts.branchFrom);
    const identity = await this.identity(visitor, trail.envelope as Envelope);
    const persona = await this.persona(trail.id, identity);
    const allowed = allowedShapes(this.app.spec, persona);
    const notifications = await this.flushNotifications(visitor.id, trail.id);

    let shapeName: string | undefined;
    let args: Record<string, unknown> = {};
    let meta: ClassMeta | undefined;
    let embedding: number[] | undefined;
    let extraCalls: { name: string; arguments: Record<string, unknown> }[] = [];
    let pour: Pour | undefined;
    let classifyMs = 0;
    let answered = true;
    let reasonUnmet: string | undefined;

    if ("shape" in utterance) {
      shapeName = utterance.shape;
      args = utterance.args ?? {};
      meta = { name: "structured", ms: 0, confidence: 1 };
    } else {
      const text = utterance.text.trim().slice(0, 500);
      const tools = this.tools.filter((t) => allowed.includes(t.name));
      const budgetMs = Number(this.app.spec.rules.classify?.budgetMs ?? 400);
      const floor = Number(this.app.spec.rules.classify?.floor ?? 0.35);
      const k = Number(this.app.spec.rules.classify?.contextTurns ?? 6);
      // Context policy (measured in Phase 0/4, see classifier/contract.md): summaries of prior turns confuse
      // needle and lengthen prefill, so context is (a) recalled turns from other trails, when they resonate,
      // and (b) for short/anaphoric utterances only, the last answer's items and the last shape+args.
      const context: string[] = [];
      const anaphoric = /\b(it|that one|this one|these|those|the first|the second|the third|the last|same|again|them|both|another|cheaper one)\b/i.test(text);
      if (anaphoric) context.push(...(await this.recentContext(trail.id, k)));
      let result: ClassifyResult;
      let recalledCount = 0;
      if (this.strict && this.classifier.name !== "lexical" && !(await this.classifier.health()).ok) {
        result = { calls: [], confidence: 0, ms: 0, classifier: this.classifier.name, error: "pool unhealthy" };
        pour = { kind: "notification", author: "system", text: "One moment — getting things ready.", next: [{ label: "Try again", shape: "__retry", args: { text } }] };
      } else {
        result = await this.classifier.classify({ text, context, tools, budgetMs });
        embedding = result.embedding;
        // familiarity: recall this visitor's other trails with the embedding the classifier returned; when the
        // first pass was weak and something resonates, classify once more with the recalled turns as context
        if (embedding && !result.timedOut) {
          try {
            const recalled = await this.trails.recall(visitor.id, embedding, Number(this.app.spec.rules.familiarity?.threshold ?? 0.82), trail.id);
            recalledCount = recalled.length;
            const weak = !result.calls.length || result.confidence < floor || this.missingRequired(result.calls[0]);
            if (recalled.length && weak) {
              const recallCtx = recalled.map((r) => `earlier this visitor asked: ${escapeContext(String((r.utterance as any).text ?? ""))}${r.shape ? ` → ${r.shape} ${this.argsLine((r.utterance as any).known)}` : ""}`);
              const again = await this.classifier.classify({ text, context: [...recallCtx, ...context], tools, budgetMs });
              classifyMs += result.ms;
              if (!again.timedOut && !again.error && (again.calls.length || !result.calls.length)) result = { ...again, reasoning: `[recall ×${recalled.length}] ${again.reasoning ?? ""}` };
            }
          } catch (e) { this.log(`recall skipped: ${(e as Error).message}`); }
        }
      }
      classifyMs += result.ms;
      meta = { name: result.classifier, ms: Math.round(classifyMs), confidence: result.confidence, reasoning: result.reasoning, calls: result.calls, timedOut: result.timedOut, error: result.error, recalled: recalledCount };
      if (!pour) {
        if (result.timedOut || result.error) {
          pour = askPour({ phrase: "Tell me a little more?", options: this.offersFor(persona), reason: result.timedOut ? "budget" : "pool-down", classifier: meta });
          answered = false; reasonUnmet = result.timedOut ? "budget" : "pool-down";
        } else if (!result.calls.length) {
          pour = this.gate(text, persona, allowed, meta) ?? askPour({ phrase: "I didn't catch what you're after.", hint: "Here's what I can help with:", options: this.offersFor(persona, allowed), reason: "no-match", classifier: meta });
          answered = false; reasonUnmet = "no-match";
        } else if (result.confidence < floor) {
          const top = result.calls[0];
          const s = getShape(this.app.spec, top.name);
          pour = s ? formPour(top.name, s, top.arguments, { hint: `Did you mean: ${s.asks}?`, options: this.offersFor(persona, allowed), classifier: meta }) : askPour({ phrase: "Did you mean…", options: this.offersFor(persona, allowed), reason: "low-confidence", classifier: meta });
          answered = false; reasonUnmet = "low-confidence";
        } else {
          const [top, ...rest] = result.calls;
          shapeName = top.name;
          args = top.arguments ?? {};
          extraCalls = rest.filter((c) => c.name !== top.name);
        }
      }
    }

    let planMs = 0;
    let provenance: Provenance | Record<string, unknown> = { shape: shapeName ?? null, calls: [], read: [], wrote: [], at: new Date().toISOString(), records: 0 };
    if (!pour && shapeName) {
      const shape = getShape(this.app.spec, shapeName);
      const isOperator = shapeName.startsWith("op.");
      if (!shape || isOperator) {
        pour = askPour({ phrase: "That isn't something I can do here.", options: this.offersFor(persona, allowed), reason: "no-match", classifier: meta });
        answered = false; reasonUnmet = "unknown-shape";
      } else if (!allowed.includes(shapeName)) {
        pour = this.gateFor(shapeName, shape, persona, meta) ?? askPour({ phrase: `${shape.asks} isn't available yet.`, options: this.offersFor(persona, allowed), reason: "not-allowed", classifier: meta });
        answered = false; reasonUnmet = "not-allowed";
      } else {
        const parsed = inputSchema(shape, this.app.spec).safeParse(args);
        if (!parsed.success) {
          const errors: Record<string, string> = {};
          for (const i of parsed.error.issues) errors[i.path.join(".") || "_"] = i.message;
          pour = formPour(shapeName, shape, args, { errors, hint: "A few details, then I'll answer.", classifier: meta });
        } else {
          args = parsed.data;
          const confirmAlways = this.app.spec.rules.writes?.confirmAlways !== false;
          const confirmed = "shape" in utterance && utterance.confirm === true;
          if (shape.effect === "write" && confirmAlways && !confirmed) {
            pour = confirmPour(shapeName, shape, args, { classifier: meta });
          } else {
            const t1 = performance.now();
            try {
              const r = await this.planner.run({ shapeName, shape, args, visitor, persona });
              provenance = r.provenance;
              const lead = answerPour(this.app.spec, shapeName, shape, args, r.answer, r.provenance, persona, { classifier: meta });
              pour = shape.compose?.length
                ? await this.composeParts({ shape: shapeName, pour: lead, provenance: r.provenance }, shape, args, visitor, persona, meta)
                : lead;
              for (const c of extraCalls) { const ch = chip(this.app.spec, c.name, c.arguments, undefined, persona); if (ch && !(pour as any).next.some((x: Chip) => x.shape === ch.shape)) (pour as any).next.push(ch); }
            } catch (e) {
              const err = e as PlanError;
              this.log(`plan ${shapeName} failed: ${err.message}`);
              pour = formPour(shapeName, shape, args, { error: err.message, hint: "The ground refused that one. Adjust and try again.", classifier: meta });
              answered = false; reasonUnmet = "plan-failed";
            }
            planMs = performance.now() - t1;
          }
        }
      }
    }
    if (!pour) throw new Error("no pour");

    const kind: PourKind = pour.kind;
    const turn = await this.trails.append(trail.id, {
      author: "visitor", shape: shapeName ?? null, kind, confidence: meta?.confidence ?? null, answered,
      latencyMs: Math.round(performance.now() - t0),
      utterance: { ...("text" in utterance ? { text: utterance.text } : { shape: utterance.shape, args: utterance.args ?? {}, submit: utterance.submit, confirm: utterance.confirm }), known: args, persona },
      pour: pour as unknown as Record<string, unknown>, provenance: { ...provenance, ...(reasonUnmet ? { unmet: reasonUnmet } : {}), classifier: meta },
      embedding: embedding ?? null,
      parentId: opts.branchFrom ?? undefined,
    });
    if (this.hub.connected(visitor.id)) this.hub.publish(visitor.id, { type: "turn", data: { id: turn.id, seq: turn.seq, kind } });
    const shapeDef = shapeName ? getShape(this.app.spec, shapeName) : undefined;
    return {
      pour, notifications, persona,
      turn: { id: turn.id, seq: turn.seq, trailId: turn.trailId, parentId: turn.parentId },
      visitor: { id: visitor.id, created: visitor.created },
      understood: shapeName && shapeDef ? { shape: shapeName, confidence: meta?.confidence ?? 0, phrase: phraseFor(shapeDef, args) } : undefined,
      timings: { classifyMs: Math.round(classifyMs), planMs: Math.round(planMs), totalMs: Math.round(performance.now() - t0) },
      classifier: this.classifier.name,
    };
  }

  /**
   * Run a shape's composed siblings and build one pour out of the lot.
   *
   * The gate is re-applied per part, though the loader already refused a part the asking persona cannot
   * have: the loader checks the *declared* personas, and a persona is derived per request. Checking
   * both is the difference between a rule and a rule that holds.
   *
   * A part that fails or is refused is dropped, not fatal. The lead answer is what was asked for; a
   * recommendation strip that could not load is a missing strip, not a failed turn — and the part's
   * absence is visible in the provenance, which is where an operator would look.
   */
  private async composeParts(
    lead: { shape: string; pour: AnswerPour; provenance: Provenance },
    shape: ShapeDef,
    args: Record<string, unknown>,
    visitor: { id: string; customerId: string | null },
    persona: string,
    meta?: ClassMeta,
  ): Promise<Pour> {
    const parts: { shape: string; pour: AnswerPour; provenance: Provenance }[] = [];
    for (const name of shape.compose ?? []) {
      const def = getShape(this.app.spec, name);
      if (!def || def.effect === "write" || !def.allow.includes(persona)) continue;
      // A part is given the arguments it shares with the lead; anything else falls to its declared
      // defaults. A part is never handed an argument the visitor did not supply for it.
      const partArgs: Record<string, unknown> = {};
      for (const k of Object.keys(def.input)) if (args[k] !== undefined) partArgs[k] = args[k];
      const parsed = inputSchema(def, this.app.spec).safeParse(partArgs);
      if (!parsed.success) { this.log(`compose ${name}: skipped (${parsed.error.issues[0]?.message ?? "bad args"})`); continue; }
      try {
        const r = await this.planner.run({ shapeName: name, shape: def, args: parsed.data, visitor, persona });
        parts.push({ shape: name, pour: answerPour(this.app.spec, name, def, parsed.data, r.answer, r.provenance, persona), provenance: r.provenance });
      } catch (e) {
        this.log(`compose ${name}: skipped (${(e as Error).message})`);
      }
    }
    return parts.length ? compositePour(lead, parts, { classifier: meta }) : lead.pour;
  }

  private argsLine(args: unknown): string {
    if (!args || typeof args !== "object") return "";
    return Object.entries(args as Record<string, unknown>).filter(([, v]) => v != null && v !== "" && typeof v !== "object").slice(0, 4).map(([k, v]) => `${k}=${escapeContext(String(v))}`).join(" ");
  }

  /** For anaphoric utterances: the last answer's items (ids + names) and the last shape with its args. */
  private async recentContext(trailId: string, k: number): Promise<string[]> {
    const turns = (await this.trails.path(trailId, k)).filter((t) => t.kind === "answer" || t.kind === "form" || t.kind === "confirm-write");
    const last = turns[0];
    if (!last) return [];
    const lines: string[] = [];
    const pour = last.pour as any;
    const answer = pour.answer;
    const items: any[] = Array.isArray(answer) ? answer : answer && typeof answer === "object" ? (Object.values(answer).find(Array.isArray) as any[]) ?? [] : [];
    if (items.length) lines.push(`last answer listed: ${items.slice(0, 6).map((it, i) => `${i + 1}. ${it?.id ?? ""} ${escapeContext(String(it?.name ?? it?.title ?? ""))}`.trim()).join("; ")}`);
    return lines;
  }

  private missingRequired(call: { name: string; arguments: Record<string, unknown> }): boolean {
    const shape = getShape(this.app.spec, call.name);
    if (!shape) return true;
    return !inputSchema(shape, this.app.spec).safeParse(call.arguments ?? {}).success;
  }

  private offersFor(persona: string, allowed?: string[]): Chip[] {
    const g = this.app.spec.envelope.greeting[persona] ?? this.app.spec.envelope.greeting.stranger;
    const names = [...(g.shape ? [g.shape] : []), ...(g.offer ?? [])];
    for (const n of allowed ?? []) if (names.length < 6 && !names.includes(n)) names.push(n);
    return names.map((n) => chip(this.app.spec, n, undefined, undefined, persona)).filter((c): c is Chip => !!c);
  }

  /**
   * A stranger says "check out": checkout is not in their toolset, so nothing matched. If the text
   * lexically points at a shape this persona can't use, pour the gate: the greeting's first offered write
   * shape that the persona *can* use (becomeKnown). Routing heuristic only; the model never saw the shape.
   */
  private gate(text: string, persona: string, allowed: string[], meta?: ClassMeta): Pour | undefined {
    const hidden = this.tools.filter((t) => !allowed.includes(t.name));
    if (!hidden.length) return undefined;
    const utt = new Set(tokens(text));
    let best: { name: string; score: number } | undefined;
    const compact = text.toLowerCase().replace(/[^a-z]/g, "");
    for (const t of hidden) {
      const words = new Set([...tokens(t.name), ...tokens(t.description)]);
      let score = [...words].filter((w) => utt.has(w)).length;
      if (compact.includes(t.name.toLowerCase())) score += 2;
      for (const trig of t.triggers ?? []) if (text.toLowerCase().includes(trig.toLowerCase())) score += 3;
      if (score >= 2 && (!best || score > best.score)) best = { name: t.name, score };
    }
    if (!best) return undefined;
    return this.gateFor(best.name, getShape(this.app.spec, best.name)!, persona, meta);
  }

  private gateFor(wanted: string, wantedShape: ShapeDef, persona: string, meta?: ClassMeta): Pour | undefined {
    const g = this.app.spec.envelope.greeting[persona] ?? this.app.spec.envelope.greeting.stranger;
    // only the greeting's offers can be gates: the spec author chose them as the way "in" for this persona
    const candidates = [...(g.offer ?? [])];
    for (const name of candidates) {
      const s = getShape(this.app.spec, name);
      if (!s || !s.allow.includes(persona) || s.effect !== "write" || name === wanted) continue;
      return formPour(name, s, {}, { hint: `To ${wantedShape.asks.charAt(0).toLowerCase()}${wantedShape.asks.slice(1)}, first: ${s.asks.charAt(0).toLowerCase()}${s.asks.slice(1)}.`, options: this.offersFor(persona), classifier: meta });
    }
    return undefined;
  }

  // ── trail navigation ─────────────────────────────────────────────────────

  /** Force a new visit (a new trail seeded from the previous head). Used by headless scripts and tests. */
  async newVisit(visitorId: string, envelope: Record<string, string> = {}) {
    const previous = await this.trails.latest(visitorId);
    const trail = await this.trails.open(visitorId, parseEnvelope(this.app, envelope));
    if (previous) await this.seedFrom(previous.id, trail.id);
    return trail;
  }

  async rewind(visitorId: string, turnId: string) {
    const trail = await this.trails.latest(visitorId);
    if (!trail) throw new Error("no trail");
    const t = await this.trails.rewind(trail.id, turnId);
    return { head: t.id, seq: t.seq, pour: t.pour as unknown as Pour };
  }

  async trail(visitorId: string) {
    const trail = await this.trails.latest(visitorId);
    if (!trail) return null;
    const turns = await this.trails.turns(trail.id);
    return { trail, turns: turns.map((t) => ({ id: t.id, parentId: t.parentId, seq: t.seq, author: t.author, at: t.at, shape: t.shape, kind: t.kind, confidence: t.confidence, answered: t.answered, latencyMs: t.latencyMs, utterance: t.utterance, phrase: (t.pour as any).phrase ?? (t.pour as any).text })) };
  }

  // ── notifications ────────────────────────────────────────────────────────

  /** Queue a notification for a visitor by spec name (rendered) or free text (operator). */
  async notify(visitorId: string, n: { name?: string; text?: string; args?: Record<string, unknown>; author?: "system" | "operator" }) {
    const def = n.name ? specNotifications(this.app.spec).find(([k]) => k === n.name)?.[1] : undefined;
    const text = def ? renderNotification(def.text, n.args ?? {}) : n.text ?? "";
    if (!text) throw new Error("notification needs text or a spec name");
    const next = (def?.next ?? []).map((x) => chip(this.app.spec, x.shape, resolveRefs(x.args ?? {}, n.args ?? {}) as Record<string, unknown>, x.label)).filter(Boolean);
    const author = n.author ?? (def ? "system" : "operator");
    const id = await this.trails.enqueueNotification(visitorId, { author, name: n.name, text, next });
    const connected = this.hub.connected(visitorId);
    if (connected) {
      const trail = await this.trails.latest(visitorId);
      if (trail) {
        const pours = await this.flushNotifications(visitorId, trail.id);
        for (const p of pours) this.hub.publish(visitorId, { type: "notification", data: p });
      }
    }

    // Offline delivery. Only when nobody is watching: a connected visitor has already been told, and
    // emailing them as well would be the same notification twice. The notification stays queued either
    // way, so a channel that fails changes nothing about what they see on their next visit — which is
    // why a channel throwing is logged and swallowed rather than failing the operator's request.
    const sent: { channel: string; ok: boolean; detail?: string }[] = [];
    if (!connected && this.channels.length) {
      const out: Outbound = { id, visitorId, text, name: n.name, author, next: next as Outbound["next"], to: await this.addressFor(visitorId) };
      for (const ch of this.channels) {
        try { sent.push({ channel: ch.name, ...(await ch.deliver(out)) }); }
        catch (e) { sent.push({ channel: ch.name, ok: false, detail: (e as Error).message }); this.log(`channel ${ch.name} threw: ${(e as Error).message}`); }
      }
    }
    return { id, text, author, delivered: connected, sent };
  }

  /** What a channel can address this visitor by. Same email lookup the persona rules use. */
  private async addressFor(visitorId: string): Promise<Outbound["to"]> {
    const v = await this.trails.visitor(visitorId);
    if (!v?.customerId) return { email: null, customerId: null };
    for (const [name, ent] of specEntities(this.app.spec)) {
      if (!("email" in ent.fields)) continue;
      const rows = await this.db.unsafe(`SELECT email FROM business."${snake(name)}" WHERE id = $1`, [v.customerId]).catch(() => [] as any[]);
      if (rows.length) return { email: rows[0].email ?? null, customerId: v.customerId };
    }
    return { email: null, customerId: v.customerId };
  }

  /** Operator shapes: a separate registry (§12.5). Only op.unmetReport and op.notify have engine-side plans. */
  async operate(shapeName: string, args: Record<string, unknown>): Promise<Pour> {
    const shape = this.app.spec.operator?.shapes?.[shapeName];
    if (!shape) throw new Error(`unknown operator shape ${shapeName}`);
    const parsed = inputSchema(shape, this.app.spec).safeParse(args);
    if (!parsed.success) return formPour(shapeName, shape, args, { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    const a = parsed.data as Record<string, unknown>;
    const t0 = performance.now();
    const prov = (records: number, read: string[] = [], wrote: string[] = []): Provenance => ({ shape: shapeName, calls: [], read, wrote, at: new Date().toISOString(), records, ms: Math.round(performance.now() - t0) });
    if (shapeName === "op.unmetReport") {
      const rows = await this.trails.unmet(String(a.since ?? "7d"));
      return { kind: "answer", shape: shapeName, phrase: `Unmet in the last ${a.since}`, vessel: "list", answer: rows, next: [], provenance: prov(rows.length, ["conversation.unmet"]) };
    }
    if (shapeName === "op.notify") {
      const r = await this.notify(String(a.visitorId), { text: String(a.text), author: "operator" });
      return { kind: "answer", shape: shapeName, phrase: "Notification queued", vessel: "confirm", answer: { ok: true, ...r }, next: [], provenance: prov(1, [], ["conversation.pending_notification"]) };
    }
    if (shape.plan) {
      const r = await this.planner.run({ shapeName, shape, args: a, visitor: { id: "operator" }, persona: "operator" });
      return answerPour(this.app.spec, shapeName, shape, a, r.answer, r.provenance, "operator");
    }
    return formPour(shapeName, shape, a, { error: `${shapeName} is handled by the TUI/CLI, not the engine` });
  }

  async health() {
    const cls = await this.classifier.health();
    let dbOk = true;
    try { await this.db`SELECT 1`; } catch { dbOk = false; }
    return { ok: dbOk && (cls.ok || this.classifier.name === "lexical"), db: dbOk, classifier: { name: this.classifier.name, ...cls }, business: this.app.spec.business.id, version: this.app.spec.business.version, strict: this.strict, sse: this.hub.size };
  }
}

export { nextChips };
