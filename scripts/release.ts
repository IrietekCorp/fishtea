#!/usr/bin/env bun
/**
 * `bun run release <version>` — move the framework to a new version in one atomic edit.
 *
 * Six places have to agree or the pin/update machinery starts lying: the literal in
 * packages/spec/src/release.ts, the root package.json, and every workspace package.json. This script is the
 * only thing that should ever write them, and it verifies the result rather than trusting itself.
 *
 * bun.lock is the seventh, and it was missed for six releases: it repeats each workspace member's version,
 * `bun install` rewrites it from package.json, and nothing here re-ran that — so the committed lockfile
 * still said 1.1.0 and every clone's first `bun install` came back with a dirty tree. (It never broke a
 * build: `--frozen-lockfile` does not treat a workspace member's version as a constraint. It is noise, and
 * noise in `git status` is where real changes go to hide.) So the bump regenerates it and --check reads it.
 *
 *   bun run release 1.2.0            set the version
 *   bun run release 1.2.0 --dry-run  show what would change
 *   bun run release --check          verify everything already agrees (used by the test suite and CI)
 *
 * It deliberately does *not* publish, tag or push. Releasing is:
 *   bun run release <v> && bun test packages && git commit -am "..." && git tag v<v> && bun run publish-all
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const HOME = resolve(dirname(new URL(import.meta.url).pathname), "..");
const RELEASE_TS = join(HOME, "packages/spec/src/release.ts");
const LOCK = join(HOME, "bun.lock");

const packageJsons = (): string[] => {
  const out = [join(HOME, "package.json")];
  for (const d of readdirSync(join(HOME, "packages"))) {
    const p = join(HOME, "packages", d, "package.json");
    if (existsSync(p)) out.push(p);
  }
  return out;
};

export function currentVersion(): string {
  const m = readFileSync(RELEASE_TS, "utf8").match(/export const FISHTEA_VERSION = "([^"]+)"/);
  if (!m) throw new Error("packages/spec/src/release.ts no longer declares FISHTEA_VERSION");
  return m[1];
}

/** The workspace members whose version is the framework version (the root and packages/ui are not). */
const published = (): { dir: string; path: string }[] =>
  packageJsons()
    .filter((p) => p !== join(HOME, "package.json") && !JSON.parse(readFileSync(p, "utf8")).private)
    .map((p) => ({ dir: p.slice(HOME.length + 1).replace(/\/package\.json$/, ""), path: p }));

/**
 * What bun.lock says each workspace member's version is. The lockfile is generated, so this reads it
 * rather than parsing it as JSON (it is JSONC — trailing commas), and it insists on finding every
 * member: a site that quietly stops being checked is worse than one that was never checked.
 */
export function lockSites(lockText?: string): { where: string; version: string }[] {
  if (lockText === undefined && !existsSync(LOCK)) return [];
  const src = lockText ?? readFileSync(LOCK, "utf8");
  return published().map(({ dir }) => {
    // [^}]*? refuses to run past the end of this member's block, so a match is this member's own version
    const m = src.match(new RegExp(`"${dir}": \\{[^}]*?"version": "([^"]+)"`));
    if (!m) throw new Error(`bun.lock has no version for the workspace member ${dir} — regenerate it with \`bun install --lockfile-only\``);
    return { where: `bun.lock (${dir})`, version: m[1] };
  });
}

/** Every version string that is supposed to be the framework version, with where it lives. */
export function versionSites(): { where: string; version: string }[] {
  const sites = [{ where: "packages/spec/src/release.ts", version: currentVersion() }];
  for (const p of packageJsons()) {
    const pkg = JSON.parse(readFileSync(p, "utf8"));
    // packages/ui is the browser bundle: it ships with an application, not to a registry, so it is exempt.
    if (pkg.private && pkg.name !== "fishtea") continue;
    sites.push({ where: p.slice(HOME.length + 1), version: pkg.version });
  }
  return [...sites, ...lockSites()];
}

/** Rewrite bun.lock from the package.json files just written. No network, no node_modules touched. */
function regenerateLock(): void {
  const r = Bun.spawnSync(["bun", "install", "--lockfile-only"], { cwd: HOME, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) {
    throw new Error(`bun install --lockfile-only failed, so bun.lock still names the old version:\n${new TextDecoder().decode(r.stderr)}`);
  }
}

export function check(): { ok: boolean; version: string; disagree: { where: string; version: string }[] } {
  const sites = versionSites();
  const version = sites[0].version;
  return { ok: sites.every((s) => s.version === version), version, disagree: sites.filter((s) => s.version !== version) };
}

function setVersion(next: string, dryRun: boolean) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(next)) throw new Error(`"${next}" is not a semver version`);
  const changes: string[] = [];

  const src = readFileSync(RELEASE_TS, "utf8");
  const updated = src.replace(/(export const FISHTEA_VERSION = ")[^"]+(")/, `$1${next}$2`);
  if (updated !== src) { changes.push(`packages/spec/src/release.ts  FISHTEA_VERSION → ${next}`); if (!dryRun) writeFileSync(RELEASE_TS, updated); }

  for (const p of packageJsons()) {
    const raw = readFileSync(p, "utf8");
    const pkg = JSON.parse(raw);
    if (pkg.private && pkg.name !== "fishtea") continue;
    if (pkg.version === next) continue;
    changes.push(`${p.slice(HOME.length + 1).padEnd(34)} ${pkg.version} → ${next}`);
    pkg.version = next;
    if (!dryRun) writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
  }

  const lockStale = lockSites().filter((s) => s.version !== next);
  if (lockStale.length) {
    changes.push(`bun.lock${" ".repeat(26)} ${lockStale[0].version} → ${next}  (${lockStale.length} workspace member${lockStale.length === 1 ? "" : "s"})`);
    if (!dryRun) regenerateLock();
  }

  if (!changes.length) { console.log(`already at ${next}`); return; }
  for (const c of changes) console.log(`  ${c}`);
  console.log(dryRun ? `\n--dry-run: nothing written` : `\n✓ framework is now ${next}`);
  if (!dryRun) console.log(`  next: bun test packages && git commit -am "Release ${next}" && git tag v${next}`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    const r = check();
    if (r.ok) console.log(`✓ every version site agrees: ${r.version}`);
    else { console.error(`✗ version sites disagree (expected ${r.version}):`); for (const d of r.disagree) console.error(`    ${d.where}  ${d.version}`); process.exit(1); }
  } else {
    const next = args.find((a) => !a.startsWith("--"));
    if (!next) { console.log(`fishtea is ${currentVersion()}\n\n  bun run release <version> [--dry-run]\n  bun run release --check`); process.exit(0); }
    setVersion(next, args.includes("--dry-run"));
  }
}
