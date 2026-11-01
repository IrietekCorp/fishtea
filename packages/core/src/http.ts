/**
 * Hono transport (BLUEPRINT D7, §13): /, /utter, /events, /trail/*, /sessions, /healthz, and the operator
 * surface under /op/* — open to a script holding FISHTEA_OPERATOR_TOKEN, or to an operator signed in at
 * /admin (/op/auth/*). The intelligence is the engine; this is a thin skin.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SpecError, validateSpec } from "@fishtea/spec";
import { OperatorAuth, SESSION_HOURS, type Operator } from "./admin/auth.ts";
import { Jobs } from "./admin/jobs.ts";
import { applySettings, settingsOf } from "./admin/settings.ts";
import { Data, DataError } from "./admin/data.ts";
import { streamSSE } from "hono/streaming";
import type { Engine, Utterance } from "./engine.ts";
import type { App } from "@fishtea/spec";

const COOKIE = "fishtea_visitor";
/** An operator's session. Not the visitor's cookie: the two never stand in for each other. */
const OP_COOKIE = "fishtea_operator";

/**
 * The browser refuses a wildcard `Access-Control-Allow-Origin` on a credentialed request, so the origin has
 * to be reflected rather than starred. Reflecting *anything* would let any site make credentialed calls, so
 * by default only origins on a hostname this core answers on are echoed back — which covers the UI on another
 * port of the same machine. FISHTEA_CORS_ORIGINS names others explicitly.
 */
export function allowOrigin(policy: CorsPolicy = {}): (origin: string) => string | undefined {
  const exact = policy.origins;
  const hosts = new Set([...(policy.hosts ?? []), "localhost", "127.0.0.1", "::1", "[::1]"]);
  return (origin: string) => {
    if (!origin) return undefined;               // same-origin, or not a browser
    if (exact === "*") return origin;
    if (exact?.length) return exact.includes(origin) ? origin : undefined;
    try { return hosts.has(new URL(origin).hostname) ? origin : undefined; } catch { return undefined; }
  };
}

interface Bucket { tokens: number; at: number }
/** A token bucket per key. One per server, so two servers in one process do not spend each other's. */
function limiter() {
  const buckets = new Map<string, Bucket>();
  return (key: string, perMinute = 120): boolean => {
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: perMinute, at: now };
    b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60000) * perMinute);
    b.at = now;
    if (b.tokens < 1) { buckets.set(key, b); return false; }
    b.tokens -= 1;
    buckets.set(key, b);
    return true;
  };
}

export interface CorsPolicy {
  /** Exact origins to allow. "*" reflects whatever asks. Empty or absent falls back to `hosts`. */
  origins?: string[] | "*";
  /** Hostnames this core answers on. Any origin on one of them is allowed, whatever its port, so the UI
   *  served from :5173 on the same machine works without configuration. */
  hosts?: string[];
}

export interface ServerOptions {
  engine: Engine;
  operatorToken?: string;
  onReload?: () => Promise<App>;
  onRestart?: () => Promise<void>;
  onEditSection?: (section: string, patch: unknown) => Promise<{ ok: boolean; version: string; migrationNeeded?: boolean }>;
  /** a plugin's configuration changed: regenerate what the ui bundle derives from it */
  onPluginsChanged?: () => Promise<void>;
  /** sign-in attempts allowed per address per minute (10) */
  loginPerMinute?: number;
  cors?: CorsPolicy;
}

export function createServer(opts: ServerOptions) {
  const { engine } = opts;
  const rateLimit = limiter();
  const app = new Hono();
  app.use("*", cors({
    origin: allowOrigin(opts.cors),
    credentials: true,
    allowHeaders: ["content-type", "x-fishtea-visitor", "x-fishtea-operator", "x-fishtea-tool", "x-fishtea-admin"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    maxAge: 600,
  }));

  const envelopeOf = (c: any) => {
    const q = c.req.query();
    return {
      referrer: c.req.header("referer") ?? q.ref, utm_source: q.utm_source, utm_campaign: q.utm_campaign, coupon: q.coupon ?? getCookie(c, "coupon"),
      cookie: getCookie(c, COOKIE), issuedUrl: q.t ?? q.issued, userAgent: c.req.header("user-agent"), locale: (c.req.header("accept-language") ?? "").split(",")[0],
      tool: c.req.header("x-fishtea-tool"),
    };
  };
  /**
   * Who is asking.
   *
   * Three places, and the third is not optional: **EventSource cannot set request headers**, so the
   * browser's only way to identify itself on `/events` is the query string, which is exactly what the
   * client has always sent. This read it from the header and the cookie alone, so every SSE connection
   * without a cookie answered 400 — no notifications, no streamed parts, no reload, and a browser
   * console full of retries. The operator surface already accepts `?token=` for the same reason.
   *
   * It does mean a credential in a URL, and so in access logs and browser history. That is a real cost
   * and another argument for separating the identifier from the credential (docs/ACCESS.md); it is not
   * a new exposure, because the client was already putting it there.
   */
  const visitorOf = (c: any): { id: string | null; hadToken: boolean } => {
    const id = c.req.header("x-fishtea-visitor") ?? getCookie(c, COOKIE) ?? c.req.query("visitor") ?? null;
    return { id, hadToken: !!id };
  };
  /** Whether the browser reached us over HTTPS: directly, or through a proxy that says so (Traefik, Caddy). */
  const secure = (c: any) => c.req.header("x-forwarded-proto") === "https" || new URL(c.req.url).protocol === "https:";
  // Secure whenever the visit is HTTPS, so the visitor's id is never sent in clear; plain-HTTP development
  // keeps working because the flag follows the request rather than being always on.
  const remember = (c: any, id: string) => setCookie(c, COOKIE, id, { path: "/", httpOnly: true, sameSite: "Lax", secure: secure(c), maxAge: 60 * 60 * 24 * 365 });

  app.get("/healthz", async (c) => c.json(await engine.health()));

  /** The homepage: pour(resume). */
  app.get("/", async (c) => {
    const v = visitorOf(c);
    const res = await engine.resume({ visitorId: v.id, hadToken: v.hadToken, envelope: envelopeOf(c) });
    remember(c, res.visitor.id);
    return c.json(res);
  });

  app.post("/utter", async (c) => {
    const v = visitorOf(c);
    // CSRF: cookie'd posts must also carry the custom header (a cross-site form cannot set it)
    if (getCookie(c, COOKIE) && !c.req.header("x-fishtea-visitor") && !c.req.header("content-type")?.includes("application/json")) return c.json({ error: "missing x-fishtea-visitor" }, 403);
    if (!rateLimit(v.id ?? c.req.header("x-forwarded-for") ?? "anon")) return c.json({ error: "rate limited" }, 429);
    let body = (await c.req.json().catch(() => ({}))) as Utterance & { branchFrom?: string };
    if (!("text" in body) && !("shape" in body) && !("arrive" in body)) return c.json({ error: "utterance needs text, shape or arrive" }, 400);
    if ("shape" in body && body.shape === "__retry") body = { text: String((body.args as any)?.text ?? "") } as any;
    const res = await engine.utter(body, { visitorId: v.id, hadToken: v.hadToken, envelope: envelopeOf(c), branchFrom: body.branchFrom ?? null });
    remember(c, res.visitor.id);
    return c.json(res);
  });

  app.get("/trail", async (c) => {
    const v = visitorOf(c);
    if (!v.id) return c.json({ trail: null, turns: [] });
    return c.json((await engine.trail(v.id)) ?? { trail: null, turns: [] });
  });

  /** The asking visitor's own visits, newest first, each with its turns. */
  app.get("/sessions", async (c) => {
    const v = visitorOf(c);
    if (!v.id) return c.json({ visitor: null, sessions: [] });
    return c.json((await engine.sessions(v.id, Number(c.req.query("limit") ?? 20) || 20)) ?? { visitor: null, sessions: [] });
  });

  app.post("/trail/rewind", async (c) => {
    const v = visitorOf(c);
    if (!v.id) return c.json({ error: "no visitor" }, 400);
    const { turnId } = await c.req.json();
    return c.json(await engine.rewind(v.id, turnId));
  });

  app.get("/spec/tools", (c) => c.json({ tools: engine.toolSpecs }));

  // ── echoes: an answer followed out of the conversation (docs/ECHOES.md) ───────
  //
  // GET  /echo?echo=<name>&turn=<turnId>&to=<url>   the `redirect` transport: the link *is* the echo. 302.
  // POST /echo {echo, turn, to, visitor?}            the `beacon` transport: the link went straight to the
  //                                                  destination; this reports it. 204, or JSON to a fetch.
  //
  // Who is echoing comes from the cookie, as on every other route. A GET is a link someone may copy, so it
  // never carries the visitor in its URL; a beacon cannot set headers, so its body may name the visitor —
  // the same allowance /events makes for EventSource. A destination is followed only when the named turn
  // published it, so neither form is an open redirect.
  const echoLimit = (c: any, v: { id: string | null }) => rateLimit(`echo:${v.id ?? ipOf(c)}`, 240);
  app.get("/echo", async (c) => {
    const v = visitorOf(c);
    if (!echoLimit(c, v)) return c.text("Too many requests", 429);
    const q = c.req.query();
    const out = await engine.echo({ echo: q.echo ?? "", turnId: q.turn ?? "", to: q.to ?? "", via: "redirect" },
      { visitorId: v.id, hadToken: v.hadToken, envelope: envelopeOf(c) });
    c.header("Cache-Control", "no-store");
    if (out.status === "refused") return c.text("This link is no longer available.", 404);
    if (out.visitorId) remember(c, out.visitorId);
    return c.redirect(out.location, 302);
  });
  app.post("/echo", async (c) => {
    // sendBeacon posts text/plain (a CORS-safelisted type, so no preflight); a fetch may post JSON
    const raw = await c.req.text().catch(() => "");
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(raw || "{}"); } catch { return c.json({ error: "body must be JSON" }, 400); }
    const fromHeader = visitorOf(c);
    const v = fromHeader.id ? fromHeader : { id: typeof body.visitor === "string" ? body.visitor : null, hadToken: typeof body.visitor === "string" };
    if (!echoLimit(c, v)) return c.json({ error: "rate limited" }, 429);
    const out = await engine.echo({ echo: String(body.echo ?? ""), turnId: String(body.turn ?? ""), to: String(body.to ?? ""), via: "beacon" },
      { visitorId: v.id, hadToken: v.hadToken, envelope: envelopeOf(c) });
    if (out.status === "refused") return c.json({ status: "refused", reason: out.reason }, 404);
    if (out.visitorId) remember(c, out.visitorId);
    const { visitorId: _, ...pub } = out;
    return (c.req.header("accept") ?? "").includes("application/json") ? c.json(pub) : c.body(null, 204);
  });

  /** Notifications for this visitor, as turns, over SSE. */
  app.get("/events", async (c) => {
    const v = visitorOf(c);
    if (!v.id) return c.json({ error: "no visitor" }, 400);
    const visitorId = v.id;
    return streamSSE(c, async (stream) => {
      let alive = true;
      const unsub = engine.hub.subscribe(visitorId, (e) => { if (alive) stream.writeSSE({ event: e.type, data: JSON.stringify(e.data) }).catch(() => {}); });
      stream.onAbort(() => { alive = false; unsub(); });
      await stream.writeSSE({ event: "ping", data: JSON.stringify({ at: Date.now() }) });
      // flush anything queued while offline
      const trail = await engine.trails.latest(visitorId);
      if (trail) {
        const res = await engine.resume({ visitorId, hadToken: true });
        for (const n of res.notifications) await stream.writeSSE({ event: "notification", data: JSON.stringify(n) });
      }
      while (alive) { await stream.sleep(15000); if (alive) await stream.writeSSE({ event: "ping", data: JSON.stringify({ at: Date.now() }) }).catch(() => { alive = false; }); }
    });
  });

  // ── operator surface ─────────────────────────────────────────────────────
  //
  // Two ways in. A script — the TUI, `fishtea notify`, a test — holds FISHTEA_OPERATOR_TOKEN and sends it
  // as x-fishtea-operator. A person signs in at /admin and holds a session cookie; while their password is
  // still the one they were given, the session can only change it. A cookie is sent by the browser on its
  // own, so anything that changes state from one also needs x-fishtea-admin — a header a page on another
  // site cannot set without a preflight this core's CORS policy refuses — on top of SameSite=Strict.
  const auth = new OperatorAuth(engine.db);
  const jobs = new Jobs(engine);
  const sameToken = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
  const ipOf = (c: any) => c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? "local";

  const opAuth = new Hono();
  opAuth.post("/login", async (c) => {
    if (!rateLimit(`login:${ipOf(c)}`, opts.loginPerMinute ?? 10)) return c.json({ error: "too many attempts; wait a minute" }, 429);
    const { username, password } = await c.req.json().catch(() => ({}));
    const r = await auth.signIn(username, password);
    if (!r.ok) return c.json(r.reason === "locked" ? { error: `locked; try again in ${Math.ceil((r.retryAfter ?? 60) / 60)} minutes` } : { error: "wrong username or password" }, r.reason === "locked" ? 423 : 401);
    setCookie(c, OP_COOKIE, r.token, { path: "/", httpOnly: true, sameSite: "Strict", secure: secure(c), maxAge: SESSION_HOURS * 3600 });
    return c.json({ operator: { username: r.operator.username }, mustChange: r.operator.mustChange });
  });
  opAuth.post("/logout", async (c) => {
    await auth.signOut(getCookie(c, OP_COOKIE));
    deleteCookie(c, OP_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
  opAuth.get("/me", async (c) => {
    const who = await auth.session(getCookie(c, OP_COOKIE));
    return who ? c.json({ operator: { username: who.username }, mustChange: who.mustChange }) : c.json({ operator: null }, 401);
  });
  opAuth.post("/password", async (c) => {
    if (c.req.header("x-fishtea-admin") !== "1") return c.json({ error: "missing x-fishtea-admin" }, 403);
    const token = getCookie(c, OP_COOKIE);
    const who = await auth.session(token);
    if (!who) return c.json({ error: "sign in" }, 401);
    if (!rateLimit(`password:${who.id}`, 10)) return c.json({ error: "too many attempts; wait a minute" }, 429);
    const { current, next } = await c.req.json().catch(() => ({}));
    const r = await auth.changePassword(who, current, next, token!);
    return r.ok ? c.json({ ok: true }) : c.json({ error: r.problem }, 400);
  });
  app.route("/op/auth", opAuth);

  const op = new Hono<{ Variables: { operator: Operator | null } }>();
  op.use("*", async (c, next) => {
    const token = opts.operatorToken ?? process.env.FISHTEA_OPERATOR_TOKEN;
    const given = c.req.header("x-fishtea-operator") ?? c.req.query("token");
    if (token && given && sameToken(given, token)) { c.set("operator", null); return next(); }
    const who = await auth.session(getCookie(c, OP_COOKIE));
    // 403 throughout /op, as it always was: the surface refuses, whatever the reason
    if (!who) return c.json({ error: "sign in at /admin" }, 403);
    if (who.mustChange) return c.json({ error: "change your password first", mustChange: true }, 403);
    if (c.req.method !== "GET" && c.req.header("x-fishtea-admin") !== "1") return c.json({ error: "missing x-fishtea-admin" }, 403);
    c.set("operator", who);
    await next();
  });
  op.get("/spec", (c) => c.json({ spec: engine.spec, hashes: engine.app.hashes, path: engine.app.specPath }));
  op.get("/tools", (c) => c.json({ consumer: engine.toolSpecs, operator: engine.operatorTools }));
  op.post("/utter", async (c) => {
    const { shape, args } = await c.req.json();
    if (shape === "op.restart") { if (!opts.onRestart) return c.json({ error: "restart not wired" }, 501); await opts.onRestart(); return c.json({ kind: "answer", shape, vessel: "confirm", answer: { ok: true } }); }
    if (shape === "op.editSection") { if (!opts.onEditSection) return c.json({ error: "edit not wired" }, 501); return c.json({ kind: "answer", shape, vessel: "confirm", answer: await opts.onEditSection(args.section, args.patch) }); }
    return c.json(await engine.operate(shape, args ?? {}));
  });
  // Jobs (admin/jobs.ts): the operator shapes, started from /admin and run in the background
  op.get("/jobs", (c) => c.json({ jobs: jobs.list() }));
  op.post("/jobs/:name", async (c) => {
    const { args } = await c.req.json().catch(() => ({}));
    const r = jobs.start(c.req.param("name"), args && typeof args === "object" ? args : {}, c.get("operator")?.username ?? "token");
    return r.ok ? c.json({ run: r.run }, 202) : c.json({ error: r.error }, r.status);
  });
  op.post("/reload", async (c) => {
    if (!opts.onReload) return c.json({ error: "reload not wired" }, 501);
    const app = await opts.onReload();
    return c.json({ ok: true, version: app.spec.business.version, hashes: app.hashes });
  });
  op.post("/notify", async (c) => {
    const { visitorId, name, text, args } = await c.req.json();
    return c.json(await engine.notify(visitorId, { name, text, args, author: "operator" }));
  });
  op.get("/unmet", async (c) => c.json({ unmet: await engine.trails.unmet(c.req.query("since") ?? "7d") }));
  op.get("/actions", async (c) => c.json({
    actions: await engine.trails.actions({
      since: c.req.query("since") ?? "24h",
      limit: Number(c.req.query("limit") ?? 100),
      visitorId: c.req.query("visitor") ?? undefined,
    }),
  }));
  op.get("/visitors", async (c) => {
    const limit = Math.max(1, Math.min(200, Number(c.req.query("limit") ?? 50) || 50));
    const offset = Math.max(0, Number(c.req.query("offset") ?? 0) || 0);
    const people = c.req.query("tools") !== "include";
    const rows = await engine.db`
      SELECT v.id, v.customer_id, v.created_at, v.last_seen,
             count(t.id)::int AS trails,
             bool_and(t.envelope ? 'tool' OR coalesce(t.envelope->>'utm_campaign' = 'headless', false)) AS tool,
             (array_agg(t.envelope->>'userAgent' ORDER BY t.opened_at DESC))[1] AS user_agent,
             (SELECT count(*)::int FROM conversation.turn u JOIN conversation.trail tt ON tt.id = u.trail_id WHERE tt.visitor_id = v.id) AS turns
      FROM conversation.visitor v LEFT JOIN conversation.trail t ON t.visitor_id = v.id
      GROUP BY v.id
      HAVING ${people} = false OR NOT coalesce(bool_and(t.envelope ? 'tool' OR coalesce(t.envelope->>'utm_campaign' = 'headless', false)), false)
      ORDER BY v.last_seen DESC LIMIT ${limit} OFFSET ${offset}`;
    return c.json({ visitors: rows });
  });
  op.get("/visitors/:id", async (c) => {
    const h = await engine.sessions(c.req.param("id"), 50);
    return h ? c.json(h) : c.json({ error: "no such visitor" }, 404);
  });
  op.get("/turns/:id", async (c) => {
    const t = await engine.trails.turn(c.req.param("id"));
    return t ? c.json({ turn: t, echoes: await engine.trails.echoes([t.id]) }) : c.json({ error: "no such turn" }, 404);
  });
  /** What left the conversation: recent echoes, newest first (?since=7 days, ?echo=<name>, ?limit=200). */
  op.get("/echoes", async (c) => {
    const limit = Math.min(1000, Math.max(1, Number(c.req.query("limit") ?? 200) || 200));
    try {
      return c.json({ echoes: await engine.trails.recentEchoes({ since: c.req.query("since") ?? "7 days", kind: c.req.query("echo") || undefined, limit }) });
    } catch { return c.json({ error: "since must be an interval, e.g. 24 hours or 7 days" }, 400); }
  });

  // ── the spec, whole ──────────────────────────────────────────────────────
  //
  // The file as written, and a hash of it. A save carries the hash it started from; if the file moved on
  // since (the TUI, another tab, an editor) the save is refused with the newer text, rather than one
  // operator silently overwriting another. A save is valid JSON and a valid spec, or nothing is written;
  // the file it replaces is kept in .fishtea/spec-history/, named for when and by whom.
  const specText = () => readFileSync(engine.app.specPath, "utf8");
  const hashOf = (t: string) => createHash("sha256").update(t).digest("hex");
  const historyDir = () => join(engine.app.dir, ".fishtea", "spec-history");
  op.get("/spec/source", (c) => { const text = specText(); return c.json({ text, hash: hashOf(text), path: engine.app.specPath }); });
  op.put("/spec/source", async (c) => {
    const { text, base } = await c.req.json().catch(() => ({}));
    if (typeof text !== "string" || text.length > 5_000_000) return c.json({ error: "text: the spec, as JSON" }, 400);
    const current = specText();
    if (base !== hashOf(current)) return c.json({ error: "the spec changed since you opened it", text: current, hash: hashOf(current) }, 409);
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch (e) { return c.json({ error: `not JSON: ${(e as Error).message}` }, 400); }
    try { validateSpec(parsed, { dir: engine.app.dir }); }
    catch (e) { return c.json({ error: "the spec is not valid", problems: e instanceof SpecError ? e.problems : [(e as Error).message] }, 400); }
    const who = c.get("operator")?.username ?? "token";
    mkdirSync(historyDir(), { recursive: true });
    writeFileSync(join(historyDir(), `${new Date().toISOString().replace(/[:.]/g, "-")}-${who.replace(/[^\w-]/g, "")}.json`), current);
    for (const old of readdirSync(historyDir()).sort().slice(0, -50)) try { unlinkSync(join(historyDir(), old)); } catch { /* best effort */ }
    const tmp = `${engine.app.specPath}.saving`;
    writeFileSync(tmp, text.endsWith("\n") ? text : text + "\n");
    renameSync(tmp, engine.app.specPath);
    const entitiesBefore = engine.app.hashes.entities;
    const next = opts.onReload ? await opts.onReload() : null;
    const saved = specText();
    return c.json({ ok: true, hash: hashOf(saved), version: next?.spec.business.version, migrationNeeded: !!next && next.hashes.entities !== entitiesBefore });
  });
  op.get("/spec/history", (c) => c.json({ history: existsSync(historyDir()) ? readdirSync(historyDir()).filter((f) => f.endsWith(".json")).sort().reverse() : [] }));
  op.get("/spec/history/:name", (c) => {
    const name = c.req.param("name");
    if (!/^[\w.-]+\.json$/.test(name) || !existsSync(join(historyDir(), name))) return c.json({ error: "no such version" }, 404);
    return c.json({ name, text: readFileSync(join(historyDir(), name), "utf8") });
  });

  // ── settings ─────────────────────────────────────────────────────────────
  op.get("/settings", (c) => c.json({ settings: settingsOf(engine.app) }));
  op.patch("/settings", async (c) => {
    const { changes } = await c.req.json().catch(() => ({}));
    if (!Array.isArray(changes) || !changes.length) return c.json({ error: "changes: [{ id, value }]" }, 400);
    let r: { sections: string[] };
    try { r = applySettings(engine.app, changes); }
    catch (e) { return c.json({ error: e instanceof SpecError ? "the spec would not be valid" : (e as Error).message, problems: e instanceof SpecError ? e.problems : undefined }, 400); }
    if (opts.onReload) await opts.onReload();
    if (r.sections.includes("plugins") && opts.onPluginsChanged) await opts.onPluginsChanged();
    return c.json({ ok: true, sections: r.sections, settings: settingsOf(engine.app) });
  });

  // ── data ─────────────────────────────────────────────────────────────────
  //
  // The rows of the entities the spec opens to operators (entities.<name>.admin): read, edited by field,
  // added and removed. What may be touched is the spec's to say (admin/data.ts), not this route's.
  const data = new Data(engine.db, () => engine.app);
  const dataError = (c: any, e: unknown) => e instanceof DataError ? c.json({ error: e.message }, 400) : Promise.reject(e);
  op.get("/data", async (c) => c.json({ entities: await data.list() }));
  op.get("/data/:entity", async (c) => {
    try { return c.json({ rows: await data.rows(c.req.param("entity"), { limit: Number(c.req.query("limit") ?? 200) || 200, offset: Number(c.req.query("offset") ?? 0) || 0 }) }); }
    catch (e) { return dataError(c, e); }
  });
  op.post("/data/:entity", async (c) => {
    try { return c.json({ row: await data.create(c.req.param("entity"), (await c.req.json().catch(() => ({}))).row ?? {}) }); }
    catch (e) { return dataError(c, e); }
  });
  op.patch("/data/:entity/:id", async (c) => {
    try {
      const row = await data.update(c.req.param("entity"), c.req.param("id"), (await c.req.json().catch(() => ({}))).patch ?? {});
      return row ? c.json({ row }) : c.json({ error: "no such row" }, 404);
    } catch (e) { return dataError(c, e); }
  });
  op.delete("/data/:entity/:id", async (c) => {
    try { return c.json(await data.remove(c.req.param("entity"), c.req.param("id"))); }
    catch (e) { return dataError(c, e); }
  });
  app.route("/op", op);

  return app;
}
