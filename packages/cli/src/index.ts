#!/usr/bin/env bun
/**
 * `fishtea` — the framework CLI. Every command takes --app <dir> (default: FISHTEA_APP, else cwd if it has a
 * spec.json). Generated applications wrap these commands in their package.json scripts.
 *
 *   fishtea new <id> [--template commerce|program] [--dir <path>] [--name "..."]
 *   fishtea validate | derive [--ddl|--tools|--forms] | migrate [--allow-destructive] | seed
 *   fishtea serve [--host 0.0.0.0] [--port 3000] [--intent lexical|needle] [--strict]
 *   fishtea headless [--script file.json] [--intent ...] [--pretty]
 *   fishtea tui | up | down | bench | notify <visitorId> "<text>"
 */
import { resolve, join, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import pc from "picocolors";
import { loadApp, deriveDDL, deriveTools, deriveForm, shapes, SpecError, type App } from "@fishtea/spec";
import { connect, migrate, seed, entitiesDrift, Engine, runScript, LexicalClassifier, NeedleClient, createServer, type Classifier } from "@fishtea/core";
import { scaffold, listTemplates } from "./new.ts";
import { DEFAULT_APP_ID, SetupError, bindHost, bindPort, checkDatabase, classifierUrl, databaseUrl, publicHost, publicUrl, redact } from "./env.ts";

export const FISHTEA_HOME = resolve(dirname(new URL(import.meta.url).pathname), "../../..");

export function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else positional.push(a);
  }
  return { flags, positional };
}

export function resolveAppDir(flags: Record<string, string | boolean>): string {
  const given = typeof flags.app === "string" ? flags.app : process.env.FISHTEA_APP;
  if (given) return resolve(given);
  if (existsSync(resolve("spec.json"))) return resolve(".");
  throw new Error("no application: pass --app <dir> or set FISHTEA_APP (a directory containing spec.json)");
}

export function loadOrDie(dir: string): App {
  try { return loadApp(dir); }
  catch (e) {
    if (e instanceof SpecError) { console.error(pc.red("✗ spec invalid")); for (const p of e.problems) console.error("  - " + p); process.exit(2); }
    throw e;
  }
}

export function classifierFor(flags: Record<string, string | boolean>): Classifier {
  const intent = String(flags.intent ?? process.env.FISHTEA_INTENT ?? (process.env.CLASSIFIER_URL || flags.classifier ? "needle" : "lexical"));
  return intent === "needle" ? new NeedleClient(classifierUrl(flags)) : new LexicalClassifier();
}

export async function buildEngine(app: App, flags: Record<string, string | boolean>, opts: { log?: (s: string) => void } = {}) {
  const db = connect(databaseUrl(flags));
  const classifier = classifierFor(flags);
  const engine = new Engine({ app, db, classifier, strict: flags.strict === true || process.env.FISHTEA_STRICT === "1", log: opts.log });
  if (classifier instanceof LexicalClassifier) await engine.primeLexical();
  else if (classifier.reload) {
    const h = await classifier.health();
    if (h.ok) { const t0 = performance.now(); await classifier.reload(engine.toolSpecs, engine.personaSubsets).catch((e) => console.error(pc.yellow(`classifier reload failed: ${e.message}`))); if (process.env.FISHTEA_DEBUG) console.error(pc.dim(`pool reloaded + warmed ${engine.personaSubsets.length} persona subsets in ${Math.round(performance.now() - t0)} ms`)); }
    else {
      console.error(pc.yellow(`⚠ no classifier pool at ${classifierUrl(flags)} — text utterances will pour "ask" until one answers`));
      console.error(pc.dim(`  start one: cd ${FISHTEA_HOME}/packages/classifier && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python needle_service.py`));
      console.error(pc.dim(`  or point at another machine: CLASSIFIER_URL=http://host:8081 (or --classifier)`));
      console.error(pc.dim(`  or develop without one: FISHTEA_INTENT=lexical (a development harness, never production)`));
    }
  }
  return { engine, db };
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const cmd = positional[0] ?? "help";
  switch (cmd) {
    case "templates": {
      for (const t of listTemplates(FISHTEA_HOME)) console.log(`${pc.bold(t.name.padEnd(14))} ${t.doc}\n${" ".repeat(15)}${pc.dim(`${t.onboard.questions.length} onboarding questions`)}`);
      return;
    }
    case "new": {
      const id = positional[1] ?? DEFAULT_APP_ID;
      const template = String(flags.template ?? "");
      if (!template) throw new Error(`pick a template: ${listTemplates(FISHTEA_HOME).map((t) => t.name).join(", ")} (or run: fishtea tui → Onboard)`);
      let answers: Record<string, unknown> | undefined = typeof flags.answers === "string" ? JSON.parse(readFileSync(resolve(flags.answers), "utf8")) : undefined;
      if (flags.interactive === true) {
        const { interview } = await import("@fishtea/tui");
        const subject = typeof flags.name === "string" ? flags.name : id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
        answers = await interview(FISHTEA_HOME, template, { name: subject });
      }
      const out = await scaffold({ id, template, dir: typeof flags.dir === "string" ? flags.dir : undefined, name: typeof flags.name === "string" ? flags.name : undefined, doc: typeof flags.doc === "string" ? flags.doc : undefined, fishteaHome: FISHTEA_HOME, force: flags.force === true, answers, flags });
      console.log(pc.green(`✓ created ${out.dir} from the ${out.template} archetype${out.answered.length ? ` (${out.answered.length} answers applied)` : " (defaults; run the TUI to onboard)"}`));
      console.log(pc.dim(`  .env written; the core will bind 0.0.0.0 and advertise ${publicHost(flags)}`));
      console.log(`\n  cd ${out.dir}\n  bun run up        # docker compose: db + classifier + core + ui\n  bun run tui       # edit the spec, restart, regenerate sections\n  bun run dev       # core only, against the DATABASE_URL in .env\n`);
      return;
    }
    case "validate": {
      const dir = resolveAppDir(flags);
      const app = loadOrDie(dir);
      console.log(pc.green(`✓ ${app.spec.business.name} (${app.spec.business.id}) v${app.spec.business.version}`));
      console.log(`  ${Object.keys(app.hashes).map((s) => `${s}:${app.hashes[s].slice(0, 8)}`).join("  ")}`);
      return;
    }
    case "doctor": {
      const dir = resolveAppDir(flags);
      const rows: [string, boolean, string][] = [];
      let app: App | null = null;
      try { app = loadApp(dir); rows.push(["spec", true, `${app.spec.business.name} v${app.spec.business.version}`]); }
      catch (e) { rows.push(["spec", false, e instanceof SpecError ? e.problems[0] : (e as Error).message]); }
      try { await checkDatabase(databaseUrl(flags), { appDir: dir }); rows.push(["database", true, redact(databaseUrl(flags))]); }
      catch (e) { rows.push(["database", false, (e as Error).message]); }
      const cls = classifierUrl(flags);
      try {
        const r = await fetch(`${cls}/healthz`, { signal: AbortSignal.timeout(2000) });
        const j: any = await r.json();
        rows.push(["classifier", !!j.ok, `${cls} · ${j.model} · ${j.ready}/${j.workers} workers · ${j.tools} tools`]);
      } catch { rows.push(["classifier", false, `${cls} unreachable — text utterances will pour "ask"`]); }
      rows.push(["binding", true, `${bindHost(flags)}:${bindPort(flags)} · other machines dial ${publicUrl(flags)}`]);
      for (const [what, ok, detail] of rows) console.log(`${ok ? pc.green("✓") : pc.red("✗")} ${what.padEnd(11)} ${ok ? detail : pc.red(detail)}`);
      if (rows.some(([, ok]) => !ok)) process.exit(1);
      return;
    }
    case "derive": {
      const app = loadOrDie(resolveAppDir(flags));
      const which = flags.ddl ? "ddl" : flags.tools ? "tools" : flags.forms ? "forms" : "all";
      if (which === "ddl" || which === "all") console.log(deriveDDL(app.spec));
      if (which === "tools" || which === "all") console.log(JSON.stringify(deriveTools(app.spec), null, 2));
      if (which === "forms") for (const [n, s] of shapes(app.spec)) console.log(n, JSON.stringify(deriveForm(s)));
      return;
    }
    case "migrate": {
      const app = loadOrDie(resolveAppDir(flags));
      const db = connect(databaseUrl(flags));
      const report = await migrate(db, app, { allowDestructive: flags["allow-destructive"] === true, log: (s) => console.log("  " + s) });
      console.log(pc.green(`✓ migrated ${app.spec.business.id}: ${report.created.length} created, ${report.added.length} added, ${report.dropped.length} dropped`));
      if (report.refused.length) console.log(pc.yellow(`  refused (destructive; re-run with --allow-destructive): ${report.refused.join(", ")}`));
      await db.end();
      return;
    }
    case "seed": {
      const app = loadOrDie(resolveAppDir(flags));
      const db = connect(databaseUrl(flags));
      const counts = await seed(db, app, { log: (s) => console.log("  " + s) });
      console.log(pc.green(`✓ seeded ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ") || "nothing (no seed/ dir)"}`));
      await db.end();
      return;
    }
    case "serve":
    case "dev": {
      const dir = resolveAppDir(flags);
      const app = loadOrDie(dir);
      const { serve } = await import("./serve.ts");
      await serve(app, flags, dir);
      return;
    }
    case "headless": {
      const dir = resolveAppDir(flags);
      const app = loadOrDie(dir);
      const scriptPath = typeof flags.script === "string" ? resolve(flags.script) : join(dir, "scripts", "walkthrough.json");
      if (!existsSync(scriptPath)) throw new Error(`no script at ${scriptPath}; pass --script`);
      const script = JSON.parse(readFileSync(scriptPath, "utf8"));
      const { engine, db } = await buildEngine(app, flags);
      const drift = await entitiesDrift(db, app);
      if (drift.drifted) console.error(pc.yellow(`entities changed since last migration (run: fishtea migrate)`));
      await runScript(engine, script, { pretty: flags.json !== true, envelope: { utm_campaign: "headless" } });
      await db.end();
      return;
    }
    case "tui": {
      const dir = resolveAppDir(flags);
      const { tui } = await import("@fishtea/tui");
      await tui({ dir, fishteaHome: FISHTEA_HOME, flags });
      return;
    }
    case "up": case "down": case "ps": case "logs": case "restart": {
      const dir = resolveAppDir(flags);
      const args = ["compose", cmd === "up" ? "up" : cmd, ...(cmd === "up" ? ["--build", ...(flags.detach ? ["-d"] : [])] : []), ...(cmd === "restart" ? [String(flags.service ?? "core")] : []), ...(cmd === "logs" ? ["-f", ...positional.slice(1)] : [])];
      const proc = Bun.spawn(["docker", ...args], { cwd: dir, stdio: ["inherit", "inherit", "inherit"], env: { ...process.env, FISHTEA_HOME } });
      process.exit(await proc.exited);
    }
    case "bench": {
      const { bench } = await import("@fishtea/bench");
      await bench({ flags, positional: positional.slice(1), fishteaHome: FISHTEA_HOME });
      return;
    }
    case "notify": {
      const [, visitorId, ...rest] = positional;
      const url = String(flags.core ?? process.env.FISHTEA_CORE_URL ?? "http://localhost:3000");
      const res = await fetch(`${url}/op/notify`, { method: "POST", headers: { "content-type": "application/json", "x-fishtea-operator": String(process.env.FISHTEA_OPERATOR_TOKEN ?? flags.token ?? "") }, body: JSON.stringify({ visitorId, text: rest.join(" "), name: flags.name, args: flags.args ? JSON.parse(String(flags.args)) : undefined }) });
      console.log(await res.json());
      return;
    }
    default:
      console.log(`fishtea — describe once, derive everything

  fishtea templates           list the archetypes and their onboarding interviews
  fishtea new <id> --template <archetype> [--dir path] [--name "Name"] [--answers a.json | --interactive]
  fishtea validate            validate spec.json and print section hashes
  fishtea doctor              check the spec, the database, the classifier and the binding
  fishtea derive [--ddl|--tools|--forms]
  fishtea migrate [--allow-destructive]
  fishtea seed                load seed/*.json
  fishtea serve [--host 0.0.0.0] [--port 3000] [--intent lexical|needle] [--strict]
  fishtea headless [--script scripts/walkthrough.json] [--json]
  fishtea tui                 operator console: onboard, edit, run
  fishtea up | down | ps | logs | restart [--service core]
  fishtea bench               performance harness against a running stack
  fishtea notify <visitorId> "<text>"

  --app <dir>        application directory (default FISHTEA_APP or cwd)
  --db <url>         Postgres, overriding DATABASE_URL
  --classifier <url> needle pool, overriding CLASSIFIER_URL
  --host / --port    what the core binds (default 0.0.0.0:3000, reachable from other machines)
  --workspace <dir>  where "new" puts applications (default FISHTEA_WORKSPACE, else beside fishtea)

  env: DATABASE_URL, CLASSIFIER_URL, FISHTEA_HOST, FISHTEA_PUBLIC_HOST, PORT, FISHTEA_INTENT,
       FISHTEA_STRICT, FISHTEA_OPERATOR_TOKEN, FISHTEA_WORKSPACE, FISHTEA_APP, FISHTEA_HOME`);
  }
}

if (import.meta.main) {
  main().catch((e) => {
    if (e instanceof SetupError) e.print(pc);
    else console.error(pc.red(`✗ ${e.message}`));
    if (process.env.FISHTEA_DEBUG) console.error(e);
    process.exit(1);
  });
}
