/**
 * Visitor accounts (accounts.ts) against a real Postgres: signing up and in, the session cookie that is
 * not the visitor id, the profile fields an account may change and the ones it may not, saved items,
 * lockout, an operator's reset, and Google with Google's token endpoint answered locally.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadApp } from "@fishtea/spec";
import { connect, migrate, seed, reset, Engine, LexicalClassifier, createServer, Accounts } from "../src/index.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const URL_ = process.env.FISHTEA_TEST_DATABASE_URL ?? "postgres://fishtea:fishtea@localhost:5434/fishtea";
const db = connect(URL_);
const dir = mkdtempSync(join(tmpdir(), "fishtea-accounts-"));
cpSync(join(ROOT, "templates/ecommerce"), dir, { recursive: true });
const scratch = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8"));
scratch.entities.customer.fields.photo = { type: "string", optional: true };
scratch.entities.customer.fields.preferences = { type: "json", optional: true };
scratch.rules.accounts = { entity: "customer", profile: ["name", "photo", "preferences"] };
writeFileSync(join(dir, "spec.json"), JSON.stringify(scratch, null, 2) + "\n");
const app = loadApp(dir);
let engine: Engine, server: ReturnType<typeof Bun.serve>, base = "";

beforeAll(async () => {
  await reset(db); await migrate(db, app); await seed(db, app);
  engine = new Engine({ app, db, classifier: new LexicalClassifier() });
  server = Bun.serve({ port: 0, fetch: createServer({ engine, operatorToken: "t", loginPerMinute: 1000 }).fetch });
  base = `http://localhost:${server.port}`;
});
afterAll(async () => { server.stop(true); await db.end(); rmSync(dir, { recursive: true, force: true }); });

const H = { "content-type": "application/json", "x-fishtea-visitor": "1" };
const cookieOf = (r: Response) => r.headers.get("set-cookie")?.match(/fishtea_account=([^;]+)/)?.[1] ?? "";
const post = (path: string, body: unknown, cookie = "", method = "POST") =>
  fetch(`${base}/account${path}`, { method, headers: { ...H, ...(cookie ? { cookie: `fishtea_account=${cookie}` } : {}) }, body: JSON.stringify(body) });
const me = async (cookie: string) => (await (await fetch(`${base}/account/me`, { headers: cookie ? { cookie: `fishtea_account=${cookie}` } : {} })).json()) as any;
const PW = "a long enough password";

describe("accounts", () => {
  test("sign up makes the customer row and a session; the visitor becomes that customer", async () => {
    const home = (await (await fetch(`${base}/`)).json()) as any;
    const visitor = home.visitor.id;
    const r = await fetch(`${base}/account/signup`, { method: "POST", headers: { ...H, "x-fishtea-visitor": visitor }, body: JSON.stringify({ email: "Ada@Example.com", password: PW, name: "Ada" }) });
    expect(r.status).toBe(200);
    const cookie = cookieOf(r);
    expect(cookie.length).toBeGreaterThan(30);
    expect(r.headers.get("set-cookie")).toContain("HttpOnly");
    const m = await me(cookie);
    expect(m.account).toMatchObject({ email: "ada@example.com", hasPassword: true, google: false, profile: { name: "Ada", photo: null, preferences: null } });
    const [v] = await db`SELECT customer_id FROM conversation.visitor WHERE id = ${visitor}`;
    const [cu] = await db`SELECT id, source FROM business.customer WHERE email = 'ada@example.com'`;
    expect(v.customer_id).toBe(cu.id);
    expect(cu.source).toBe("account");
  });

  test("no session, no account: the visitor id alone reads nothing", async () => {
    expect((await me("")).account).toBeNull();
    expect((await me("not-a-real-token")).account).toBeNull();
  });

  test("a second sign-up for the same email is told to sign in; weak passwords are refused", async () => {
    expect((await post("/signup", { email: "ada@example.com", password: PW })).status).toBe(409);
    expect((await post("/signup", { email: "bob@example.com", password: "short" })).status).toBe(400);
    expect((await post("/signup", { email: "not an email", password: PW })).status).toBe(400);
  });

  test("an email-only customer row (a newsletter form) is claimed, not duplicated", async () => {
    await db`INSERT INTO business.customer (id, email, name) VALUES ('cu_old', 'old@example.com', 'Old Name')`;
    const r = await post("/signup", { email: "old@example.com", password: PW, name: "New Name" });
    expect(r.status).toBe(200);
    expect((await me(cookieOf(r))).account.profile.name).toBe("Old Name");
    const [{ n }] = await db`SELECT count(*)::int AS n FROM business.customer WHERE email = 'old@example.com'`;
    expect(n).toBe(1);
  });

  test("sign in, sign out; a change without the header is refused", async () => {
    expect((await fetch(`${base}/account/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "ada@example.com", password: PW }) })).status).toBe(403);
    expect((await post("/login", { email: "ada@example.com", password: "wrong password!" })).status).toBe(401);
    const r = await post("/login", { email: "ADA@example.com", password: PW });
    expect(r.status).toBe(200);
    const cookie = cookieOf(r);
    expect((await me(cookie)).account.email).toBe("ada@example.com");
    await post("/logout", {}, cookie);
    expect((await me(cookie)).account).toBeNull();
  });

  test("the profile takes only its own fields, each of its type", async () => {
    const cookie = cookieOf(await post("/login", { email: "ada@example.com", password: PW }));
    const put = (body: unknown) => post("/profile", body, cookie, "PUT");
    const ok = await put({ name: "Ada L.", preferences: { moods: ["bold", "soft"] }, photo: "data:image/png;base64,iVBORw0KGgo=" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as any).account.profile).toMatchObject({ name: "Ada L.", preferences: { moods: ["bold", "soft"] } });
    expect((await put({ email: "evil@example.com" })).status).toBe(400);
    expect((await put({ source: "admin" })).status).toBe(400);
    expect((await put({ id: "cu_x" })).status).toBe(400);
    expect((await put({ preferences: "not json" })).status).toBe(400);
    expect((await put({ photo: "https://elsewhere/me.png" })).status).toBe(400);
    expect((await put({ photo: `data:image/png;base64,${"A".repeat(500_000)}` })).status).toBe(400);
    expect((await me(cookie)).account.email).toBe("ada@example.com");
  });

  test("saved items: on, off, listed newest first, and only with a session", async () => {
    const cookie = cookieOf(await post("/login", { email: "ada@example.com", password: PW }));
    expect((await post("/saved", { itemId: "p_1" })).status).toBe(401);
    await post("/saved", { itemId: "p_1" }, cookie);
    await Bun.sleep(5);
    await post("/saved", { itemId: "p_2" }, cookie);
    await post("/saved", { itemId: "p_2" }, cookie);
    const list = async () => ((await (await fetch(`${base}/account/saved`, { headers: { cookie: `fishtea_account=${cookie}` } })).json()) as any).saved.map((s: any) => s.id);
    expect(await list()).toEqual(["p_2", "p_1"]);
    await post("/saved", { itemId: "p_1", on: false }, cookie);
    expect(await list()).toEqual(["p_2"]);
    expect((await post("/saved", { itemId: "../etc" }, cookie)).status).toBe(400);
  });

  test("five wrong passwords lock the account; an operator's reset clears it and the owner signs up again", async () => {
    await post("/signup", { email: "lock@example.com", password: PW });
    for (let i = 0; i < 4; i++) expect((await post("/login", { email: "lock@example.com", password: "wrong password!" })).status).toBe(401);
    expect((await post("/login", { email: "lock@example.com", password: "wrong password!" })).status).toBe(423);
    expect((await post("/login", { email: "lock@example.com", password: PW })).status).toBe(423);
    expect(await new Accounts(db, () => app.spec).reset("lock@example.com")).toBe(true);
    expect((await post("/login", { email: "lock@example.com", password: PW })).status).toBe(401);
    expect((await post("/signup", { email: "lock@example.com", password: "a brand new password" })).status).toBe(200);
    expect((await post("/login", { email: "lock@example.com", password: "a brand new password" })).status).toBe(200);
  });

  test("Google: a verified email makes or joins the account; anything unverified or for another client is refused", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-1"; process.env.GOOGLE_CLIENT_SECRET = "secret";
    const jwt = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
    const answer = (claims: object) => (async () => new Response(JSON.stringify({ id_token: jwt(claims) }))) as unknown as typeof fetch;
    const good = { iss: "https://accounts.google.com", aud: "client-1", sub: "g-123", email: "ada@example.com", email_verified: true, exp: Date.now() / 1000 + 600, name: "Ada G" };
    const accounts = new Accounts(db, () => app.spec);
    const r = await accounts.signInWithGoogle("code", "http://x/cb", answer(good));
    expect(r.ok).toBe(true);
    const [a] = await db`SELECT a.google_sub, a.password_hash IS NOT NULL AS pw FROM fishtea.account a JOIN business.customer c ON c.id = a.customer_id WHERE c.email = 'ada@example.com'`;
    expect(a).toMatchObject({ google_sub: "g-123", pw: true });
    const fresh = await accounts.signInWithGoogle("code", "http://x/cb", answer({ ...good, sub: "g-9", email: "new@example.com", name: "New" }));
    expect(fresh.ok).toBe(true);
    expect((await accounts.me((fresh as any).customerId))!.profile.name).toBe("New");
    for (const bad of [{ ...good, email_verified: false }, { ...good, aud: "someone-else" }, { ...good, exp: 1 }, { ...good, iss: "https://evil" }])
      expect((await accounts.signInWithGoogle("code", "http://x/cb", answer(bad))).ok).toBe(false);
    delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
  });

  test("Google's return trip checks its state and only ever sends people to a path on this site", async () => {
    process.env.GOOGLE_CLIENT_ID = "client-1"; process.env.GOOGLE_CLIENT_SECRET = "secret";
    const start = await fetch(`${base}/account/google/start?next=//evil.example/x`, { redirect: "manual" });
    expect(start.status).toBe(302);
    expect(start.headers.get("location")).toStartWith("https://accounts.google.com/o/oauth2/v2/auth?");
    const local = new URL(start.headers.get("location")!).searchParams.get("redirect_uri");
    expect(local).toBe(`http://localhost:${server.port}/core/account/google/callback`);
    const real = await fetch(`${base}/account/google/start`, { redirect: "manual", headers: { "x-forwarded-host": "staging.example.com", "x-forwarded-proto": "http" } });
    expect(new URL(real.headers.get("location")!).searchParams.get("redirect_uri")).toBe("https://staging.example.com/core/account/google/callback");
    const oauth = start.headers.get("set-cookie")!.match(/fishtea_oauth=([^;]+)/)![1];
    expect(JSON.parse(decodeURIComponent(oauth)).next).toBe("/");
    const wrong = await fetch(`${base}/account/google/callback?state=forged&code=c`, { redirect: "manual", headers: { cookie: `fishtea_oauth=${oauth}` } });
    expect(wrong.headers.get("location")).toBe("/?account=google-failed");
    delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
  });

  test("one person on three browsers is one visitor; signing out gives the browser a fresh one", async () => {
    // three browsers, each arriving anonymously and saying something
    const browsers: string[] = [];
    for (let i = 0; i < 3; i++) {
      const v = ((await (await fetch(`${base}/`)).json()) as any).visitor.id;
      await fetch(`${base}/utter`, { method: "POST", headers: { ...H, "x-fishtea-visitor": v }, body: JSON.stringify({ text: `browser ${i} looking` }) });
      browsers.push(v);
    }
    const signIn = (v: string) => fetch(`${base}/account/login`, { method: "POST", headers: { ...H, "x-fishtea-visitor": v }, body: JSON.stringify({ email: "ada@example.com", password: PW }) });
    const a = await signIn(browsers[0]!);
    const home = ((await a.json()) as any).visitor as string;
    expect(home).toBeTruthy();
    expect(a.headers.get("set-cookie")).toContain(`fishtea_visitor=${home}`);
    // the second browser signs in: it gets the same visitor, and its visit moves with it
    const b = (await (await signIn(browsers[1]!)).json()) as any;
    expect(b.visitor).toBe(home);
    // the third already holds a session cookie from elsewhere: its first request is enough to fold it
    const cookie = cookieOf(a);
    const r = (await (await fetch(`${base}/`, { headers: { "x-fishtea-visitor": browsers[2]!, cookie: `fishtea_account=${cookie}` } })).json()) as any;
    expect(r.visitor.id).toBe(home);
    const folded = await db`SELECT id, merged_into FROM conversation.visitor WHERE id = ANY(${browsers.filter((x) => x !== home)})`;
    expect(folded.length).toBeGreaterThan(0);
    expect(folded.every((x: any) => x.merged_into === home)).toBe(true);
    const said = await db`SELECT u.utterance->>'text' AS t FROM conversation.turn u JOIN conversation.trail tr ON tr.id = u.trail_id WHERE tr.visitor_id = ${home} AND u.author = 'visitor'`;
    for (let i = 0; i < 3; i++) expect(said.map((x: any) => x.t)).toContain(`browser ${i} looking`);
    // a folded id is spent: presenting it alone starts afresh rather than reaching the account
    const stale = browsers.find((x) => x !== home)!;
    const again = (await (await fetch(`${base}/`, { headers: { "x-fishtea-visitor": stale } })).json()) as any;
    expect(again.visitor.id).not.toBe(stale);
    expect(again.visitor.id).not.toBe(home);
    // the admin's list counts the person once
    const list = (await (await fetch(`${base}/op/visitors`, { headers: { "x-fishtea-operator": "t" } })).json()) as any;
    expect(list.visitors.find((x: any) => x.id === home)).toMatchObject({ account: true });
    expect(list.visitors.some((x: any) => browsers.includes(x.id) && x.id !== home)).toBe(false);
    // signing out: a new anonymous visitor for this browser; the account keeps its own
    const out = (await (await post("/logout", {}, cookie)).json()) as any;
    expect(out.visitor).toBeTruthy();
    expect(out.visitor).not.toBe(home);
    const [h] = await db`SELECT customer_id FROM conversation.visitor WHERE id = ${home}`;
    expect(h.customer_id).toBeTruthy();
  });

  test("a visitor that is another account's is never folded into this one", async () => {
    const [{ visitor_id: ada }] = await db`SELECT a.visitor_id FROM fishtea.account a JOIN business.customer c ON c.id = a.customer_id WHERE c.email = 'ada@example.com'`;
    const r = await fetch(`${base}/account/signup`, { method: "POST", headers: { ...H, "x-fishtea-visitor": ada }, body: JSON.stringify({ email: "eve@example.com", password: PW }) });
    const eve = ((await r.json()) as any).visitor;
    expect(eve).not.toBe(ada);
    const [v] = await db`SELECT merged_into FROM conversation.visitor WHERE id = ${ada}`;
    expect(v.merged_into).toBeNull();
  });

  test("deleting an account ends it, keeps the customer row, and needs the words", async () => {
    const cookie = cookieOf(await post("/login", { email: "ada@example.com", password: PW }));
    expect((await post("", {}, cookie, "DELETE")).status).toBe(400);
    expect((await post("", { confirm: "delete my account" }, cookie, "DELETE")).status).toBe(200);
    expect((await me(cookie)).account).toBeNull();
    const rows = await db`SELECT name, photo, preferences FROM business.customer WHERE email = 'ada@example.com'`;
    expect(rows.length).toBe(1);
    expect(rows[0]).toEqual({ name: null, photo: null, preferences: null });
    expect((await post("/login", { email: "ada@example.com", password: PW })).status).toBe(401);
  });
});

describe("rules.accounts in the spec", () => {
  test("an entity without a unique email, a profile field it lacks, or a saved call that writes is refused", async () => {
    const { validateSpec } = await import("@fishtea/spec");
    const problems = (accounts: object) => {
      const s = JSON.parse(JSON.stringify(app.spec)); s.rules.accounts = accounts;
      try { validateSpec(s, { dir }); return []; } catch (e) { return (e as any).problems as string[]; }
    };
    expect(problems({ entity: "customer", profile: ["name"] })).toEqual([]);
    expect(problems({ entity: "nosuch" }).join()).toContain("unknown entity");
    expect(problems({ entity: "customer", profile: ["email"] }).join()).toContain('"email" is not a field');
    expect(problems({ entity: "customer", profile: ["shoeSize"] }).join()).toContain('"shoeSize"');
    expect(problems({ entity: "customer", saved: { call: "customer.upsert" } }).join()).toContain("must be a query taking ids");
  });
});
