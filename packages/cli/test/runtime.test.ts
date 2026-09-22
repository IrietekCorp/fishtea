/**
 * The installed runtime: several versions side by side, one current, switching by symlink.
 *
 * The property worth protecting is that going *back* is as cheap as going forward. A framework you cannot
 * downgrade is one you are afraid to upgrade, so the rollback paths are tested as carefully as the
 * install paths, and the current version is protected from being removed out from under itself.
 *
 * These build no binaries — compiling takes minutes across targets and proves nothing about the layout.
 * A staged release is a directory with `bin/fishtea`, `templates/` and `plugins/` in it, and that is
 * exactly what these fake.
 */
import { describe, expect, test, afterAll, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RuntimeError, checkRelease, currentVersion, installRelease, installedVersions, linkShim,
  removeVersion, shimOnPath, shimPath, useVersion, versionsDir,
} from "../src/runtime.ts";
import { hostTarget } from "../src/upgrade.ts";

const roots: string[] = [];
const scratch = () => { const d = mkdtempSync(join(tmpdir(), "fishtea-runtime-")); roots.push(d); return d; };
afterAll(() => { for (const d of roots) rmSync(d, { recursive: true, force: true }); });

/** A staged release directory that looks like the real thing without costing a compile. */
function stage(version: string, o: { broken?: boolean } = {}): string {
  const dir = join(scratch(), "staged");
  mkdirSync(join(dir, "bin"), { recursive: true });
  mkdirSync(join(dir, "templates/blank"), { recursive: true });
  if (!o.broken) mkdirSync(join(dir, "plugins"), { recursive: true });
  writeFileSync(join(dir, "bin/fishtea"), `#!/bin/sh\necho ${version}\n`);
  writeFileSync(join(dir, "VERSION"), version + "\n");
  return dir;
}

let root: string;
beforeEach(() => { root = scratch(); });

describe("staging", () => {
  test("a release must have a binary, templates and plugins", () => {
    expect(checkRelease(stage("1.0.0"))).toEqual([]);
    expect(checkRelease(stage("1.0.0", { broken: true }))).toEqual(["missing plugins"]);
  });

  test("an incomplete release is refused rather than half-installed", () => {
    expect(() => installRelease(stage("1.0.0", { broken: true }), "1.0.0", { root })).toThrow(RuntimeError);
    expect(existsSync(join(versionsDir(root), "1.0.0"))).toBe(false);
  });
});

describe("installing", () => {
  test("installing makes it current and links the shim", () => {
    installRelease(stage("1.1.0"), "1.1.0", { root });
    expect(currentVersion(root)).toBe("1.1.0");
    expect(existsSync(shimPath(root))).toBe(true);
    // The shim points at `current`, not at a version, so switching never rewrites it.
    expect(readlinkSync(shimPath(root))).toBe(join("..", "current", "bin", "fishtea"));
  });

  test("installing over an existing version needs --force", () => {
    installRelease(stage("1.1.0"), "1.1.0", { root });
    expect(() => installRelease(stage("1.1.0"), "1.1.0", { root })).toThrow(/already installed/);
    expect(() => installRelease(stage("1.1.0"), "1.1.0", { root, force: true })).not.toThrow();
  });

  test("activate:false installs without switching", () => {
    installRelease(stage("1.1.0"), "1.1.0", { root });
    installRelease(stage("1.2.0"), "1.2.0", { root, activate: false });
    expect(currentVersion(root)).toBe("1.1.0");
    expect(installedVersions(root).map((v) => v.version)).toEqual(["1.2.0", "1.1.0"]);
  });
});

describe("switching", () => {
  beforeEach(() => {
    installRelease(stage("1.1.0"), "1.1.0", { root });
    installRelease(stage("1.2.0"), "1.2.0", { root });
  });

  test("versions are listed newest first, with the current one marked", () => {
    const all = installedVersions(root);
    expect(all.map((v) => v.version)).toEqual(["1.2.0", "1.1.0"]);
    expect(all.find((v) => v.current)!.version).toBe("1.2.0");
  });

  test("ordering is numeric, not lexical", () => {
    installRelease(stage("1.10.0"), "1.10.0", { root, activate: false });
    expect(installedVersions(root).map((v) => v.version)).toEqual(["1.10.0", "1.2.0", "1.1.0"]);
  });

  test("downgrading and upgrading are the same one-symlink move", () => {
    useVersion("1.1.0", root);
    expect(currentVersion(root)).toBe("1.1.0");
    expect(readFileSync(join(root, "current/VERSION"), "utf8").trim()).toBe("1.1.0");
    useVersion("1.2.0", root);
    expect(currentVersion(root)).toBe("1.2.0");
    expect(readFileSync(join(root, "current/VERSION"), "utf8").trim()).toBe("1.2.0");
  });

  test("switching to something not installed says what is", () => {
    expect(() => useVersion("9.9.9", root)).toThrow(/have: 1.2.0, 1.1.0/);
  });

  test("the shim survives switching", () => {
    useVersion("1.1.0", root);
    expect(readlinkSync(shimPath(root))).toBe(join("..", "current", "bin", "fishtea"));
  });
});

describe("removing", () => {
  beforeEach(() => {
    installRelease(stage("1.1.0"), "1.1.0", { root });
    installRelease(stage("1.2.0"), "1.2.0", { root });
  });

  test("an old version can be removed", () => {
    removeVersion("1.1.0", root);
    expect(installedVersions(root).map((v) => v.version)).toEqual(["1.2.0"]);
  });

  test("the current version is protected", () => {
    expect(() => removeVersion("1.2.0", root)).toThrow(/is the current version/);
    expect(currentVersion(root)).toBe("1.2.0");
  });

  test("upgrading never removes what it replaced", () => {
    installRelease(stage("1.3.0"), "1.3.0", { root });
    expect(installedVersions(root).map((v) => v.version)).toEqual(["1.3.0", "1.2.0", "1.1.0"]);
  });
});

describe("reporting", () => {
  test("an empty root has no versions and no current", () => {
    expect(installedVersions(root)).toEqual([]);
    expect(currentVersion(root)).toBeNull();
  });

  test("PATH is checked against the shim directory, not guessed", () => {
    linkShim(root);
    expect(shimOnPath(root, `/usr/bin:${join(root, "bin")}:/bin`)).toBe(true);
    expect(shimOnPath(root, "/usr/bin:/bin")).toBe(false);
  });

  test("the host target is one the build script publishes for", () => {
    expect(["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "windows-x64"]).toContain(hostTarget());
  });
});
