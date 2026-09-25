/**
 * The seam between the console and the CLI that owns it.
 *
 * `@fishtea/cli` imports `@fishtea/tui` — for `interview` and `tui` — so the console cannot import the
 * CLI back without a cycle. It used to dodge that with a dynamic import built from a path:
 *
 *     await import(`${fishteaHome}/packages/cli/src/new.ts`)
 *
 * which works in a source checkout and cannot work anywhere else. A compiled binary has no
 * `packages/cli/src` on disk — a release ships `templates/`, `plugins/` and `packages/ui/` beside the
 * executable and nothing else — so `fishtea new … --interactive` and the console's Onboard screen both
 * died on a missing module, naming a file that was never going to be there.
 *
 * The fix is to pass the two functions in. The CLI already has them statically, the console declares
 * what it needs, and the compiler enforces the rest.
 */
import { join } from "node:path";

export interface TemplateInfo {
  name: string;
  dir: string;
  doc: string;
  onboard: { doc?: string; questions: unknown[] };
}

export interface ScaffoldRequest {
  id: string;
  template: string;
  dir?: string;
  name?: string;
  doc?: string;
  fishteaHome: string;
  force?: boolean;
  answers?: Record<string, unknown>;
}

/** What the console needs from the CLI. Supplied by whoever launches it; never imported by path. */
export interface Scaffolder {
  listTemplates(fishteaHome: string): TemplateInfo[];
  scaffold(o: ScaffoldRequest): Promise<{ dir: string; template: string; answered: string[] }>;
}

/**
 * Is this a `bun build --compile` binary rather than a source tree?
 *
 * Measured, not assumed: in a compiled binary `Bun.main` is `/$bunfs/root/<name>` and `process.execPath`
 * is the binary; from source `Bun.main` is the entry file and `execPath` is bun itself.
 */
export const isCompiled = (main: string = Bun.main): boolean => main.startsWith("/$bunfs/");

/**
 * How to re-invoke the CLI as a subprocess.
 *
 * The console shells out for the jobs that own the terminal — headless, bench. A compiled binary must
 * re-run *itself*; only a checkout can run `bun packages/cli/src/index.ts`.
 */
export const selfCommand = (fishteaHome: string, main: string = Bun.main): string[] =>
  isCompiled(main) ? [process.execPath] : ["bun", join(fishteaHome, "packages/cli/src/index.ts")];
