/**
 * Hono transport (BLUEPRINT D7, §13): /, /utter, /events, /trail/*, /healthz, and the operator
 * surface under /op/* gated by FISHTEA_OPERATOR_TOKEN. The intelligence is the engine; this is a thin skin.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import type { Engine, Utterance } from "./engine.ts";
import type { App } from "@fishtea/spec";

const COOKIE = "fishtea_visitor";

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
const buckets = new Map<string, Bucket>();
function rateLimit(key: string, perMinute = 120): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60000) * perMinute);
  b.at = now;
  if (b.tokens < 1) { buckets.set(key, b); return false; }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
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
  cors?: CorsPolicy;
}

export function createServer(opts: ServerOptions) {
  const { engine } = opts;
  const app = new Hono();
  app.use("*", cors({
    origin: allowOrigin(opts.cors),
    credentials: true,
    allowHeaders: ["content-type", "x-fishtea-visitor", "x-fishtea-operator", "x-fishtea-tool"],
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
  const remember = (c: any, id: string) => setCookie(c, COOKIE, id, { path: "/", httpOnly: true, sameSite: "Lax", maxAge: 60 * 60 * 24 * 365 });

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
  const op = new Hono();
  op.use("*", async (c, next) => {
    const token = opts.operatorToken ?? process.env.FISHTEA_OPERATOR_TOKEN;
    if (!token) return c.json({ error: "operator surface disabled: set FISHTEA_OPERATOR_TOKEN" }, 403);
    const given = c.req.header("x-fishtea-operator") ?? c.req.query("token");
    if (given !== token) return c.json({ error: "forbidden" }, 403);
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
    const rows = await engine.db`SELECT v.id, v.customer_id, v.last_seen, (SELECT count(*) FROM conversation.trail t WHERE t.visitor_id = v.id) AS trails FROM conversation.visitor v ORDER BY v.last_seen DESC LIMIT 50`;
    return c.json({ visitors: rows });
  });
  app.route("/op", op);

  return app;
}
