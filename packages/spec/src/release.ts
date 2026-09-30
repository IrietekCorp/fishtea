/**
 * Three versions, and what each one answers.
 *
 *   FISHTEA_VERSION  the framework build — semver, what `fishtea --version` prints, what an application
 *                    pins a range against. Bumped by `fishtea release`, which rewrites every package.json
 *                    in the workspace and the literal below in one move.
 *   SPEC_FORMAT      the *document* format of spec.json (`spec.fishtea`), major.minor only. It moves when
 *                    the vocabulary changes shape, which is far less often than the code does. Migrations
 *                    in migrate.ts key off this, never off the framework version.
 *   spec.business.version  the business's own revision ("2026.09.21-1"). Not our concern here.
 *
 * Keeping the first two apart is what lets a patch release ship without touching a single application's
 * spec, and lets one spec migration serve a dozen framework releases.
 */

/** The framework build. `fishtea release <version>` is the only thing that should edit this line. */
export const FISHTEA_VERSION = "1.2.0";

/** The spec document format this build writes. Specs at an older format are migrated on `fishtea update`. */
export const SPEC_FORMAT = "1.1";

/** Every spec format this build can load without migrating first. */
export const SUPPORTED_SPEC_FORMATS = ["1.0", "1.1"] as const;

/**
 * Compare two semver strings. Bun has this built in (`Bun.semver.order`), and we use it when we are running
 * under Bun — which is always, in practice. The fallback keeps `@fishtea/spec` importable from plain node
 * tooling (an editor's type server, a doc generator) without pulling in a semver dependency.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const bun = (globalThis as any).Bun;
  if (bun?.semver?.order) return bun.semver.order(a, b);
  const parts = (v: string) => v.replace(/^v/, "").split("-")[0].split(".").map((n) => Number(n) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) > (y[i] ?? 0)) return 1;
    if ((x[i] ?? 0) < (y[i] ?? 0)) return -1;
  }
  return 0;
}

/**
 * Does `version` satisfy `range`? Delegates to Bun.semver, which understands the whole npm grammar
 * (^, ~, ||, x, ranges). The fallback handles the two forms we actually write into a generated
 * package.json — `^1.2.3` and an exact pin — and is deliberately conservative about anything else.
 */
export function satisfies(version: string, range: string): boolean {
  const bun = (globalThis as any).Bun;
  if (bun?.semver?.satisfies) return bun.semver.satisfies(version, range);
  const r = range.trim();
  if (r === "*" || r === "") return true;
  if (r.startsWith("^")) {
    const base = r.slice(1);
    const [vMaj] = version.split(".");
    const [bMaj] = base.split(".");
    return vMaj === bMaj && compareVersions(version, base) >= 0;
  }
  return version === r;
}

/** `^1.4.2` for a release, so an application picks up minor and patch updates but never a major. */
export function caretRange(version: string): string {
  return `^${version}`;
}

/** major.minor of a semver, which is the granularity a spec format moves at. */
export function formatOf(version: string): string {
  const [maj, min] = version.split(".");
  return `${maj}.${min}`;
}

/**
 * Which side is stale. Named from the framework's point of view and spelled out, because "too old" on its
 * own is ambiguous in exactly the place it matters — and the two have opposite fixes:
 *
 *   framework-behind   the application wants a newer framework than this  → upgrade the framework
 *   framework-ahead    this framework has moved past the application's pin → run `fishtea update`
 */
export type Compatibility =
  | { ok: true; reason: "satisfied" }
  | { ok: false; reason: "framework-behind" | "framework-ahead"; want: string; have: string };

/** Can this framework build run an application that pinned `range`? */
export function checkCompatibility(range: string | undefined, have = FISHTEA_VERSION): Compatibility {
  if (!range) return { ok: true, reason: "satisfied" };
  if (satisfies(have, range)) return { ok: true, reason: "satisfied" };
  const floor = range.replace(/^[\^~>=<\s]+/, "").split(/[\s|]/)[0];
  const behind = floor ? compareVersions(have, floor) < 0 : false;
  return { ok: false, reason: behind ? "framework-behind" : "framework-ahead", want: range, have };
}
