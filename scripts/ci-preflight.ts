#!/usr/bin/env bun
/**
 * Prove the test database is really there, over the path the tests use, before any of them run.
 *
 *   bun scripts/ci-preflight.ts
 *
 * A service container reports healthy and the steps begin, but Postgres's own entrypoint starts the
 * server twice: once on a unix socket to run initdb and create the database, then again on TCP. A
 * `pg_isready` without a host checks the socket, so it can pass against that first temporary server
 * and hand the suite a port that is about to close. The health check in ci.yml asks over TCP for
 * exactly that reason; this is the second half of it, from where the tests actually sit.
 *
 * It also creates the `vector` extension. Every migration opens with `CREATE EXTENSION IF NOT EXISTS
 * vector` (packages/spec/src/derive.ts), which needs the image to carry pgvector and the role to be
 * allowed to install it. Finding that out here costs one line; finding it out inside a migration costs
 * a failure that reads like a schema bug.
 *
 * Exit 1 says the database is not usable and names which of the two it was, so a red run does not
 * start with thirty-one files of ECONNREFUSED.
 */
import { connect } from "@fishtea/core";
// The same pin the composes and CI use. scripts/build-release.ts reaches into the CLI source the same
// way: the seams rule is about packages/tui/src at run time in a release, not about scripts/.
import { POSTGRES_IMAGE } from "../packages/cli/src/env.ts";

const URL_ = process.env.FISHTEA_TEST_DATABASE_URL ?? "postgres://fishtea:fishtea@localhost:5434/fishtea";
const DEADLINE = Number(process.env.FISHTEA_PREFLIGHT_SECONDS ?? 60) * 1000;

/** Redact the password: this prints in a public log. */
const shown = URL_.replace(/\/\/([^:@/]+):[^@]*@/, "//$1:***@");

const started = Date.now();
let attempt = 0;
let last = "";

while (Date.now() - started < DEADLINE) {
  attempt++;
  // The framework's own connect, so this proves the path the tests take rather than a second one.
  const sql = connect(URL_);
  try {
    const [{ version }] = await sql`SELECT version()`;
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    const [v] = await sql`SELECT extversion FROM pg_extension WHERE extname = 'vector'`;
    console.log(`✓ ${shown}`);
    console.log(`  ${String(version).split(" on ")[0]}`);
    console.log(`  pgvector ${v?.extversion ?? "MISSING"}`);
    console.log(`  ready after ${attempt} attempt${attempt === 1 ? "" : "s"}, ${Date.now() - started}ms`);
    await sql.end();
    if (!v?.extversion) {
      console.error(`\n✗ the vector extension did not install. Every migration opens with it, so the suite cannot run.`);
      process.exit(1);
    }
    process.exit(0);
  } catch (e) {
    // postgres.js reports a refused connection with an empty message and the reason in `code`, so a
    // bare e.message prints nothing at all, which is the one thing this script exists to avoid.
    const err = e as { code?: string; errno?: string; message?: string };
    last = [err.code, err.errno, err.message].filter(Boolean).join(" ") || String(e);
    await sql.end({ timeout: 1 }).catch(() => {});
    await Bun.sleep(1000);
  }
}

console.error(`✗ no usable database at ${shown} after ${attempt} attempts over ${DEADLINE / 1000}s`);
console.error(`  last error: ${last}`);
console.error(`\n  locally:  docker run -d --name fishtea-test-db -e POSTGRES_USER=fishtea -e POSTGRES_PASSWORD=fishtea \\`);
console.error(`              -e POSTGRES_DB=fishtea -p 5434:5432 ${POSTGRES_IMAGE}`);
console.error(`  in CI:    the postgres service in .github/workflows/ci.yml`);
process.exit(1);
