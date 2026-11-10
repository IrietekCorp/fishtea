/**
 * Visitor accounts: a visitor who can sign in, from any device, and keep a profile and saved items.
 *
 * An application turns them on in `rules.accounts`:
 *
 *   "accounts": { "entity": "customer", "profile": ["name", "photo", "preferences", "sizes", "budget"] }
 *
 * The account *is* a row of that entity (it must have a unique `email`): signing up makes one, or claims
 * the row an earlier email-only form made. `profile` lists the fields the holder may read and change from
 * their account page, and nothing else is ever written through here. `saved.call`, when given, is a
 * query taking `ids` (id[]) — products.byIds, say — and GET /account/saved answers its rows beside the ids,
 * so an account page draws saved pieces in one request. Credentials live in fishtea.account:
 * an argon2id password, a Google subject, or both.
 *
 * **The session is its own cookie**, `fishtea_account`: 32 random bytes, httpOnly, stored only as its
 * sha256, 30 days. The visitor id is not a credential for this — it travels in headers and, for
 * EventSource, in URLs — so it is never enough to read a profile. Signing in also sets the visitor's
 * `customer_id`, which is what makes the conversation treat them as a customer (persona, personal
 * answers).
 *
 * **One person, one visitor.** An account has its own visitor (`fishtea.account.visitor_id`), and every
 * browser it signs in on uses that one (`adopt`): what the browser did before signing in is folded into it
 * (TrailService.merge), so a person on a laptop, a phone and a work machine is one visitor with one history,
 * not three. Signing out leaves the account's visitor as it is and gives the browser a fresh, anonymous one,
 * so the next person at that machine is nobody in particular. A visitor that is another account's is never
 * folded into this one.
 *
 * Google: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the environment turn it on. The id token is taken
 * from Google's token endpoint over TLS with our secret, so its signature need not be checked again
 * (OpenID Connect Core §3.1.3.7); its audience, issuer, expiry and email_verified are. An account with the
 * same email (verified by Google) gains the Google sign-in.
 *
 * What an account does not have yet: email verification and a password-reset email, which need an email
 * service. Until then a lost password is the operator's to reset (`fishtea account reset <email>`).
 */
import { createHash, randomBytes } from "node:crypto";
import { members, type Spec, type EntityDef } from "@fishtea/spec";
import type { Db } from "./db/index.ts";
import { newId, TrailService } from "./trail/index.ts";
import { snake } from "./calls/index.ts";

export const ACCOUNT_DAYS = 30;
const MAX_FAILED = 5, LOCK_MINUTES = 15;
export const PHOTO_MAX = 400_000;
const JSON_MAX = 8_000, TEXT_MAX = 2_000;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AccountsConfig { entity: string; profile: string[]; saved?: { call: string } }
export interface Account { customerId: string; email: string; hasPassword: boolean; google: boolean; profile: Record<string, unknown> }
export type Outcome<T = {}> = ({ ok: true } & T) | { ok: false; status: number; error: string };

export function accountsConfig(spec: Spec): AccountsConfig | null {
  const r = (spec.rules as any)?.accounts;
  if (!r || typeof r !== "object" || typeof r.entity !== "string") return null;
  return {
    entity: r.entity, profile: Array.isArray(r.profile) ? r.profile.map(String) : [],
    ...(r.saved && typeof r.saved.call === "string" ? { saved: { call: r.saved.call } } : {}),
  };
}

/** Why a password will not do, or null. Length is what matters. */
export function accountPasswordProblem(p: unknown, email: string): string | null {
  if (typeof p !== "string" || p.length < 10) return "at least 10 characters";
  if (p.length > 256) return "at most 256 characters";
  if (p.toLowerCase() === email.toLowerCase() || p.toLowerCase().includes(email.split("@")[0].toLowerCase())) return "something other than your email";
  return null;
}

export class Accounts {
  constructor(private db: Db, private spec: () => Spec) {}

  get config() { return accountsConfig(this.spec()); }
  private get table() { return `business."${snake(this.config!.entity)}"`; }
  private entity(): EntityDef { return members<EntityDef>(this.spec().entities).find(([n]) => n === this.config!.entity)![1]; }
  get googleEnabled() { return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET); }

  // ── who ──────────────────────────────────────────────────────────────────

  async session(token: string | undefined | null): Promise<string | null> {
    if (!token) return null;
    const [r] = await this.db`SELECT customer_id FROM fishtea.account_session WHERE token_hash = ${sha(token)} AND expires_at > now()`;
    return r?.customer_id ?? null;
  }

  async me(customerId: string): Promise<Account | null> {
    const cfg = this.config!;
    const [a] = await this.db`SELECT * FROM fishtea.account WHERE customer_id = ${customerId}`;
    if (!a) return null;
    const cols = ["email", ...cfg.profile.filter((f) => f !== "email")].map((f) => `"${snake(f)}" AS "${f}"`).join(", ");
    const [row] = await this.db.unsafe(`SELECT ${cols} FROM ${this.table} WHERE id = $1`, [customerId]);
    if (!row) return null;
    const { email, ...profile } = row as Record<string, unknown>;
    return { customerId, email: String(email), hasPassword: !!a.password_hash, google: !!a.google_sub, profile };
  }

  private async startSession(customerId: string): Promise<{ token: string; expires: Date }> {
    const token = randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + ACCOUNT_DAYS * 86400e3);
    await this.db`INSERT INTO fishtea.account_session (token_hash, customer_id, expires_at) VALUES (${sha(token)}, ${customerId}, ${expires})`;
    await this.db`DELETE FROM fishtea.account_session WHERE expires_at < now()`;
    return { token, expires };
  }

  /**
   * The account's own visitor, folding in the one this browser presented (and any other visitor still
   * linked to the customer from before accounts had one). Returns the id the browser should use from now.
   */
  async adopt(customerId: string, presented: string | null): Promise<string> {
    return this.db.begin(async (tx: any) => {
      const [a] = await tx`SELECT visitor_id FROM fishtea.account WHERE customer_id = ${customerId} FOR UPDATE`;
      const live = async (id: string | null | undefined) =>
        !!id && (await tx`SELECT 1 FROM conversation.visitor WHERE id = ${id} AND merged_into IS NULL`).length > 0;
      // the presented visitor joins only if it is nobody else's: anonymous, or already this customer
      const [p] = presented ? await tx`SELECT id FROM conversation.visitor v WHERE id = ${presented} AND merged_into IS NULL
        AND (customer_id IS NULL OR customer_id = ${customerId})
        AND NOT EXISTS (SELECT 1 FROM fishtea.account x WHERE x.visitor_id = v.id AND x.customer_id <> ${customerId})` : [];
      let home: string | null = a && (await live(a.visitor_id)) ? a.visitor_id : null;
      if (!home) {
        const [first] = await tx`SELECT id FROM conversation.visitor WHERE customer_id = ${customerId} AND merged_into IS NULL ORDER BY created_at LIMIT 1`;
        home = first?.id ?? p?.id ?? null;
      }
      if (!home) { home = newId("v"); await tx`INSERT INTO conversation.visitor (id) VALUES (${home})`; }
      const others = await tx`SELECT id FROM conversation.visitor WHERE merged_into IS NULL AND id <> ${home}
        AND (customer_id = ${customerId} OR id = ${p?.id ?? null})`;
      if (others.length) await new TrailService(this.db).merge(others.map((r: any) => r.id), home, tx);
      await tx`UPDATE conversation.visitor SET customer_id = ${customerId}, last_seen = now() WHERE id = ${home}`;
      if (a) await tx`UPDATE fishtea.account SET visitor_id = ${home} WHERE customer_id = ${customerId}`;
      return home;
    });
  }

  /**
   * For a request carrying an account session: the visitor it should be, adopting on the way when the
   * browser presented another. Null when the session is not a live one. The common case is one query.
   */
  async visitorFor(token: string | undefined | null, presented: string | null): Promise<string | null> {
    if (!token) return null;
    const [r] = await this.db`SELECT s.customer_id, a.visitor_id, (v.id IS NOT NULL) AS live
      FROM fishtea.account_session s JOIN fishtea.account a ON a.customer_id = s.customer_id
      LEFT JOIN conversation.visitor v ON v.id = a.visitor_id AND v.merged_into IS NULL
      WHERE s.token_hash = ${sha(token)} AND s.expires_at > now()`;
    if (!r) return null;
    if (r.live && r.visitor_id === presented) return presented;
    return this.adopt(r.customer_id, presented);
  }

  /** The visitor becomes this customer in the conversation (persona, personal answers). */
  async link(visitorId: string | null, customerId: string | null) {
    if (visitorId) await this.db`UPDATE conversation.visitor SET customer_id = ${customerId} WHERE id = ${visitorId}`;
  }

  // ── signing up, in and out ───────────────────────────────────────────────

  private async customerByEmail(email: string): Promise<string | null> {
    const [r] = await this.db.unsafe(`SELECT id FROM ${this.table} WHERE lower(email) = lower($1) LIMIT 1`, [email]);
    return r?.id ?? null;
  }

  private async createCustomer(email: string, name: string | null): Promise<string> {
    const fields = this.entity().fields;
    const id = newId("cu");
    const cols = ["id", "email"], vals: unknown[] = [id, email];
    if (name && "name" in fields) { cols.push("name"); vals.push(name.slice(0, 200)); }
    if ("source" in fields) { cols.push("source"); vals.push("account"); }
    await this.db.unsafe(`INSERT INTO ${this.table} (${cols.map((c) => `"${snake(c)}"`).join(", ")}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(", ")})`, vals as any[]);
    return id;
  }

  async signUp(email: unknown, password: unknown, name: unknown): Promise<Outcome<{ token: string; expires: Date; customerId: string }>> {
    const e = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!EMAIL.test(e) || e.length > 254) return { ok: false, status: 400, error: "an email address, please" };
    const problem = accountPasswordProblem(password, e);
    if (problem) return { ok: false, status: 400, error: `a password of ${problem}` };
    let customerId = await this.customerByEmail(e);
    if (customerId) {
      const [a] = await this.db`SELECT password_hash, google_sub FROM fishtea.account WHERE customer_id = ${customerId}`;
      // an account with a way in is signed in to, not signed up for; one an operator reset (no password,
      // no Google) is taken back by signing up again, keeping its profile and saves
      if (a && (a.password_hash || a.google_sub)) return { ok: false, status: 409, error: "there is already an account for that email; sign in instead" };
    } else customerId = await this.createCustomer(e, typeof name === "string" && name.trim() ? name.trim() : null);
    await this.db`INSERT INTO fishtea.account (customer_id, password_hash) VALUES (${customerId}, ${await Bun.password.hash(password as string)})
                  ON CONFLICT (customer_id) DO UPDATE SET password_hash = excluded.password_hash, failed = 0, locked_until = NULL, changed_at = now()`;
    if (typeof name === "string" && name.trim() && "name" in this.entity().fields)
      await this.db.unsafe(`UPDATE ${this.table} SET name = coalesce(name, $2) WHERE id = $1`, [customerId, name.trim().slice(0, 200)]);
    return { ok: true, customerId, ...(await this.startSession(customerId)) };
  }

  async signIn(email: unknown, password: unknown): Promise<Outcome<{ token: string; expires: Date; customerId: string }>> {
    const e = typeof email === "string" ? email.trim().toLowerCase() : "";
    const customerId = EMAIL.test(e) ? await this.customerByEmail(e) : null;
    const [a] = customerId ? await this.db`SELECT * FROM fishtea.account WHERE customer_id = ${customerId}` : [];
    if (!a?.password_hash) { await Bun.password.verify(String(password ?? ""), DUMMY); return { ok: false, status: 401, error: "wrong email or password" }; }
    if (a.locked_until && new Date(a.locked_until) > new Date()) return { ok: false, status: 423, error: `too many tries; wait ${Math.ceil((new Date(a.locked_until).getTime() - Date.now()) / 60000)} minutes` };
    if (!(await Bun.password.verify(String(password ?? ""), a.password_hash))) {
      const failed = a.failed + 1, lock = failed >= MAX_FAILED;
      await this.db`UPDATE fishtea.account SET failed = ${lock ? 0 : failed}, locked_until = ${lock ? new Date(Date.now() + LOCK_MINUTES * 60e3) : null} WHERE customer_id = ${customerId}`;
      return { ok: false, status: lock ? 423 : 401, error: lock ? `too many tries; wait ${LOCK_MINUTES} minutes` : "wrong email or password" };
    }
    await this.db`UPDATE fishtea.account SET failed = 0, locked_until = NULL WHERE customer_id = ${customerId}`;
    return { ok: true, customerId: customerId!, ...(await this.startSession(customerId!)) };
  }

  async signOut(token: string | undefined | null) {
    if (token) await this.db`DELETE FROM fishtea.account_session WHERE token_hash = ${sha(token)}`;
  }

  async changePassword(customerId: string, current: unknown, next: unknown, keepToken: string): Promise<Outcome> {
    const acc = await this.me(customerId);
    const [a] = await this.db`SELECT password_hash FROM fishtea.account WHERE customer_id = ${customerId}`;
    // an account made with Google has no password yet; it may set one without a current one
    if (a?.password_hash && !(await Bun.password.verify(String(current ?? ""), a.password_hash))) return { ok: false, status: 400, error: "the current password is not right" };
    const problem = accountPasswordProblem(next, acc!.email);
    if (problem) return { ok: false, status: 400, error: `a password of ${problem}` };
    await this.db`UPDATE fishtea.account SET password_hash = ${await Bun.password.hash(next as string)}, changed_at = now() WHERE customer_id = ${customerId}`;
    await this.db`DELETE FROM fishtea.account_session WHERE customer_id = ${customerId} AND token_hash <> ${sha(keepToken)}`;
    return { ok: true };
  }

  /** Back to no password, every session ended: an operator's answer to "I've lost my password" until email resets exist. */
  async reset(email: string): Promise<boolean> {
    const customerId = await this.customerByEmail(email.trim().toLowerCase());
    if (!customerId) return false;
    const r = await this.db`UPDATE fishtea.account SET password_hash = NULL, failed = 0, locked_until = NULL WHERE customer_id = ${customerId} RETURNING customer_id`;
    await this.db`DELETE FROM fishtea.account_session WHERE customer_id = ${customerId}`;
    return r.length > 0;
  }

  /**
   * The account, its saves and its profile go: every profile field that may be empty is emptied. The
   * customer row stays as the application's record (an order, a conversion may point at it), with only
   * what the application itself put there, and without a way in.
   */
  async remove(customerId: string) {
    const fields = this.entity().fields as Record<string, any>;
    const clear = this.config!.profile.filter((f) => f in fields && f !== "id" && f !== "email" && (typeof fields[f] === "string" ? fields[f].includes("?") : fields[f].optional));
    if (clear.length) await this.db.unsafe(`UPDATE ${this.table} SET ${clear.map((f) => `"${snake(f)}" = NULL`).join(", ")} WHERE id = $1`, [customerId]);
    await this.db`UPDATE conversation.visitor SET customer_id = NULL WHERE customer_id = ${customerId}`;
    // the account's visitor stays (its history is the business's record) but is nobody's any more
    await this.db`DELETE FROM fishtea.account WHERE customer_id = ${customerId}`;
  }

  // ── the profile ──────────────────────────────────────────────────────────

  /** Write the listed fields the request carries, each checked against its type; anything else is refused. */
  async updateProfile(customerId: string, patch: unknown): Promise<Outcome> {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { ok: false, status: 400, error: "a profile is an object" };
    const cfg = this.config!, fields = this.entity().fields as Record<string, any>;
    const sets: string[] = [], vals: unknown[] = [customerId];
    for (const [k, v] of Object.entries(patch)) {
      if (!cfg.profile.includes(k) || k === "email" || k === "id" || !(k in fields)) return { ok: false, status: 400, error: `${k} is not part of the profile` };
      const t = typeof fields[k] === "string" ? fields[k] : fields[k].type;
      const base = String(t).replace(/[?]$/, "");
      const problem = valueProblem(k, base, v);
      if (problem) return { ok: false, status: 400, error: problem };
      vals.push(v === "" ? null : v);
      sets.push(`"${snake(k)}" = $${vals.length}${base === "json" ? "::jsonb" : ""}`);
    }
    if (!sets.length) return { ok: true };
    await this.db.unsafe(`UPDATE ${this.table} SET ${sets.join(", ")} WHERE id = $1`, vals as any[]); // postgres.js encodes a jsonb value itself; never pre-stringify
    return { ok: true };
  }

  // ── saved items ──────────────────────────────────────────────────────────

  async saved(customerId: string): Promise<{ id: string; at: string }[]> {
    const rows = await this.db`SELECT item_id, at FROM fishtea.saved WHERE customer_id = ${customerId} ORDER BY at DESC LIMIT 500`;
    return rows.map((r: any) => ({ id: r.item_id, at: new Date(r.at).toISOString() }));
  }
  async save(customerId: string, itemId: unknown, on: boolean): Promise<Outcome> {
    if (typeof itemId !== "string" || !/^[\w-]{1,80}$/.test(itemId)) return { ok: false, status: 400, error: "an item id, please" };
    if (on) {
      const [{ n }] = await this.db`SELECT count(*)::int AS n FROM fishtea.saved WHERE customer_id = ${customerId}`;
      if (n >= 500) return { ok: false, status: 400, error: "500 saved pieces is the most an account keeps" };
      await this.db`INSERT INTO fishtea.saved (customer_id, item_id) VALUES (${customerId}, ${itemId}) ON CONFLICT DO NOTHING`;
    } else await this.db`DELETE FROM fishtea.saved WHERE customer_id = ${customerId} AND item_id = ${itemId}`;
    return { ok: true };
  }

  // ── Google ───────────────────────────────────────────────────────────────

  googleAuthUrl(state: string, redirectUri: string): string {
    const q = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri, response_type: "code", scope: "openid email profile", state, prompt: "select_account" });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }

  /** Exchange the code, check the id token, and find or make the account. */
  async signInWithGoogle(code: string, redirectUri: string, fetcher: typeof fetch = fetch): Promise<Outcome<{ token: string; expires: Date; customerId: string }>> {
    const res = await fetcher("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    if (!res.ok) return { ok: false, status: 502, error: "Google did not accept the sign-in" };
    const { id_token } = (await res.json()) as { id_token?: string };
    const claims = decodeJwt(id_token);
    const now = Date.now() / 1000;
    if (!claims || claims.aud !== process.env.GOOGLE_CLIENT_ID || !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) || !(claims.exp > now) || !claims.sub)
      return { ok: false, status: 401, error: "Google's answer did not check out" };
    if (claims.email_verified !== true || typeof claims.email !== "string") return { ok: false, status: 401, error: "Google did not vouch for that email" };
    const sub = String(claims.sub), email = claims.email.toLowerCase();
    let [a] = await this.db`SELECT customer_id FROM fishtea.account WHERE google_sub = ${sub}`;
    let customerId: string | null = a?.customer_id ?? null;
    if (!customerId) {
      customerId = (await this.customerByEmail(email)) ?? (await this.createCustomer(email, typeof claims.name === "string" ? claims.name : null));
      await this.db`INSERT INTO fishtea.account (customer_id, google_sub) VALUES (${customerId}, ${sub})
                    ON CONFLICT (customer_id) DO UPDATE SET google_sub = ${sub}`;
      if (typeof claims.name === "string" && "name" in this.entity().fields)
        await this.db.unsafe(`UPDATE ${this.table} SET name = coalesce(name, $2) WHERE id = $1`, [customerId, claims.name.slice(0, 200)]);
    }
    return { ok: true, customerId, ...(await this.startSession(customerId)) };
  }
}

function valueProblem(k: string, base: string, v: unknown): string | null {
  if (v === null || v === "") return null;
  if (base === "json") return typeof v === "object" && JSON.stringify(v).length <= JSON_MAX ? null : `${k} must be a list or an object, at most ${JSON_MAX / 1000} kB`;
  if (base === "int" || base === "number" || base === "money") return typeof v === "number" && Number.isFinite(v) && (base !== "int" || Number.isInteger(v)) ? null : `${k} must be a number`;
  if (base === "boolean") return typeof v === "boolean" ? null : `${k} must be true or false`;
  if (typeof v !== "string") return `${k} must be text`;
  if (/photo|avatar|image/i.test(k)) return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= PHOTO_MAX ? null : `${k} must be a PNG, JPEG or WebP picture under ${PHOTO_MAX / 1000} kB`;
  return v.length <= TEXT_MAX ? null : `${k} must be at most ${TEXT_MAX} characters`;
}

function decodeJwt(t?: string): any {
  try { return JSON.parse(Buffer.from(String(t).split(".")[1], "base64url").toString("utf8")); } catch { return null; }
}

const DUMMY = await Bun.password.hash(randomBytes(16).toString("hex"));
