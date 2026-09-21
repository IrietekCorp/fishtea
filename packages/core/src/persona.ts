/**
 * Persona derivation (BLUEPRINT §7). A tiny expression language over identity and the trail:
 *   identity.email != null      identity.cookie != null     identity.customerId != null
 *   trail.has('cart.add')       trail.has('order.place', 'last 1h')
 *   && || ! ( ) true false
 * Ordered: first persona whose predicate holds wins. Never evaluated by the model.
 */
import { type Spec, personas as specPersonas, shapes as specShapes, getShape } from "@fishtea/spec";

export interface Identity { email?: string | null; cookie?: string | null; issuedUrl?: string | null; customerId?: string | null }
export interface TrailFact { shape?: string | null; calls: string[]; wrote: string[]; at: Date; author: string; answered: boolean }

type Tok = { t: "id" | "str" | "op" | "num"; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'" || c === '"') { const j = src.indexOf(c, i + 1); if (j < 0) throw new Error("unterminated string"); out.push({ t: "str", v: src.slice(i + 1, j) }); i = j + 1; continue; }
    const two = src.slice(i, i + 2);
    if (["&&", "||", "!=", "==", ">=", "<="].includes(two)) { out.push({ t: "op", v: two }); i += 2; continue; }
    if ("!()<>,".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_.]*/);
    if (m) { out.push({ t: "id", v: m[0] }); i += m[0].length; continue; }
    const n = src.slice(i).match(/^\d+(\.\d+)?/);
    if (n) { out.push({ t: "num", v: n[0] }); i += n[0].length; continue; }
    throw new Error(`bad character "${c}" in persona expression`);
  }
  return out;
}

export function windowMs(spec: string): number {
  const m = spec.trim().replace(/^last\s+/, "").match(/^(\d+)\s*(m|min|h|hr|d|day|days|w)$/);
  if (!m) throw new Error(`bad window "${spec}"`);
  const n = Number(m[1]);
  return n * ({ m: 60e3, min: 60e3, h: 3600e3, hr: 3600e3, d: 86400e3, day: 86400e3, days: 86400e3, w: 7 * 86400e3 } as any)[m[2]];
}

export interface Env { identity: Identity; trail: TrailFact[]; now?: Date }

class Parser {
  i = 0;
  constructor(private toks: Tok[], private env: Env) {}
  peek() { return this.toks[this.i]; }
  eat(v?: string) { const t = this.toks[this.i++]; if (v && t?.v !== v) throw new Error(`expected ${v}`); return t; }
  or(): unknown { let l = this.and(); while (this.peek()?.v === "||") { this.eat(); const r = this.and(); l = Boolean(l) || Boolean(r); } return l; }
  and(): unknown { let l = this.not(); while (this.peek()?.v === "&&") { this.eat(); const r = this.not(); l = Boolean(l) && Boolean(r); } return l; }
  not(): unknown { if (this.peek()?.v === "!") { this.eat(); return !this.not(); } return this.cmp(); }
  cmp(): unknown {
    const l = this.atom();
    const op = this.peek();
    if (op?.t === "op" && ["!=", "==", ">", "<", ">=", "<="].includes(op.v)) {
      this.eat();
      const r = this.atom();
      switch (op.v) {
        case "!=": return l != r; case "==": return l == r;
        case ">": return (l as number) > (r as number); case "<": return (l as number) < (r as number);
        case ">=": return (l as number) >= (r as number); case "<=": return (l as number) <= (r as number);
      }
    }
    return l;
  }
  atom(): unknown {
    const t = this.eat();
    if (!t) throw new Error("unexpected end");
    if (t.v === "(") { const v = this.or(); this.eat(")"); return v; }
    if (t.t === "str") return t.v;
    if (t.t === "num") return Number(t.v);
    if (t.t === "id") {
      if (t.v === "true") return true;
      if (t.v === "false") return false;
      if (t.v === "null") return null;
      if (t.v.startsWith("identity.")) { const v = (this.env.identity as any)[t.v.slice(9)]; return v === undefined ? null : v; }
      if (t.v === "trail.has") {
        this.eat("(");
        const name = this.eat(); if (name.t !== "str") throw new Error("trail.has needs a quoted name");
        let win: number | undefined;
        if (this.peek()?.v === ",") { this.eat(); win = windowMs(this.eat().v); }
        this.eat(")");
        return trailHas(this.env, name.v, win);
      }
      if (t.v === "trail.length") return this.env.trail.length;
      throw new Error(`unknown identifier ${t.v}`);
    }
    throw new Error(`unexpected ${t.v}`);
  }
}

export function trailHas(env: Env, name: string, win?: number): boolean {
  const now = (env.now ?? new Date()).getTime();
  return env.trail.some((f) => {
    if (win !== undefined && now - f.at.getTime() > win) return false;
    if (!f.answered) return false;
    return f.shape === name || f.calls.includes(name) || f.wrote.includes(name) || f.wrote.includes(`business.${name}`);
  });
}

export function evaluate(expr: string, env: Env): boolean {
  const p = new Parser(lex(expr), env);
  const v = p.or();
  if (p.i !== p["toks"].length) throw new Error(`trailing tokens in "${expr}"`);
  return Boolean(v);
}

/** First persona (in spec order) whose predicate holds. */
export function derivePersona(spec: Spec, env: Env): string {
  for (const [name, def] of specPersonas(spec)) if (evaluate(def.when, env)) return name;
  return "stranger";
}

/** The shapes this persona may use: the classifier never sees the rest (§12.1). */
export function allowedShapes(spec: Spec, persona: string): string[] {
  return specShapes(spec).filter(([, s]) => s.allow.includes(persona)).map(([n]) => n);
}

export function isAllowed(spec: Spec, shape: string, persona: string): boolean {
  const s = getShape(spec, shape);
  return !!s && s.allow.includes(persona);
}

/** Validate every persona expression at load time so a typo fails fast. */
export function checkPersonas(spec: Spec): string[] {
  const problems: string[] = [];
  const env: Env = { identity: {}, trail: [] };
  for (const [name, def] of specPersonas(spec)) {
    try { evaluate(def.when, env); } catch (e) { problems.push(`personas.${name}: ${(e as Error).message}`); }
  }
  return problems;
}
