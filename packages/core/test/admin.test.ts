/**
 * /admin's side of the core: operators signing in, the first password that must be changed, lockout, the
 * header a cookie'd change needs, and the spec and settings an operator may edit — against a real
 * Postgres, and a scratch copy of an application so a save never rewrites the framework's own template.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadApp } from "@fishtea/spec";
import { connect, migrate, seed, reset, Engine, LexicalClassifier, createServer, DEFAULT_OPERATOR, DEFAULT_PASSWORD } from "../src/index.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const URL = process.env.FISHTEA_TEST_DATABASE_URL ?? "postgres://fishtea:fishtea@localhost:5434/fishtea";
const db = connect(URL);
const dir = mkdtempSync(join(tmpdir(), "fishtea-admin-"));
cpSync(join(ROOT, "templates/ecommerce"), dir, { recursive: true });
// one entity opened to operators, for /admin → Data
const scratch = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8"));
scratch.entities.customer.admin = { columns: ["email", "name"], order: "createdAt" };
// a report: the period reaches the query, and a broken panel stands alone
writeFileSync(join(dir, "calls/report_period.sql"), "-- $1 from, $2 to\nSELECT $1::date::text AS from_day, $2::date::text AS to_day, (SELECT count(*)::int FROM conversation.turn) AS turns;\n");
writeFileSync(join(dir, "calls/report_broken.sql"), "SELECT nosuch FROM conversation.turn;\n");
scratch.calls["report.period"] = { kind: "query", in: { from: "string", to: "string" }, out: "json[]", impl: { sql: "report_period.sql" } };
scratch.calls["report.broken"] = { kind: "query", in: {}, out: "json[]", impl: { sql: "report_broken.sql" } };
// a job on a schedule (the server here never starts the clock; the test ticks it by hand)
scratch.operator.shapes["op.unmetReport"].schedule = { afterDeploy: true, daily: ["05:00"], args: { since: "1d" } };
scratch.operator.reports = {
  overview: { label: "Overview", doc: "test", panels: [
    { title: "Totals", call: "report.period", view: "tiles", columns: ["turns"] },
    { title: "Broken", call: "report.broken", view: "table" },
  ] },
};
writeFileSync(join(dir, "spec.json"), JSON.stringify(scratch, null, 2) + "\n");
let app = loadApp(dir);
let engine: Engine;
let server: ReturnType<typeof Bun.serve>;
let base = "";
const OP = "admin-test-token";

beforeAll(async () => {
  await reset(db); await migrate(db, app); await seed(db, app);
  await db`DELETE FROM fishtea.operator`;
  engine = new Engine({ app, db, classifier: new LexicalClassifier() });
  const { OperatorAuth } = await import("../src/index.ts");
  await new OperatorAuth(db).ensureDefault();
  const hono = createServer({ engine, operatorToken: OP, loginPerMinute: 1000, onReload: async () => { app = loadApp(dir); await engine.reload(app); return app; } });
  server = Bun.serve({ port: 0, fetch: hono.fetch });
  base = `http://localhost:${server.port}`;
});
afterAll(async () => { server.stop(true); await db.end(); rmSync(dir, { recursive: true, force: true }); });

const json = { "content-type": "application/json" };
const admin = { ...json, "x-fishtea-admin": "1" };
const sessionOf = (r: Response) => r.headers.get("set-cookie")?.match(/fishtea_operator=([^;]+)/)?.[1] ?? "";
const signIn = (username: string, password: string) => fetch(`${base}/op/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ username, password }) });
const as = (session: string, extra: Record<string, string> = {}) => ({ ...extra, cookie: `fishtea_operator=${session}` });
const NEW_PASSWORD = "correct horse battery staple";

describe("signing in", () => {
  test("sign-in attempts from one address are limited", async () => {
    const strict = Bun.serve({ port: 0, fetch: createServer({ engine, operatorToken: OP }).fetch });
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await fetch(`http://localhost:${strict.port}/op/auth/login`, { method: "POST", headers: json, body: JSON.stringify({ username: "nobody", password: "x" }) })).status);
    strict.stop(true);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });

  test("the first operator signs in on the given password, and can do nothing but change it", async () => {
    const r = await signIn(DEFAULT_OPERATOR, DEFAULT_PASSWORD);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ operator: { username: "admin" }, mustChange: true });
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    const s = sessionOf(r);

    const blocked = await fetch(`${base}/op/visitors`, { headers: as(s) });
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as any).mustChange).toBe(true);

    // a weak one, the given one, and one without the header are all refused
    for (const [body, headers, status] of [
      [{ current: DEFAULT_PASSWORD, next: "short" }, admin, 400],
      [{ current: DEFAULT_PASSWORD, next: DEFAULT_PASSWORD }, admin, 400],
      [{ current: DEFAULT_PASSWORD, next: "an admin password here" }, admin, 400],
      [{ current: "not it at all, no", next: NEW_PASSWORD }, admin, 400],
      [{ current: DEFAULT_PASSWORD, next: NEW_PASSWORD }, json, 403],
    ] as const) {
      expect((await fetch(`${base}/op/auth/password`, { method: "POST", headers: as(s, headers), body: JSON.stringify(body) })).status).toBe(status);
    }

    // a second session, opened before the change, ends when the password changes
    const other = sessionOf(await signIn(DEFAULT_OPERATOR, DEFAULT_PASSWORD));
    const changed = await fetch(`${base}/op/auth/password`, { method: "POST", headers: as(s, admin), body: JSON.stringify({ current: DEFAULT_PASSWORD, next: NEW_PASSWORD }) });
    expect(changed.status).toBe(200);
    expect((await fetch(`${base}/op/auth/me`, { headers: as(other) })).status).toBe(401);

    const me = (await (await fetch(`${base}/op/auth/me`, { headers: as(s) })).json()) as any;
    expect(me).toEqual({ operator: { username: "admin" }, mustChange: false });
    expect((await fetch(`${base}/op/visitors`, { headers: as(s) })).status).toBe(200);
    // the old password is gone
    expect((await signIn(DEFAULT_OPERATOR, DEFAULT_PASSWORD)).status).toBe(401);
  });

  test("a wrong username and a wrong password answer alike; five wrong passwords lock the account", async () => {
    await db`UPDATE fishtea.operator SET locked_until = NULL, failed = 0`; // the last test's wrong attempt counts
    const nobody = await signIn("nobody", "whatever it is");
    expect(nobody.status).toBe(401);
    expect(await nobody.json()).toEqual({ error: "wrong username or password" });
    for (let i = 0; i < 4; i++) expect((await signIn("admin", `wrong ${i} password`)).status).toBe(401);
    expect((await signIn("admin", "wrong again, fifth")).status).toBe(423);
    // locked: even the right password waits
    expect((await signIn("admin", NEW_PASSWORD)).status).toBe(423);
    await db`UPDATE fishtea.operator SET locked_until = NULL, failed = 0`;
    expect((await signIn("admin", NEW_PASSWORD)).status).toBe(200);
  });

  test("a change from a session needs x-fishtea-admin; a read does not; the script token still works; signing out ends it", async () => {
    const s = sessionOf(await signIn("admin", NEW_PASSWORD));
    expect((await fetch(`${base}/op/settings`, { headers: as(s) })).status).toBe(200);
    expect((await fetch(`${base}/op/settings`, { method: "PATCH", headers: as(s, json), body: JSON.stringify({ changes: [] }) })).status).toBe(403);
    expect((await fetch(`${base}/op/visitors`, { headers: { "x-fishtea-operator": OP } })).status).toBe(200);
    expect((await fetch(`${base}/op/visitors`)).status).toBe(403);
    expect((await fetch(`${base}/op/visitors`, { headers: { "x-fishtea-operator": "wrong" } })).status).toBe(403);
    await fetch(`${base}/op/auth/logout`, { method: "POST", headers: as(s) });
    expect((await fetch(`${base}/op/visitors`, { headers: as(s) })).status).toBe(403);
  });
});

describe("editing", () => {
  const session = async () => sessionOf(await signIn("admin", NEW_PASSWORD));

  test("the spec: not JSON, not valid and not current are refused; a good save is kept, with the old one in history", async () => {
    const s = await session();
    const src = (await (await fetch(`${base}/op/spec/source`, { headers: as(s) })).json()) as any;
    const put = (body: unknown) => fetch(`${base}/op/spec/source`, { method: "PUT", headers: as(s, admin), body: JSON.stringify(body) });

    expect((await put({ text: "{ nope", base: src.hash })).status).toBe(400);
    const broken = JSON.parse(src.text); broken.business.id = undefined;
    const invalid = await put({ text: JSON.stringify(broken), base: src.hash });
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as any).problems.length).toBeGreaterThan(0);
    expect((await put({ text: src.text, base: "not-the-hash" })).status).toBe(409);

    const next = JSON.parse(src.text); next.business.doc = "Edited from /admin.";
    const ok = await put({ text: JSON.stringify(next, null, 2), base: src.hash });
    expect(ok.status).toBe(200);
    expect(JSON.parse(readFileSync(join(dir, "spec.json"), "utf8")).business.doc).toBe("Edited from /admin.");
    expect(engine.app.spec.business.doc).toBe("Edited from /admin.");
    const history = readdirSync(join(dir, ".fishtea/spec-history"));
    expect(history.length).toBe(1);
    expect(history[0]).toEndWith("-admin.json");
    expect(readFileSync(join(dir, ".fishtea/spec-history", history[0]), "utf8")).toBe(src.text);
  });

  test("settings: only what is offered, coerced to its type, written through a validated, versioned patch", async () => {
    const s = await session();
    const { settings } = (await (await fetch(`${base}/op/settings`, { headers: as(s) })).json()) as any;
    const number = settings.find((x: any) => x.section === "rules" && x.type === "number");
    expect(number).toBeTruthy();
    expect(settings.some((x: any) => x.id.startsWith("rules.present."))).toBe(false);
    // what guards visitors is not a quick setting: it is changed in the spec, deliberately
    expect(settings.some((x: any) => x.id.startsWith("rules.writes."))).toBe(false);
    const patch = (changes: unknown) => fetch(`${base}/op/settings`, { method: "PATCH", headers: as(s, admin), body: JSON.stringify({ changes }) });

    expect((await patch([{ id: "rules.nosuch", value: 1 }])).status).toBe(400);
    expect((await patch([{ id: number.id, value: "not a number" }])).status).toBe(400);
    const before = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8")).rules.version;
    const r = await patch([{ id: number.id, value: Number(number.value) + 1 }]);
    expect(r.status).toBe(200);
    const after = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8"));
    expect(after.rules.version).not.toBe(before);
    expect(number.path.split(".").reduce((o: any, k: string) => o[k], after.rules)).toBe(Number(number.value) + 1);
  });
});

describe("data", () => {
  const session = async () => sessionOf(await signIn("admin", NEW_PASSWORD));

  test("only the entities the spec opens, each value checked against its type, never the id", async () => {
    const s = await session();
    const get = async (path: string) => (await fetch(`${base}/op/data${path}`, { headers: as(s) }));
    const send = (method: string, path: string, body?: unknown) => fetch(`${base}/op/data${path}`, { method, headers: as(s, admin), body: body === undefined ? undefined : JSON.stringify(body) });

    const { entities } = (await (await get("")).json()) as any;
    expect(entities.map((e: any) => e.name)).toEqual(["customer"]);
    expect(entities[0].columns).toEqual(["email", "name"]);
    expect((await get("/product")).status).toBe(400);

    const created = (await (await send("POST", "/customer", { row: { email: "ops@example.com", name: "Ops", source: "admin" } })).json()) as any;
    const id = created.row.id;
    expect(created.row.$seeded).toEqual([]);
    expect((await send("PATCH", `/customer/${id}`, { patch: { email: "not an email" } })).status).toBe(400);
    expect((await send("PATCH", `/customer/${id}`, { patch: { nosuch: 1 } })).status).toBe(400);
    const edited = (await (await send("PATCH", `/customer/${id}`, { patch: { name: "Operator", id: "x_other" } })).json()) as any;
    expect(edited.row.name).toBe("Operator");
    expect(edited.row.id).toBe(id);
    // a cookie'd change without the header is refused, as everywhere on /op
    expect((await fetch(`${base}/op/data/customer/${id}`, { method: "DELETE", headers: as(s) })).status).toBe(403);
    expect(((await (await send("DELETE", `/customer/${id}`)).json()) as any).ok).toBe(true);
    expect(((await (await get("/customer")).json()) as any).rows.some((r: any) => r.id === id)).toBe(false);
  });
});

describe("jobs", () => {
  const session = async () => sessionOf(await signIn("admin", NEW_PASSWORD));
  const until = async (s: string, name: string) => {
    for (let i = 0; i < 100; i++) {
      const { jobs } = (await (await fetch(`${base}/op/jobs`, { headers: as(s) })).json()) as any;
      const j = jobs.find((x: any) => x.name === name);
      if (j.last && j.last.status !== "running") return j.last;
      await Bun.sleep(20);
    }
    throw new Error(`${name} never finished`);
  };

  test("the operator shapes are listed with their inputs, without the console's own", async () => {
    const s = await session();
    const { jobs } = (await (await fetch(`${base}/op/jobs`, { headers: as(s) })).json()) as any;
    expect(jobs.map((j: any) => j.name)).toEqual(["op.unmetReport", "op.syncInventory"]);
    const sync = jobs.find((j: any) => j.name === "op.syncInventory");
    expect(sync.effect).toBe("write");
    expect(sync.fields.find((f: any) => f.name === "limit")).toMatchObject({ type: "int", default: 50 });
    expect(sync.last).toBeNull();
  });

  test("a run starts at once, ends in the background, and keeps what it answered", async () => {
    const s = await session();
    const r = await fetch(`${base}/op/jobs/op.unmetReport`, { method: "POST", headers: as(s, admin), body: JSON.stringify({ args: { since: "1d" } }) });
    expect(r.status).toBe(202);
    expect(((await r.json()) as any).run).toMatchObject({ job: "op.unmetReport", status: "running", by: "admin", args: { since: "1d" } });
    const last = await until(s, "op.unmetReport");
    expect(last.status).toBe("done");
    expect(Array.isArray(last.answer)).toBe(true);
    expect(last.ms).toBeGreaterThanOrEqual(0);
  });

  test("inputs the shape refuses are a failed run, saying why", async () => {
    const s = await session();
    expect((await fetch(`${base}/op/jobs/op.syncInventory`, { method: "POST", headers: as(s, admin), body: JSON.stringify({ args: { limit: "lots" } }) })).status).toBe(202);
    const last = await until(s, "op.syncInventory");
    expect(last.status).toBe("failed");
    expect(last.error).toContain("limit");
  });

  test("unknown jobs, the console's shapes, a second press while running, and no header are refused", async () => {
    const s = await session();
    const post = (name: string, headers = as(s, admin)) => fetch(`${base}/op/jobs/${name}`, { method: "POST", headers, body: "{}" });
    expect((await post("op.nosuch")).status).toBe(404);
    expect((await post("op.restart")).status).toBe(404);
    expect((await post("op.unmetReport", as(s, json))).status).toBe(403);
    // one running row per job, whichever core holds it
    await db`INSERT INTO fishtea.job_run (id, job, by, status) VALUES ('job_held', 'op.unmetReport', 'elsewhere', 'running')`;
    expect((await post("op.unmetReport")).status).toBe(409);
    await db`DELETE FROM fishtea.job_run WHERE id = 'job_held'`;
  });

  test("runs outlive the Jobs that started them: a new one (a restart) still shows the last good answer", async () => {
    const { Jobs } = await import("../src/index.ts");
    const r = await new Jobs(engine).start("op.unmetReport", { since: "7d" }, "test");
    if (!r.ok) throw new Error(r.error);
    await r.done;
    const after = (await new Jobs(engine).list()).find((j) => j.name === "op.unmetReport")!;
    expect(after.lastGood).toMatchObject({ id: r.run.id, status: "done", by: "test" });
  });

  test("the schedule: once after a deploy, again for a new release, and at a daily time it missed", async () => {
    const { Jobs } = await import("../src/index.ts");
    {
      await db`DELETE FROM fishtea.job_run`;
      const j = new Jobs(engine);
      const runs = async () => (await db`SELECT trigger, status, args FROM fishtea.job_run WHERE job = 'op.unmetReport' ORDER BY started_at`).map((r: any) => r.trigger);
      const settle = async () => { for (let i = 0; i < 100 && (await db`SELECT 1 FROM fishtea.job_run WHERE status = 'running'`).length; i++) await Bun.sleep(20); };
      // 04:00: no good run for this release yet, and 05:00 has not come
      await j.tick(new Date(Date.UTC(2030, 0, 1, 4, 0))); await settle();
      expect(await runs()).toEqual(["deploy"]);
      await db`UPDATE fishtea.job_run SET started_at = '2030-01-01T04:00:00Z'`;
      // a restart, same release: nothing
      await new Jobs(engine).tick(new Date(Date.UTC(2030, 0, 1, 4, 30))); await settle();
      expect(await runs()).toEqual(["deploy"]);
      // 05:01 has passed 05:00 with no run since: the daily one; then not again that day
      await j.tick(new Date(Date.UTC(2030, 0, 1, 5, 1))); await settle();
      await db`UPDATE fishtea.job_run SET started_at = '2030-01-01T05:01:00Z' WHERE trigger = 'schedule'`;
      await j.tick(new Date(Date.UTC(2030, 0, 1, 9, 0))); await settle();
      expect(await runs()).toEqual(["deploy", "schedule"]);
      const [{ args }] = await db`SELECT args FROM fishtea.job_run WHERE trigger = 'schedule'`;
      expect(args).toEqual({ since: "1d" });
      // a new release (another framework, other calls…): after a deploy again
      await db`UPDATE fishtea.job_run SET release = 'an-older-one'`;
      await j.tick(new Date(Date.UTC(2030, 0, 1, 9, 30))); await settle();
      expect((await runs()).filter((t) => t === "deploy").length).toBe(2);
      expect((await j.list()).find((x) => x.name === "op.unmetReport")!.next).not.toBeNull();
    }
  });

  test("next and last daily times are in UTC and wrap past midnight", async () => {
    const { nextDaily, lastDaily } = await import("../src/index.ts");
    const at = new Date(Date.UTC(2030, 0, 1, 23, 30));
    expect(nextDaily(["05:00", "17:00"], at)!.toISOString()).toBe("2030-01-02T05:00:00.000Z");
    expect(lastDaily(["05:00", "17:00"], at)!.toISOString()).toBe("2030-01-01T17:00:00.000Z");
    expect(lastDaily(["23:45"], at)!.toISOString()).toBe("2029-12-31T23:45:00.000Z");
  });
});

describe("a lost password", () => {
  test("reset puts the operator back on the first password, to be changed, and ends their sessions", async () => {
    const { OperatorAuth } = await import("../src/index.ts");
    const s = sessionOf(await signIn("admin", NEW_PASSWORD));
    expect((await fetch(`${base}/op/visitors`, { headers: as(s) })).status).toBe(200);
    expect(await new OperatorAuth(db).reset()).toBe("reset");
    expect((await fetch(`${base}/op/visitors`, { headers: as(s) })).status).toBe(403);
    expect((await signIn("admin", NEW_PASSWORD)).status).toBe(401);
    const back = await signIn("admin", DEFAULT_PASSWORD);
    expect(await back.json()).toEqual({ operator: { username: "admin" }, mustChange: true });
    expect(await new OperatorAuth(db).reset("second")).toBe("created");
  });
});

describe("reports", () => {
  // "a lost password" has ended every session by now; the operator token reads the same

  test("the declared reports are listed", async () => {
    const r = await fetch(`${base}/op/reports`, { headers: { "x-fishtea-operator": OP } });
    expect(((await r.json()) as any).reports).toEqual([{ name: "overview", label: "Overview", doc: "test", panels: 2 }]);
  });

  test("each panel is asked with the period, and one that fails says so without taking the others down", async () => {
    const r = await fetch(`${base}/op/reports/overview?from=2026-10-01&to=2026-10-07`, { headers: { "x-fishtea-operator": OP } });
    expect(r.status).toBe(200);
    const rep = (await r.json()) as any;
    expect(rep).toMatchObject({ name: "overview", from: "2026-10-01", to: "2026-10-07" });
    expect(rep.panels[0].rows[0]).toMatchObject({ fromDay: "2026-10-01", toDay: "2026-10-07" });
    expect(typeof rep.panels[0].rows[0].turns).toBe("number");
    expect(rep.panels[1].rows).toEqual([]);
    expect(rep.panels[1].error).toContain("nosuch");
  });

  test("no period is the last 30 days; a period the wrong way round is turned; an unknown report is a 404", async () => {
    const rep = (await (await fetch(`${base}/op/reports/overview`, { headers: { "x-fishtea-operator": OP } })).json()) as any;
    expect((Date.parse(rep.to) - Date.parse(rep.from)) / 86400e3).toBe(29);
    const back = (await (await fetch(`${base}/op/reports/overview?from=2026-10-07&to=2026-10-01`, { headers: { "x-fishtea-operator": OP } })).json()) as any;
    expect([back.from, back.to]).toEqual(["2026-10-01", "2026-10-07"]);
    expect((await fetch(`${base}/op/reports/nosuch`, { headers: { "x-fishtea-operator": OP } })).status).toBe(404);
    expect((await fetch(`${base}/op/reports/overview`)).status).toBe(403);
  });

  test("a panel whose call is not a query is refused by the spec, and by the engine whatever the spec says", async () => {
    const { validateSpec } = await import("@fishtea/spec");
    const bad = JSON.parse(JSON.stringify(app.spec));
    bad.operator.reports.overview.panels.push({ title: "Writes", call: "customer.upsert", view: "table" }, { title: "No axis", call: "report.period", view: "line" });
    let problems: string[] = [];
    try { validateSpec(bad, { dir }); } catch (e) { problems = (e as any).problems ?? [String(e)]; }
    expect(problems.some((p: string) => p.includes("customer.upsert") && p.includes("must be a query"))).toBe(true);
    expect(problems.some((p: string) => p.includes("panels[3]") && p.includes('"x" and "y"'))).toBe(true);
    await expect(engine.query("customer.upsert", {})).rejects.toThrow("not a read-only query");
  });
});
