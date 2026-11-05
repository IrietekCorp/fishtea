/**
 * Where things live on the network, and where new applications go on disk.
 *
 * Nothing here assumes localhost. A stack can have its Postgres on one host, its classifier pool on another
 * and its core bound to every interface; each is a flag, then an environment variable, then a default.
 */
import { networkInterfaces } from "node:os";
import { createServer } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/**
 * The Postgres this framework is tested on, pinned exactly, in one place.
 *
 * Every other site reads this: the generated application's compose (new.ts), the framework's own
 * compose, the CI service, and the "is it running?" line of a SetupError. `bun test scripts` fails when
 * a file that cannot import it (compose, the workflow, CLAUDE.md, README.md) disagrees, so moving
 * everyone to a new Postgres is this constant plus whatever that test names.
 *
 * Pinned rather than floating because `pgvector/pgvector:pg18` moves: CI resolved pgvector 0.8.7 on the
 * same day a developer's container was still 0.8.6, which is a difference nobody chose and nobody saw.
 *
 * Why 18, as of 2026-11-05: **pgvector publishes no pg19 image.** PostgreSQL 19 is due 2026-11-19, and
 * none of this moves until pgvector ships a build for it, whatever Postgres does. Check with
 *
 *     curl -s 'https://hub.docker.com/v2/repositories/pgvector/pgvector/tags?page_size=100&name=pg19'
 *
 * and note that a `pgdata` volume written by one major version will not start under the next: moving a
 * live stack is a dump and restore, not an image bump. docs/OPERATING.md says how.
 */
export const POSTGRES_IMAGE = "pgvector/pgvector:0.8.7-pg18-trixie";

/**
 * Readiness, asked over TCP.
 *
 * `-h localhost` is the whole point. Postgres's entrypoint starts the server twice: once on a unix
 * socket to run initdb and create the database, then again on TCP. A pg_isready with no host checks the
 * socket, so it can pass against that first temporary server and hand out a port that is about to
 * close. Naming the database rather than letting it default to the role is the same kind of accident
 * waiting to happen: both are `fishtea` here, so the default was right by coincidence.
 */
export const POSTGRES_READY = "pg_isready -h localhost -U fishtea -d fishtea";

export type Flags = Record<string, string | boolean | string[] | undefined>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length ? v : undefined);

/** The address the core binds. 0.0.0.0 by default so the stack is reachable from other machines. */
export const bindHost = (flags: Flags = {}): string => str(flags.host) ?? process.env.FISHTEA_HOST ?? "0.0.0.0";
export const bindPort = (flags: Flags = {}): number => Number(str(flags.port) ?? process.env.PORT ?? 3000);

/**
 * Did someone actually ask for this port, or is it just the default?
 *
 * The distinction is the whole of the auto-port behaviour below: moving off a port nobody chose is a
 * convenience, and moving off one somebody named is ignoring an instruction.
 */
export const portWasChosen = (flags: Flags = {}): boolean => !!(str(flags.port) ?? process.env.PORT);

/**
 * Can we bind this port on this host?
 *
 * Probing the *bind host* rather than localhost matters: something listening only on 127.0.0.1 still
 * blocks a bind to 0.0.0.0, and something on one LAN address does not block another. Asking the kernel
 * the same question the server will ask is the only answer that is not a guess.
 */
export function portFree(port: number, host = "0.0.0.0"): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    try { probe.listen(port, host === "0.0.0.0" ? undefined : host); } catch { resolve(false); }
  });
}

/** The first free port at or after `from`, or undefined if `tries` of them are all taken. */
export async function nextFreePort(from: number, host = "0.0.0.0", tries = 40): Promise<number | undefined> {
  for (let p = from; p < from + tries && p <= 65535; p++) if (await portFree(p, host)) return p;
  return undefined;
}

/**
 * The port to actually bind.
 *
 * Free, or nobody chose it and we may move: the first free one above it, reported so the printed URLs
 * and anything reading them stay true. Somebody chose it and it is taken: a SetupError naming what to
 * do, because silently serving somewhere else is how you spend twenty minutes wondering why your
 * requests reach the wrong application.
 */
export async function resolvePort(
  wanted: number,
  host: string,
  o: { chosen: boolean; label?: string } = { chosen: false },
): Promise<{ port: number; moved: boolean }> {
  if (await portFree(wanted, host)) return { port: wanted, moved: false };
  const what = o.label ?? "the core";
  if (o.chosen) {
    throw new SetupError(`port ${wanted} is already in use, and you asked for it specifically`, [
      `Find what has it:  ss -ltnp | grep :${wanted}`,
      `Pick another:      --port <n>   (or PORT=<n>)`,
      `Or let ${what} choose one: unset PORT and drop --port`,
    ]);
  }
  const port = await nextFreePort(wanted + 1, host);
  if (!port) {
    throw new SetupError(`port ${wanted} is in use and so are the next 40`, [
      `Find what has them: ss -ltnp | grep :${wanted}`,
      `Name a free one:    --port <n>`,
    ]);
  }
  return { port, moved: true };
}

/** The host other machines should use to reach this core. Used for printed URLs and for the UI's VITE_CORE_URL. */
export function publicHost(flags: Flags = {}): string {
  return str(flags["public-host"]) ?? process.env.FISHTEA_PUBLIC_HOST ?? lanAddress() ?? "localhost";
}

/** The port others dial, which is not the bound port when a container publishes it on another one. */
export const publicPort = (flags: Flags = {}): number =>
  Number(str(flags["public-port"]) ?? process.env.FISHTEA_PUBLIC_PORT ?? bindPort(flags));

export const publicUrl = (flags: Flags = {}): string => `http://${publicHost(flags)}:${publicPort(flags)}`;

/** The first non-internal IPv4 address, which is what someone on the same network would dial. */
export function lanAddress(): string | undefined {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  }
  return undefined;
}

/** Every address this core can be reached on, for the line printed at start-up. */
export function reachableUrls(host: string, port: number): string[] {
  if (host !== "0.0.0.0" && host !== "::") return [`http://${host}:${port}`];
  const lan = lanAddress();
  return [`http://localhost:${port}`, ...(lan ? [`http://${lan}:${port}`] : [])];
}

/** Explicit CORS origins, if the browser UI is served from somewhere the core does not answer on. */
export function corsOrigins(flags: Flags = {}): string[] | "*" | undefined {
  const raw = str(flags.cors) ?? process.env.FISHTEA_CORS_ORIGINS;
  if (!raw) return undefined;
  if (raw.trim() === "*") return "*";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Hostnames a browser might use to reach this core, so the UI on another port is allowed by default. */
export function selfHosts(flags: Flags = {}): string[] {
  const out = new Set(["localhost", "127.0.0.1", "::1"]);
  const lan = lanAddress();
  if (lan) out.add(lan);
  out.add(publicHost(flags));
  const bound = bindHost(flags);
  if (bound !== "0.0.0.0" && bound !== "::") out.add(bound);
  return [...out];
}

export const databaseUrl = (flags: Flags = {}): string =>
  str(flags.db) ?? process.env.DATABASE_URL ?? "postgres://fishtea:fishtea@localhost:5432/fishtea";
export const classifierUrl = (flags: Flags = {}): string =>
  str(flags.classifier) ?? process.env.CLASSIFIER_URL ?? "http://localhost:8081";

/** Hide the password when a connection string goes into a log line or an error. */
export const redact = (url: string): string => url.replace(/\/\/([^:/@]+):[^@]*@/, "//$1:***@");

export class SetupError extends Error {
  constructor(message: string, public fixes: string[]) { super(message); }
  print(color: { red: (s: string) => string; dim: (s: string) => string; bold: (s: string) => string }) {
    console.error(color.red(`✗ ${this.message}`));
    for (const f of this.fixes) console.error(color.dim(`  · ${f}`));
  }
}

/** Connect-and-select, so a misconfigured database says so in one clear line instead of a stack trace. */
export async function checkDatabase(url: string, opts: { appDir?: string } = {}): Promise<void> {
  const { connect } = await import("@fishtea/core");
  const db = connect(url);
  try { await db.unsafe("SELECT 1"); }
  catch (e) {
    const why = (e as Error).message.split("\n")[0];
    const target = safeTarget(url);
    throw new SetupError(`cannot reach Postgres at ${redact(url)} — ${why}`, [
      `is it running? docker run -d --name fishtea-db -e POSTGRES_USER=fishtea -e POSTGRES_PASSWORD=fishtea -e POSTGRES_DB=fishtea -p 5432:5432 ${POSTGRES_IMAGE}`,
      `or bring the whole stack up: bun run up`,
      `pointing at another machine? set DATABASE_URL in ${opts.appDir ? join(opts.appDir, ".env") : ".env"} (currently ${target})`,
      `or pass it once: --db postgres://user:pass@host:5432/fishtea`,
    ]);
  } finally { await db.end().catch(() => {}); }
}

const safeTarget = (url: string) => { try { const u = new URL(url); return `${u.hostname}:${u.port || 5432}`; } catch { return "unparseable"; } };

/**
 * Where a new application directory goes. Never inside the framework checkout: a generated app is its own
 * project with its own git history, and nesting it makes both repos confusing.
 */
export function workspaceRoot(fishteaHome: string, flags: Flags = {}): string {
  const given = str(flags.workspace) ?? process.env.FISHTEA_WORKSPACE;
  if (given) return resolve(given);
  const cwd = process.cwd();
  return isInside(cwd, fishteaHome) ? dirname(fishteaHome) : cwd;
}

export const isInside = (child: string, parent: string): boolean => {
  const c = resolve(child) + sep, p = resolve(parent) + sep;
  return c.startsWith(p) || resolve(child) === resolve(parent);
};

/** Read `key=value` pairs out of a .env file, for reporting what an app is configured to use. */
export function readEnvFile(dir: string): Record<string, string> {
  const p = join(dir, ".env");
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export const DEFAULT_APP_ID = "myapp";
