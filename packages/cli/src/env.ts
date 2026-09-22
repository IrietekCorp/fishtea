/**
 * Where things live on the network, and where new applications go on disk.
 *
 * Nothing here assumes localhost. A stack can have its Postgres on one host, its classifier pool on another
 * and its core bound to every interface; each is a flag, then an environment variable, then a default.
 */
import { networkInterfaces } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

export type Flags = Record<string, string | boolean | undefined>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length ? v : undefined);

/** The address the core binds. 0.0.0.0 by default so the stack is reachable from other machines. */
export const bindHost = (flags: Flags = {}): string => str(flags.host) ?? process.env.FISHTEA_HOST ?? "0.0.0.0";
export const bindPort = (flags: Flags = {}): number => Number(str(flags.port) ?? process.env.PORT ?? 3000);

/** The host other machines should use to reach this core. Used for printed URLs and for the UI's VITE_CORE_URL. */
export function publicHost(flags: Flags = {}): string {
  return str(flags["public-host"]) ?? process.env.FISHTEA_PUBLIC_HOST ?? lanAddress() ?? "localhost";
}

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
      `is it running? docker run -d --name fishtea-db -e POSTGRES_USER=fishtea -e POSTGRES_PASSWORD=fishtea -e POSTGRES_DB=fishtea -p 5432:5432 pgvector/pgvector:pg18`,
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
