/**
 * `fishtea serve`: the core process. Migrates if the entities section drifted (additive only), seeds when
 * the business schema is empty, watches spec.json and hot-reloads non-entity sections, exposes /op/*.
 */
import { watch } from "node:fs";
import pc from "picocolors";
import { loadApp, SpecError, type App, deriveTables, frameworkHome } from "@fishtea/spec";
import { migrate, seed, entitiesDrift, ensureConversationSchema, createServer, OperatorAuth, DEFAULT_OPERATOR, DEFAULT_PASSWORD } from "@fishtea/core";
import { generateUiAssets } from "./plugin.ts";
import { buildEngine } from "./index.ts";
import { applySectionPatch } from "./edit.ts";
import { bindHost, bindPort, checkDatabase, classifierUrl, corsOrigins, databaseUrl, portWasChosen, publicUrl, reachableUrls, redact, resolvePort, selfHosts, type Flags } from "./env.ts";

export async function serve(app: App, flags: Flags, dir: string) {
  const host = bindHost(flags);
  const wanted = bindPort(flags);
  const log = (s: string) => console.log(pc.dim(new Date().toISOString().slice(11, 19)) + " " + s);

  // Bind somewhere that works. A developer usually has three things on 3000 and does not care which one
  // this is; someone who passed --port or PORT does care, and gets an error instead of a surprise.
  const { port, moved } = await resolvePort(wanted, host, { chosen: portWasChosen(flags) });
  if (moved) log(pc.yellow(`port ${wanted} was busy — using ${port} (pass --port to pin one)`));
  await checkDatabase(databaseUrl(flags), { appDir: dir });
  const { engine, db } = await buildEngine(app, flags, { log });

  // The framework's own tables move with the framework, independently of anything in the spec, so this
  // runs every start rather than only when the business entities drifted.
  await ensureConversationSchema(db);
  // The first operator, so /admin can be signed into without a setup step — on a password that has to
  // be changed at the first sign-in.
  const operators = new OperatorAuth(db);
  if (await operators.ensureDefault()) log(`created the first operator, ${pc.bold(DEFAULT_OPERATOR)}, for /admin`);

  const drift = await entitiesDrift(db, app);
  if (drift.drifted) {
    const report = await migrate(db, app, { log });
    log(`migrated entities (${report.created.length} tables created, ${report.added.length} columns added)`);
    if (report.refused.length) log(pc.yellow(`refused destructive changes: ${report.refused.join(", ")} — run: fishtea migrate --allow-destructive`));
  }
  const first = deriveTables(app.spec)[0];
  if (first) {
    const [{ n }] = await db.unsafe(`SELECT count(*)::int AS n FROM business."${first.name}"`);
    if (n === 0 && flags["no-seed"] !== true) { const counts = await seed(db, app, { log }); log(`seeded: ${JSON.stringify(counts)}`); }
  }

  let current = app;
  const reload = async (): Promise<App> => {
    const next = loadApp(dir);
    const entitiesChanged = next.hashes.entities !== current.hashes.entities;
    if (entitiesChanged) {
      const report = await migrate(db, next, { log });
      log(`entities changed → migrated (${report.created.length} created, ${report.added.length} added${report.refused.length ? `, refused ${report.refused.join(",")}` : ""})`);
    }
    await engine.reload(next);
    current = next;
    log(pc.green(`reloaded spec v${next.spec.business.version} (${Object.entries(next.hashes).filter(([k, v]) => v !== app.hashes[k]).map(([k]) => k).join(",") || "no section changed"})`));
    return next;
  };

  // hot reload on spec edits (the TUI writes the file; the volume mount makes it visible in Compose)
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    watch(app.specPath, () => { clearTimeout(timer); timer = setTimeout(() => reload().catch((e) => log(pc.red(e instanceof SpecError ? e.message : `reload failed: ${e.message}`))), 200); });
  } catch (e) { log(pc.yellow(`spec watch unavailable: ${(e as Error).message}`)); }

  const cors = { origins: corsOrigins(flags), hosts: selfHosts(flags) };
  const server = createServer({
    engine,
    cors,
    operatorToken: process.env.FISHTEA_OPERATOR_TOKEN,
    onReload: reload,
    onRestart: async () => { log("restart requested by operator"); setTimeout(() => process.exit(0), 50); },
    // a design system's knob moved: the ui bundle's stylesheet is derived from it
    onPluginsChanged: async () => {
      const r = generateUiAssets(current.dir, frameworkHome());
      for (const w of r.warnings) log(pc.yellow(`ui assets: ${w}`));
    },
    onEditSection: async (section, patch) => {
      const r = applySectionPatch(current.specPath, section, patch);
      const next = await reload();
      return { ok: true, version: r.version, migrationNeeded: section === "entities" && next.hashes.entities !== current.hashes.entities };
    },
  });
  Bun.serve({ hostname: host, port, fetch: server.fetch, idleTimeout: 255 });
  // Everything printed from here has to describe the port actually bound, not the one asked for.
  const publicFlags: Flags = moved ? { ...flags, port: String(port) } : flags;
  const urls = reachableUrls(host, port);
  log(pc.green(`${app.spec.business.name} core listening on ${host}:${port}`));
  for (const u of urls) log(`  ${pc.cyan(u)}`);
  log(pc.dim(`  classifier ${engine.classifier.name} at ${classifierUrl(flags)}${engine.strict ? " · strict" : ""}`));
  log(pc.dim(`  database   ${redact(databaseUrl(flags))}`));
  log(pc.dim(`  spec       ${app.specPath}`));
  if (host === "0.0.0.0") log(pc.dim(`  reachable from other machines; set FISHTEA_HOST=127.0.0.1 to keep it local`));
  log(pc.dim(`  the UI needs VITE_CORE_URL=${publicUrl(publicFlags)}`));
  // Say so, every start, while a door is still locked with a key everybody has.
  if (await operators.defaultStillSet()) log(pc.yellow(`  /admin: ${DEFAULT_OPERATOR} is still on the password it was given (${process.env.FISHTEA_ADMIN_PASSWORD ? "FISHTEA_ADMIN_PASSWORD" : DEFAULT_PASSWORD}) — sign in and change it`));
  if ((process.env.FISHTEA_OPERATOR_TOKEN ?? "") === "change-me") log(pc.yellow(`  FISHTEA_OPERATOR_TOKEN is "change-me": anyone who knows that can use /op — set a random one in .env`));
  log(pc.dim(`  browser origins ${cors.origins === "*" ? pc.yellow("any (FISHTEA_CORS_ORIGINS=*)") : cors.origins?.length ? cors.origins.join(", ") : `any port on ${cors.hosts.join(", ")}`}`));
  await new Promise(() => {});
}
