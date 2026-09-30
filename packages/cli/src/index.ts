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
import { loadApp, deriveDDL, deriveTools, deriveForm, shapes, SpecError, FISHTEA_VERSION, SPEC_FORMAT, checkCompatibility, frameworkHome, type App } from "@fishtea/spec";
import { connect, migrate, seed, entitiesDrift, Engine, runScript, LexicalClassifier, NeedleClient, createServer, type Classifier, type Channel, withBudget, loadSeam, seamsOfKind } from "@fishtea/core";
import { scaffold, listTemplates } from "./new.ts";
import type { Scaffolder } from "@fishtea/tui";
import { readManifest } from "./manifest.ts";
import { present } from "./present.ts";
import { DEFAULT_APP_ID, SetupError, bindHost, bindPort, checkDatabase, classifierUrl, databaseUrl, nextFreePort, publicHost, publicUrl, redact, type Flags } from "./env.ts";

/**
 * The framework's own files. Resolved by @fishtea/spec so that a source checkout, a compiled binary and a
 * Compose container all agree — the CLI used to guess from import.meta.url, which is meaningless once the
 * whole thing is a single executable.
 */
export const FISHTEA_HOME = frameworkHome();

/**
 * A repeated flag accumulates into an array rather than overwriting, so `--set a=1 --set b=2` keeps both.
 * Everything that reads a flag tests `typeof x === "string"` first, so a single occurrence is unchanged
 * and a repeat simply fails that test rather than silently handing back only the last value.
 */
export function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean | string[]> = {};
  const positional: string[] = [];
  const put = (k: string, v: string | boolean) => {
    const seen = flags[k];
    if (seen === undefined) flags[k] = v;
    else if (Array.isArray(seen)) seen.push(String(v));
    else flags[k] = [String(seen), String(v)];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (v !== undefined) put(k, v);
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) put(k, argv[++i]);
      else put(k, true);
    } else positional.push(a);
  }
  return { flags, positional };
}

/** Every value given for a flag, whether it appeared once, many times, or not at all. */
export function flagList(v: unknown): string[] {
  if (v === undefined || v === true || v === false) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

export function resolveAppDir(flags: Flags): string {
  const given = typeof flags.app === "string" ? flags.app : process.env.FISHTEA_APP;
  if (given) return resolve(given);
  if (existsSync(resolve("spec.json"))) return resolve(".");
  throw new Error("no application: pass --app <dir> or set FISHTEA_APP (a directory containing spec.json)");
}

/**
 * What the console is given instead of importing the CLI back.
 *
 * `@fishtea/cli` imports `@fishtea/tui`, so the console cannot import this package without a cycle. It
 * used to `await import(`${fishteaHome}/packages/cli/src/new.ts`)` — fine in a checkout, impossible in
 * a compiled binary, which ships no source. See packages/tui/src/lib/scaffolder.ts.
 */
const SCAFFOLDER: Scaffolder = { listTemplates, scaffold };

/**
 * Host ports for `fishtea up`, avoiding whatever is already listening.
 *
 * Only the ones nobody chose move: a set FISHTEA_CORE_PORT is an instruction, and quietly publishing
 * somewhere else would be worse than failing. The container-side ports never change — these are the
 * left-hand sides of compose's `"${FISHTEA_CORE_PORT:-3000}:3000"`.
 */
export async function composePorts(): Promise<Record<string, string>> {
  const wanted: [string, number, string][] = [
    ["FISHTEA_CORE_PORT", 3000, "the core"],
    ["FISHTEA_UI_PORT", 5173, "the UI"],
    ["FISHTEA_DB_PORT", 5432, "postgres"],
    ["FISHTEA_CLASSIFIER_PORT", 8081, "the classifier"],
  ];
  const out: Record<string, string> = {};
  const moved: string[] = [];
  for (const [envVar, fallback, label] of wanted) {
    if (process.env[envVar]) continue;                       // chosen: leave it, and let docker complain
    const free = await nextFreePort(fallback);
    if (free === undefined || free === fallback) continue;    // free already, or nothing nearby is
    out[envVar] = String(free);
    moved.push(`${label} ${fallback} → ${free}`);
  }
  if (moved.length) {
    console.log(pc.yellow(`⚠ ports in use, publishing elsewhere: ${moved.join(", ")}`));
    console.log(pc.dim(`  pin one instead: ${wanted[0][0]}=<n> bun run up`));
  }

  /**
   * Say where things actually are.
   *
   * Every service inside a container reports the port it bound *there*, so Vite announces 5173 and the
   * core announces 3000 even when compose published them on 5175 and 3002. Both are true and neither is
   * the address to type. Only this process knows the published ports, so only this process can say.
   */
  const at = (envVar: string, fallback: number) => out[envVar] ?? process.env[envVar] ?? String(fallback);
  console.log(pc.green("\n  the stack is published at:"));
  console.log(`    UI          ${pc.cyan(`http://localhost:${at("FISHTEA_UI_PORT", 5173)}`)}`);
  console.log(pc.dim(`    core        http://localhost:${at("FISHTEA_CORE_PORT", 3000)}`));
  console.log(pc.dim(`    classifier  http://localhost:${at("FISHTEA_CLASSIFIER_PORT", 8081)}`));
  console.log(pc.dim(`    postgres    localhost:${at("FISHTEA_DB_PORT", 5432)}`));
  console.log(pc.dim(`  the ports each container prints below are its own, inside the network.\n`));

  return out;
}

export function loadOrDie(dir: string): App {
  try { return loadApp(dir); }
  catch (e) {
    if (e instanceof SpecError) { console.error(pc.red("✗ spec invalid")); for (const p of e.problems) console.error("  - " + p); process.exit(2); }
    throw e;
  }
}

/**
 * Which brain answers.
 *
 * A `classifier` plugin wins when the application has one, because asking for it is an explicit choice
 * and there is no sensible way to half-honour it. Everything else is the existing rule: needle when a
 * pool is pointed at, the lexical harness otherwise.
 *
 * A plugin's classifier is wrapped in `withBudget`, which the shipped ones do not need. It is somebody
 * else's code on the request path, and "every classify call has a hard budget" is a rule of the house,
 * not a request to the author.
 */
export async function classifierFor(flags: Flags, app?: App): Promise<Classifier> {
  const seams = app ? seamsOfKind(app.plugins, "classifier") : [];
  if (seams.length > 1) {
    throw new SetupError(`${seams.length} classifier plugins are enabled (${seams.map((p) => p.as).join(", ")})`, [
      "Only one can answer. Disable the others: fishtea plugin remove <name>",
      'or set "enabled": false on it in spec.plugins.',
    ]);
  }
  if (seams[0]) return withBudget(await loadSeam<Classifier>(seams[0]));

  const intent = String(flags.intent ?? process.env.FISHTEA_INTENT ?? (process.env.CLASSIFIER_URL || flags.classifier ? "needle" : "lexical"));
  return intent === "needle" ? new NeedleClient(classifierUrl(flags)) : new LexicalClassifier();
}

/**
 * Where notifications go when the visitor is not connected.
 *
 * Unlike the classifier there can be several: delivering the same notification by email and to a Slack
 * room is a reasonable thing to want, and they do not compete for one slot. A channel that cannot be
 * loaded is reported and skipped rather than fatal — an application whose email plugin has a bad key
 * should still serve, with its notifications waiting on the trail as they did before.
 */
export async function channelsFor(app: App, log: (s: string) => void = () => {}): Promise<Channel[]> {
  const out: Channel[] = [];
  for (const p of seamsOfKind(app.plugins, "channel")) {
    try {
      const ch = await loadSeam<Channel>(p);
      if (typeof ch?.deliver !== "function") { console.error(pc.yellow(`⚠ channel "${p.as}" has no deliver() — notifications will wait on the trail`)); continue; }
      out.push(ch);
      log(`channel ${p.as} ready`);
    } catch (e) {
      console.error(pc.yellow(`⚠ ${(e as Error).message}`));
      console.error(pc.dim(`  notifications will wait on the trail until the visitor returns, as they do with no channel at all`));
    }
  }
  return out;
}

export async function buildEngine(app: App, flags: Flags, opts: { log?: (s: string) => void } = {}) {
  const db = connect(databaseUrl(flags));
  const classifier = await classifierFor(flags, app);
  const channels = await channelsFor(app, opts.log);
  const engine = new Engine({ app, db, classifier, channels, strict: flags.strict === true || process.env.FISHTEA_STRICT === "1", log: opts.log });
  if (classifier instanceof LexicalClassifier) await engine.primeLexical();
  else if (classifier.reload) {
    const h = await classifier.health();
    if (h.ok) {
      const t0 = performance.now();
      await classifier.reload(engine.toolSpecs, engine.personaSubsets).catch((e) => console.error(pc.yellow(`classifier reload failed: ${e.message}`)));
      if (process.env.FISHTEA_DEBUG) console.error(pc.dim(`pool reloaded + warmed ${engine.personaSubsets.length} persona subsets in ${Math.round(performance.now() - t0)} ms`));

      // Say so while it is still warming. `reload` returns as soon as the pool accepts the tools; the
      // per-persona agents are built behind it, and binding one costs 0.7–1.2 s against a 400 ms budget.
      // So the first turn for each persona can pour `ask` on a perfectly healthy stack — which reads as
      // "it is broken" unless somebody said this would happen.
      const after = await classifier.health().catch(() => null);
      if ((after?.detail as any)?.warming) {
        console.error(pc.yellow(`⚠ the classifier is still warming ${engine.personaSubsets.length} persona subsets`));
        console.error(pc.dim(`  binding one costs ~1 s against a ${app.spec.rules.classify?.budgetMs ?? 400} ms budget, so the first turn for each persona may pour "ask" — ask again and it will answer`));
      }
    }
    else {
      console.error(pc.yellow(`⚠ no classifier pool at ${classifierUrl(flags)} — text utterances will pour "ask" until one answers`));
      console.error(pc.dim(`  start one: cd ${FISHTEA_HOME}/packages/classifier && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python needle_service.py`));
      console.error(pc.dim(`  or point at another machine: CLASSIFIER_URL=http://host:8081 (or --classifier)`));
      console.error(pc.dim(`  or develop without one: FISHTEA_INTENT=lexical (a development harness, never production)`));
    }
  }
  return { engine, db };
}

/**
 * An application says which framework versions it accepts (package.json → fishtea.version). We know which
 * one we are. Say so when they disagree, on every command, because the symptom otherwise is a confusing
 * failure somewhere much deeper.
 */
export function warnIfIncompatible(dir: string): void {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return;
  let pin: string | undefined;
  try { pin = JSON.parse(readFileSync(pkgPath, "utf8")).fishtea?.version; } catch { return; }
  const c = checkCompatibility(pin);
  if (c.ok) return;
  const how = c.reason === "framework-behind"
    ? `this framework is older than the application expects — upgrade it (fishtea upgrade)`
    : `the application has not been updated for this framework — run: fishtea update --app ${dir}`;
  console.error(pc.yellow(`⚠ framework ${c.have} does not satisfy ${c.want}: ${how}`));
}

/** `fishtea use` with no argument says what is running rather than failing. */
function renderUse(current: string | null): string {
  return current ? `running ${current} — fishtea versions lists the others` : "no installed versions under this root (running from a checkout)";
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  // Bare `fishtea --version`. Scoped to the no-command case on purpose: `-v` already means --volumes to
  // `down`, and a version flag must never shadow a command's own.
  if ((flags.version === true || flags.v === true) && positional.length === 0) { console.log(FISHTEA_VERSION); return; }
  const cmd = positional[0] ?? "help";
  // Say it once, up front, for anything that actually runs the application. `version`, `doctor` and
  // `update` report compatibility themselves — in more detail — so they are left out.
  if (!["version", "doctor", "update", "new", "templates", "help"].includes(cmd)) {
    try { warnIfIncompatible(resolveAppDir(flags)); } catch { /* no application here; other errors follow */ }
  }
  switch (cmd) {
    case "version": {
      const bunVersion = (globalThis as any).Bun?.version ?? "not bun";
      console.log(`${pc.bold("fishtea")}      ${FISHTEA_VERSION}`);
      console.log(`${pc.dim("spec format")} ${SPEC_FORMAT}`);
      console.log(`${pc.dim("bun")}         ${bunVersion}`);
      console.log(`${pc.dim("home")}        ${FISHTEA_HOME}`);
      try {
        const dir = resolveAppDir(flags);
        const pkg = existsSync(join(dir, "package.json")) ? JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) : {};
        const spec = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8"));
        const m = readManifest(dir);
        const c = checkCompatibility(pkg.fishtea?.version);
        console.log(`\n${pc.bold("application")} ${dir}`);
        console.log(`${pc.dim("  archetype")}  ${m?.template ?? pkg.fishtea?.template ?? "unknown"}`);
        console.log(`${pc.dim("  pins")}       ${pkg.fishtea?.version ?? "nothing"} ${c.ok ? pc.green("✓ satisfied") : pc.red("✗ not satisfied")}`);
        console.log(`${pc.dim("  spec")}       format ${spec.fishtea}${spec.fishtea === SPEC_FORMAT ? "" : pc.yellow(` → ${SPEC_FORMAT} available (fishtea update)`)} · business v${spec.business?.version}`);
        console.log(`${pc.dim("  generated")}  by ${m?.fishtea ?? "unknown"}${m ? `, updated ${m.updated.slice(0, 10)}` : " (no manifest — fishtea update --adopt)"}`);
      } catch { /* not in an application; the framework lines are the answer */ }
      return;
    }
    case "versions": {
      const { renderVersions } = await import("./upgrade.ts");
      const { shimOnPath, installRoot } = await import("./runtime.ts");
      console.log(renderVersions());
      if (!shimOnPath()) console.log(pc.yellow(`\n⚠ ${join(installRoot(), "bin")} is not on PATH, so \`fishtea\` may not be the version marked above`));
      return;
    }
    case "use": {
      const { useVersion, currentVersion } = await import("./runtime.ts");
      const want = positional[1];
      if (!want) { console.log(renderUse(currentVersion())); return; }
      const dir = useVersion(want);
      console.log(pc.green(`✓ now running ${want}`));
      console.log(pc.dim(`  ${dir}`));
      console.log(pc.dim(`  applications are untouched; each moves when it runs: fishtea update`));
      return;
    }
    case "upgrade": {
      const U = await import("./upgrade.ts");
      const from = typeof flags.from === "string" ? flags.from : undefined;
      if (from) {
        const r = await U.upgradeFromCheckout(resolve(from));
        console.log(pc.green(`✓ running ${r.version}${r.from && r.from !== r.version ? ` (was ${r.from})` : ""}`));
        if (r.from && r.from !== r.version) console.log(pc.dim(`  go back any time: fishtea use ${r.from}`));
        return;
      }
      const check = await U.checkForUpdate();
      if (!check.behind && flags.force !== true) {
        console.log(pc.green(`✓ ${check.current} is the newest release`));
        return;
      }
      console.log(`${check.current} → ${check.latest}, downloading for ${U.hostTarget()}…`);
      const r = await U.upgradeFromRelease(check.latest, { force: flags.force === true });
      console.log(pc.green(`✓ running ${r.version}${r.from ? ` (was ${r.from})` : ""}`));
      if (r.from) console.log(pc.dim(`  go back any time: fishtea use ${r.from}`));
      return;
    }
    case "uninstall": {
      const { removeVersion } = await import("./runtime.ts");
      const want = positional[1];
      if (!want) throw new Error("which version? fishtea versions");
      removeVersion(want);
      console.log(pc.green(`✓ removed ${want}`));
      return;
    }
    case "plugin": case "plugins": {
      const P = await import("./plugin.ts");
      const sub = positional[1] ?? "list";
      const dir = () => resolveAppDir(flags);
      switch (sub) {
        case "list": console.log(P.list(dir(), FISHTEA_HOME)); return;
        case "info": console.log(P.info(String(positional[2] ?? ""), dir(), FISHTEA_HOME)); return;
        case "add": {
          const use = positional[2];
          if (!use) throw new Error("which plugin? fishtea plugin list");
          // --set k=v (repeatable) answers the plugin's config questions without an interview.
          const config: Record<string, unknown> = {};
          for (const raw of flagList(flags.set)) {
            const [k, ...rest] = String(raw).split("=");
            if (k && rest.length) { const v = rest.join("="); config[k] = /^-?\d+$/.test(v) ? Number(v) : v === "true" ? true : v === "false" ? false : v; }
          }
          const r = P.add(use, dir(), { as: typeof flags.as === "string" ? flags.as : undefined, config, home: FISHTEA_HOME });
          console.log(pc.green(`✓ added ${r.manifest.name} ${r.manifest.version} as plugins.${r.as}`));
          const env = r.manifest.env ?? [];
          if (env.length) console.log(pc.yellow(`  set ${env.join(", ")} in .env before it will answer`));
          console.log(pc.dim(`  nothing was inlined into spec.json; what it contributes appears when the spec loads`));
          return;
        }
        case "remove": case "rm": {
          const as = positional[2];
          if (!as) throw new Error("which plugin? fishtea plugin list");
          P.remove(as, dir());
          console.log(pc.green(`✓ removed plugins.${as}; everything it contributed is gone with it`));
          return;
        }
        case "create": {
          const name = positional[2];
          if (!name) throw new Error("fishtea plugin create <name> --kind <integration|ui|auth|classifier|channel|archetype>");
          const out = P.create(name, String(flags.kind ?? "integration") as any, dir());
          console.log(pc.green(`✓ created ${out}`));
          console.log(pc.dim(`  use it here:     fishtea plugin add ${name}`));
          console.log(pc.dim(`  share it later:  fishtea plugin promote ${name}`));
          return;
        }
        case "promote": {
          const name = positional[2];
          if (!name) throw new Error("which plugin? fishtea plugin promote <name>");
          const r = P.promote(name, dir(), FISHTEA_HOME, { copy: flags.copy === true });
          console.log(pc.green(`✓ promoted ${name} to the framework: ${r.to}`));
          console.log(pc.dim(`  every application resolves it by name now; this one keeps working unchanged`));
          return;
        }
        default: throw new Error(`unknown: fishtea plugin ${sub} (list, info, add, remove, create, promote)`);
      }
    }
    case "ui-assets": {
      const r = (await import("./plugin.ts")).generateUiAssets(resolveAppDir(flags), FISHTEA_HOME);
      console.log(pc.green(`✓ ${r.path}${r.plugins.length ? ` from ${r.plugins.join(", ")}` : " (no ui plugins; base tokens only)"}`));
      for (const w of r.warnings) console.log(pc.yellow(`  ⚠ ${w}`));
      return;
    }
    case "update": {
      const dir = resolveAppDir(flags);
      const { planUpdate, renderPlan, applyUpdate, adopt } = await import("./update.ts");
      if (flags.adopt === true) {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
        const template = String(flags.template ?? pkg.fishtea?.template ?? "");
        if (!template) throw new Error("which archetype did this come from? pass --template <name>");
        const m = adopt(dir, join(FISHTEA_HOME, "templates", template), template);
        console.log(pc.green(`✓ adopted ${dir}: ${Object.keys(m.files).length} files still match the ${template} archetype and will track it`));
        console.log(pc.dim("  every other file is treated as yours and will never be overwritten"));
        return;
      }
      const plan = planUpdate(dir, FISHTEA_HOME);
      console.log(renderPlan(plan));
      if (plan.clean) { console.log(pc.green("\n✓ up to date")); return; }
      if (flags["dry-run"] === true) { console.log(pc.dim("\n--dry-run: nothing written")); return; }
      const res = applyUpdate(plan, { specOnly: flags["spec-only"] === true, filesOnly: flags["files-only"] === true });
      console.log(pc.green(`\n✓ updated: ${res.wrote.length} files written${res.specMigrated ? ", spec migrated" : ""}`));
      if (res.conflicts.length) {
        console.log(pc.yellow(`  ${res.conflicts.length} conflicting, each left beside yours as <file>.new:`));
        for (const c of res.conflicts) console.log(pc.dim(`    ${c}.new`));
        console.log(pc.dim("  diff them, keep what you want, delete the .new — then: fishtea validate"));
      }
      return;
    }
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
        answers = await interview(FISHTEA_HOME, template, SCAFFOLDER, { name: subject });
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
    case "present": {
      const dir = resolveAppDir(flags);
      const app = loadOrDie(dir);
      const core = typeof flags.core === "string" ? flags.core : process.env.FISHTEA_CORE_URL ?? `http://localhost:${process.env.FISHTEA_CORE_PORT ?? bindPort(flags)}`;
      const args = typeof flags.args === "string" ? JSON.parse(flags.args) : {};
      process.exitCode = await present(app, dir, { shapes: positional.slice(1).map(String), live: flags.live === true, core, args });
      return;
    }
    case "doctor": {
      const dir = resolveAppDir(flags);
      const rows: [string, boolean, string][] = [];
      const pkg = existsSync(join(dir, "package.json")) ? JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) : {};
      const compat = checkCompatibility(pkg.fishtea?.version);
      rows.push(["framework", compat.ok,
        compat.ok ? `${FISHTEA_VERSION}${pkg.fishtea?.version ? ` satisfies ${pkg.fishtea.version}` : " (application pins nothing)"}`
                  : `${compat.have} does not satisfy ${compat.want} — ${compat.reason === "framework-behind" ? "upgrade the framework" : "run: fishtea update"}`]);
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
      await tui({ dir, fishteaHome: FISHTEA_HOME, scaffolder: SCAFFOLDER, flags });
      return;
    }
    case "up": case "down": case "stop": case "start": case "ps": case "logs": case "restart": {
      const dir = resolveAppDir(flags);
      const extra = positional.slice(1);                       // anything else goes straight to compose
      // -v arrives as a positional (parseArgs only treats --flags as flags), so look in both places
      const dropData = flags.volumes === true || flags.v === true || extra.includes("-v") || extra.includes("--volumes");
      const detached = flags.detach === true || flags.d === true || extra.includes("-d");
      const args: string[] = ["compose"];
      if (cmd === "up") {
        args.push("up", "--build", ...(detached ? ["-d"] : []));
        if (!detached) console.log(pc.dim("ctrl-c stops the stack; from another terminal: bun run down"));
      } else if (cmd === "down") {
        args.push("down", ...(dropData ? ["-v"] : []));
        if (dropData) console.log(pc.yellow("removing the data volumes as well: every conversation and every row goes"));
      } else if (cmd === "restart") args.push("restart", ...(extra.length ? extra : [String(flags.service ?? "core")]));
      else if (cmd === "logs") args.push("logs", "-f", "--tail", String(flags.tail ?? 80), ...extra);
      else args.push(cmd);
      if (cmd !== "restart" && cmd !== "logs") args.push(...extra.filter((a) => !["-v", "--volumes", "-d"].includes(a)));
      // Compose publishes four host ports, each `${VAR:-default}`. A developer machine usually has
      // something on 3000 already, and docker's answer to that is a wall of text ending in "address
      // already in use" after the healthy containers have started. Pick free ones up front, for the
      // ports nobody named — an explicitly set FISHTEA_*_PORT is left exactly as given.
      const composeEnv = cmd === "up" ? await composePorts() : {};
      const proc = Bun.spawn(["docker", ...args], { cwd: dir, stdio: ["inherit", "inherit", "inherit"], env: { ...process.env, FISHTEA_HOME, ...composeEnv } });
      const code = await proc.exited;
      if (cmd === "down" && code === 0) console.log(pc.green(`✓ stopped${dropData ? " and deleted the data" : "; data kept, bun run up brings it back"}`));
      if (cmd === "stop" && code === 0) console.log(pc.green("✓ paused; bun run start resumes it untouched"));
      process.exit(code);
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
  fishtea version             framework, spec format, and what this application pins
  fishtea versions            every installed version; * is the one running
  fishtea use <version>       switch to another installed version (and back — it is one symlink)
  fishtea upgrade [--from <checkout>]
                              install a newer framework beside the current one and switch to it
  fishtea uninstall <version> remove an installed version that is not current
  fishtea update [--dry-run]  bring this application up to the framework without regenerating it
                              [--adopt] start tracking an application made before provenance existed
  fishtea plugin list|info|add|remove|create|promote
                              everything outside the conversation: integrations, design systems, auth
  fishtea ui-assets           regenerate the browser bundle's design-system stylesheet
  fishtea validate            validate spec.json and print section hashes
  fishtea present [shape…]    how each answer is laid out (rules.present, or derived); --live asks a running core
  fishtea doctor              check the spec, the database, the classifier and the binding
  fishtea derive [--ddl|--tools|--forms]
  fishtea migrate [--allow-destructive]
  fishtea seed                load seed/*.json
  fishtea serve [--host 0.0.0.0] [--port 3000] [--intent lexical|needle] [--strict]
  fishtea headless [--script scripts/walkthrough.json] [--json]
  fishtea tui                 operator console: onboard, edit, run
  fishtea up [--detach]       build and start the stack (ctrl-c stops it)
  fishtea down [-v]           stop and remove it; -v also deletes the data volume
  fishtea stop | start        pause and resume without removing anything
  fishtea ps | logs [service] what is running, and follow its output
  fishtea restart [service]   default: core
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
