#!/usr/bin/env bun
/**
 * `bun run e2e` — the browser walkthrough, headless, with its whole stack.
 *
 * This exists because the walkthrough needs four things running (Postgres, the core, the Vite dev server,
 * and a browser binary) and because it has to be safe to invoke somewhere that has none of them. CI on a
 * headless box, a container with no display, a laptop that never ran `playwright install` — in every one
 * of those the right outcome is a **skip with a reason**, not a crash and not a false pass.
 *
 *   bun run e2e                  bring the stack up, run headless, tear it down
 *   bun run e2e --headed         watch it
 *   bun run e2e --ui             Playwright's inspector
 *   bun run e2e --keep           leave the stack running afterwards
 *   bun run e2e --no-stack       something is already running; just drive it
 *
 * Exit codes: 0 pass or skipped-with-reason, 1 a real failure. A skip is not a pass, and it says so
 * loudly — but it does not fail a pipeline that was never able to run it in the first place.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";

const HOME = resolve(dirname(new URL(import.meta.url).pathname), "..");
const UI = join(HOME, "packages/ui");
const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);

const DB = process.env.FISHTEA_E2E_DATABASE_URL ?? "postgres://fishtea:fishtea@localhost:5434/fishteae2e";
const CORE_PORT = Number(process.env.FISHTEA_E2E_CORE_PORT ?? 3111);
const UI_PORT = Number(process.env.FISHTEA_E2E_UI_PORT ?? 5199);
const CORE = `http://localhost:${CORE_PORT}`;
const UI_URL = `http://localhost:${UI_PORT}`;

const log = (s: string) => console.log(`  ${s}`);
function skip(why: string, fix: string): never {
  console.log(`\n⚠ skipped: ${why}`);
  console.log(`  ${fix}\n`);
  process.exit(0);
}

/** Poll until a URL answers, or give up. */
async function waitFor(url: string, label: string, ms = 45_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await Bun.sleep(400);
  }
  console.error(`✗ ${label} did not come up at ${url}`);
  return false;
}

// ---- prerequisites ---------------------------------------------------------------------------------
// Each of these is a legitimate reason to skip rather than fail: none of them means the code is broken.
if (!existsSync(join(UI, "node_modules/@playwright/test")) && !existsSync(join(HOME, "node_modules/@playwright/test"))) {
  skip("@playwright/test is not installed", "bun add -D @playwright/test @axe-core/playwright --cwd packages/ui");
}
// Honour PLAYWRIGHT_BROWSERS_PATH, which is how a CI image pins browsers outside $HOME.
const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), ".cache/ms-playwright");
if (!existsSync(browsers) || !readdirSync(browsers).some((d) => d.startsWith("chromium"))) {
  skip(`no Playwright chromium in ${browsers}`, "cd packages/ui && bunx playwright install chromium");
}

const procs: ReturnType<typeof Bun.spawn>[] = [];
const stop = () => { for (const p of procs) { try { p.kill(); } catch { /* already gone */ } } };
process.on("exit", stop);
process.on("SIGINT", () => { stop(); process.exit(130); });

let appDir = "";
let scratch = "";

try {
  if (!has("--no-stack")) {
    // --- database -------------------------------------------------------------------------------
    const { checkDatabase } = await import("../packages/cli/src/env.ts");
    try {
      await checkDatabase(DB, { appDir: HOME });
    } catch {
      skip(`no database at ${DB.replace(/:[^:@]+@/, ":***@")}`,
        "docker run -d --name fishtea-test-db -e POSTGRES_USER=fishtea -e POSTGRES_PASSWORD=fishtea " +
        "-e POSTGRES_DB=fishtea -p 5434:5432 pgvector/pgvector:pg18\n" +
        "  then: docker exec fishtea-test-db psql -U fishtea -d fishtea -c 'CREATE DATABASE fishteae2e'");
    }

    // --- a throwaway application ------------------------------------------------------------------
    scratch = mkdtempSync(join(tmpdir(), "fishtea-e2e-"));
    appDir = join(scratch, "app");
    log("scaffolding a throwaway ecommerce application…");
    const { scaffold } = await import("../packages/cli/src/new.ts");
    await scaffold({ id: "e2eshop", template: "ecommerce", dir: appDir, fishteaHome: HOME, force: true });

    const cli = join(HOME, "packages/cli/src/index.ts");
    const run = async (label: string, argv: string[]) => {
      const p = Bun.spawn(["bun", cli, ...argv, "--app", appDir, "--db", DB], { cwd: HOME, stdout: "pipe", stderr: "pipe" });
      if (await p.exited !== 0) { console.error(`✗ ${label} failed`); console.error(await new Response(p.stderr).text()); process.exit(1); }
    };
    log("migrating and seeding…");
    await run("migrate", ["migrate"]);
    await run("seed", ["seed"]);

    // --- core -------------------------------------------------------------------------------------
    log(`starting the core on :${CORE_PORT}…`);
    procs.push(Bun.spawn(["bun", cli, "serve", "--app", appDir, "--db", DB, "--port", String(CORE_PORT)], {
      cwd: HOME, stdout: "ignore", stderr: "ignore",
      // The lexical classifier is a development harness — which is exactly right here: it is
      // deterministic, so a walkthrough asserts the UI rather than a model's mood.
      env: { ...process.env, FISHTEA_INTENT: "lexical", FISHTEA_HOST: "127.0.0.1" },
    }));
    if (!await waitFor(`${CORE}/healthz`, "core")) process.exit(1);

    // --- ui ---------------------------------------------------------------------------------------
    log(`starting the browser bundle on :${UI_PORT}…`);
    procs.push(Bun.spawn(["bun", "run", "dev", "--port", String(UI_PORT), "--strictPort"], {
      cwd: UI, stdout: "ignore", stderr: "ignore",
      env: { ...process.env, VITE_CORE_URL: CORE },
    }));
    if (!await waitFor(UI_URL, "ui")) process.exit(1);
  }

  // ---- run -------------------------------------------------------------------------------------
  const pw = ["bunx", "playwright", "test", ...args.filter((a) => !["--keep", "--no-stack"].includes(a))];
  log(`running: ${pw.join(" ")}\n`);
  const test = Bun.spawn(pw, {
    cwd: UI, stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, FISHTEA_UI_URL: has("--no-stack") ? (process.env.FISHTEA_UI_URL ?? UI_URL) : UI_URL },
  });
  const code = await test.exited;

  if (has("--keep")) {
    console.log(`\n  stack left running: ui ${UI_URL} · core ${CORE}${appDir ? ` · app ${appDir}` : ""}`);
    procs.length = 0;                                   // do not kill it on exit
  }
  process.exit(code);
} finally {
  stop();
  if (scratch && !has("--keep")) rmSync(scratch, { recursive: true, force: true });
}
