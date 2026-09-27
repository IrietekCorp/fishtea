/**
 * The pool's own unit tests are Python, because the pool is. This runs them.
 *
 * Skips rather than fails without python3: the classifier is a service, and a machine that cannot run
 * it should not fail a suite it was never able to run — the same rule the needle and browser tests use.
 */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const HERE = resolve(import.meta.dir);
const SUITE = join(HERE, "handler_test.py");

describe("the needle pool's HTTP handler", () => {
  test("its Python unit tests pass", async () => {
    expect(existsSync(SUITE)).toBe(true);
    const proc = Bun.spawn(["python3", SUITE], { stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (code === 127) return;                          // no python3 here: skip, do not fail
    expect({ code, out: `${out}${err}` }).toEqual({ code: 0, out: expect.stringContaining("OK") });
  });
});
