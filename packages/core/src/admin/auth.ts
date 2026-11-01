/**
 * Operators and their sessions: who may open /admin.
 *
 * There is one account to start with — `admin`, with a password everybody can read in the docs — and it
 * must be changed at the first sign-in: until it is, a session can do nothing but change it. That keeps a
 * fresh install usable without a setup step, and keeps the well-known password from being worth anything
 * once somebody has signed in. `FISHTEA_ADMIN_PASSWORD` seeds a different first password; it is still
 * changed at first sign-in, because an environment variable is not a place a password should live.
 *
 * Passwords are argon2id (Bun.password). A session is 32 random bytes handed to the browser in an
 * httpOnly, SameSite=Strict cookie and stored only as its sha256, so reading the table grants nothing.
 * Five wrong passwords lock an account for fifteen minutes; the answer to a wrong username and a wrong
 * password is the same, and both cost a hash.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Db } from "../db/index.ts";
import { newId } from "../trail/index.ts";

export const DEFAULT_OPERATOR = "admin";
export const DEFAULT_PASSWORD = "fishtea-admin";
export const SESSION_HOURS = 8;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export interface Operator { id: string; username: string; mustChange: boolean }
export type SignIn = { ok: true; token: string; operator: Operator; expires: Date } | { ok: false; reason: "invalid" | "locked"; retryAfter?: number };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const row = (r: any): Operator => ({ id: r.id, username: r.username, mustChange: r.must_change });

/** Why a new password is not good enough, or null. Length is what matters; rules about symbols are not. */
export function passwordProblem(next: string, username: string): string | null {
  if (typeof next !== "string" || next.length < 12) return "at least 12 characters";
  if (next.length > 256) return "at most 256 characters";
  if (next === DEFAULT_PASSWORD || next === process.env.FISHTEA_ADMIN_PASSWORD) return "different from the password you were given";
  if (next.toLowerCase().includes(username.toLowerCase())) return "free of the username";
  return null;
}

export class OperatorAuth {
  constructor(private db: Db) {}

  /** The first operator, when there is none. Returns true when it made one — the start-up banner says so. */
  async ensureDefault(): Promise<boolean> {
    const [{ n }] = await this.db`SELECT count(*)::int AS n FROM fishtea.operator`;
    if (n > 0) return false;
    const hash = await Bun.password.hash(process.env.FISHTEA_ADMIN_PASSWORD || DEFAULT_PASSWORD);
    await this.db`INSERT INTO fishtea.operator (id, username, password_hash, must_change) VALUES (${newId("op")}, ${DEFAULT_OPERATOR}, ${hash}, true) ON CONFLICT (username) DO NOTHING`;
    return true;
  }

  /**
   * Back to the first password, for an operator who has lost theirs (`fishtea admin reset`). It is the
   * password a new installation gets, FISHTEA_ADMIN_PASSWORD or the documented one, and it must be changed
   * at the next sign-in, so a reset hands nobody a working account. A lockout is lifted and every session
   * of that operator ends. An operator who does not exist yet is created, as on a first start.
   */
  async reset(username = DEFAULT_OPERATOR): Promise<"reset" | "created"> {
    const hash = await Bun.password.hash(process.env.FISHTEA_ADMIN_PASSWORD || DEFAULT_PASSWORD);
    const [r] = await this.db`SELECT id FROM fishtea.operator WHERE username = ${username}`;
    if (!r) {
      await this.db`INSERT INTO fishtea.operator (id, username, password_hash, must_change) VALUES (${newId("op")}, ${username}, ${hash}, true)`;
      return "created";
    }
    await this.db`UPDATE fishtea.operator SET password_hash = ${hash}, must_change = true, failed = 0, locked_until = NULL WHERE id = ${r.id}`;
    await this.db`DELETE FROM fishtea.operator_session WHERE operator_id = ${r.id}`;
    return "reset";
  }

  /** Whether an operator is still on the password they were given, for the banner. */
  async defaultStillSet(): Promise<boolean> {
    return (await this.db`SELECT 1 FROM fishtea.operator WHERE must_change LIMIT 1`).length > 0;
  }

  async signIn(username: string, password: string): Promise<SignIn> {
    const [r] = await this.db`SELECT * FROM fishtea.operator WHERE username = ${String(username ?? "")}`;
    if (!r) { await Bun.password.verify(String(password ?? ""), DUMMY); return { ok: false, reason: "invalid" }; }
    if (r.locked_until && new Date(r.locked_until) > new Date()) {
      return { ok: false, reason: "locked", retryAfter: Math.ceil((new Date(r.locked_until).getTime() - Date.now()) / 1000) };
    }
    if (!(await Bun.password.verify(String(password ?? ""), r.password_hash))) {
      const failed = r.failed + 1;
      const lock = failed >= MAX_FAILED;
      await this.db`UPDATE fishtea.operator SET failed = ${lock ? 0 : failed}, locked_until = ${lock ? new Date(Date.now() + LOCK_MINUTES * 60e3) : null} WHERE id = ${r.id}`;
      return lock ? { ok: false, reason: "locked", retryAfter: LOCK_MINUTES * 60 } : { ok: false, reason: "invalid" };
    }
    await this.db`UPDATE fishtea.operator SET failed = 0, locked_until = NULL WHERE id = ${r.id}`;
    const token = randomBytes(32).toString("base64url");
    const expires = new Date(Date.now() + SESSION_HOURS * 3600e3);
    await this.db`INSERT INTO fishtea.operator_session (token_hash, operator_id, expires_at) VALUES (${sha(token)}, ${r.id}, ${expires})`;
    await this.db`DELETE FROM fishtea.operator_session WHERE expires_at < now()`;
    return { ok: true, token, operator: row(r), expires };
  }

  /** The operator a session token belongs to, while it lasts. */
  async session(token: string | undefined | null): Promise<Operator | null> {
    if (!token) return null;
    const [r] = await this.db`SELECT o.* FROM fishtea.operator_session s JOIN fishtea.operator o ON o.id = s.operator_id WHERE s.token_hash = ${sha(token)} AND s.expires_at > now()`;
    return r ? row(r) : null;
  }

  async signOut(token: string | undefined | null): Promise<void> {
    if (token) await this.db`DELETE FROM fishtea.operator_session WHERE token_hash = ${sha(token)}`;
  }

  /**
   * Change a password: the current one is asked for again, whatever the session says. Every other session
   * of that operator ends, so a password changed because it leaked closes the doors it opened.
   */
  async changePassword(op: Operator, current: string, next: string, keepToken: string): Promise<{ ok: true } | { ok: false; problem: string }> {
    const [r] = await this.db`SELECT * FROM fishtea.operator WHERE id = ${op.id}`;
    if (!r || !(await Bun.password.verify(String(current ?? ""), r.password_hash))) return { ok: false, problem: "the current password is not right" };
    const problem = passwordProblem(next, r.username);
    if (problem) return { ok: false, problem: `the new password must be ${problem}` };
    if (await Bun.password.verify(next, r.password_hash)) return { ok: false, problem: "the new password must be different from the current one" };
    await this.db`UPDATE fishtea.operator SET password_hash = ${await Bun.password.hash(next)}, must_change = false, changed_at = now() WHERE id = ${op.id}`;
    await this.db`DELETE FROM fishtea.operator_session WHERE operator_id = ${op.id} AND token_hash <> ${sha(keepToken)}`;
    return { ok: true };
  }
}

/** A real argon2id hash to verify against when the username does not exist, so both failures cost the same. */
const DUMMY = await Bun.password.hash(randomBytes(16).toString("hex"));
