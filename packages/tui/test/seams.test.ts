/**
 * The console must not assume it is running from a source checkout.
 *
 * `fishtea new … --interactive` died in the installed binary with
 *
 *     Cannot find module '~/.fishtea/versions/1.1.0/packages/cli/src/new.ts'
 *
 * because the console imported the CLI by path — `await import(`${fishteaHome}/packages/cli/src/new.ts`)`
 * — to dodge the cycle created by @fishtea/cli importing @fishtea/tui. That works in a checkout and can
 * never work in a release, which ships templates/, plugins/ and packages/ui/ beside the executable and
 * no source at all.
 *
 * These tests are cheap and source-level on purpose. The honest end-to-end check is to compile and drive
 * the binary through a pty, which is minutes; this catches the same class in milliseconds, and the class
 * is "somebody reached for a path when they meant a dependency".
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { isCompiled, selfCommand } from "../src/lib/scaffolder.ts";

const SRC = resolve(import.meta.dir, "../src");

const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("nothing in the console reaches for the framework's source", () => {
  test("no dynamic import is built from a path", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      // Comments are stripped first: scaffolder.ts quotes the offending line to explain the rule.
      const code = stripComments(readFileSync(file, "utf8"));
      // import(`...${x}...`) — a specifier assembled at run time cannot be bundled.
      for (const m of code.matchAll(/\bimport\(\s*`[^`]*\$\{/g)) {
        offenders.push(`${file.slice(SRC.length + 1)}: ${code.slice(m.index!, m.index! + 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("nothing names packages/cli/src, which a release does not ship", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      // scaffolder.ts is the single place allowed to know it: selfCommand's source-checkout branch.
      // Keeping the knowledge in one file is the whole point, so the test pins it to one file.
      if (file.endsWith("lib/scaffolder.ts")) continue;
      const code = stripComments(readFileSync(file, "utf8"));
      if (code.includes("packages/cli/src")) offenders.push(file.slice(SRC.length + 1));
    }
    expect(offenders).toEqual([]);
  });
});

describe("re-invoking the CLI", () => {
  test("from source it runs bun against the entry file", () => {
    // The suite itself runs from source, so this is the branch under test here.
    expect(isCompiled()).toBe(false);
    expect(selfCommand("/home/x/fishtea", "/home/x/fishtea/packages/cli/src/index.ts"))
      .toEqual(["bun", "/home/x/fishtea/packages/cli/src/index.ts"]);
  });

  test("compiled, it re-runs the executable itself", () => {
    // Bun.main is read-only, so both take it as an argument. The value below is not a guess: a probe
    // compiled with `bun build --compile` reports Bun.main as "/$bunfs/root/<name>" and process.execPath
    // as the binary, where from source they are the entry file and bun itself.
    expect(isCompiled("/$bunfs/root/fishtea")).toBe(true);
    expect(selfCommand("/anything", "/$bunfs/root/fishtea")).toEqual([process.execPath]);
  });
});
