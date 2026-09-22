/**
 * The installed runtime: several framework versions side by side, and one of them current.
 *
 *   ~/.fishtea/
 *     versions/1.1.0/        a whole framework: bin/fishtea, templates/, plugins/, packages/ui/
 *     versions/1.2.0/
 *     current -> versions/1.2.0
 *     bin/fishtea -> ../current/bin/fishtea      ← the only thing on PATH
 *
 * Switching version is repointing one symlink, which is what makes `use` instant and, more importantly,
 * makes going *back* instant. A framework you cannot downgrade is a framework you are afraid to upgrade.
 *
 * Nothing here deletes an old version on upgrade. Disk is cheap; a bad release at 2am is not.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, unlinkSync, readlinkSync, statSync, cpSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { compareVersions } from "@fishtea/spec";

/** Where versions live. FISHTEA_ROOT overrides, which is how the tests get a throwaway one. */
export function installRoot(): string {
  return resolve(process.env.FISHTEA_ROOT ?? join(homedir(), ".fishtea"));
}

export const versionsDir = (root = installRoot()) => join(root, "versions");
export const currentLink = (root = installRoot()) => join(root, "current");
export const shimPath = (root = installRoot()) => join(root, "bin", "fishtea");

export interface InstalledVersion { version: string; dir: string; current: boolean }

/** Every installed version, newest first. */
export function installedVersions(root = installRoot()): InstalledVersion[] {
  const dir = versionsDir(root);
  if (!existsSync(dir)) return [];
  const active = currentVersion(root);
  return readdirSync(dir)
    .filter((v) => statSync(join(dir, v)).isDirectory())
    .sort((a, b) => compareVersions(b, a))
    .map((version) => ({ version, dir: join(dir, version), current: version === active }));
}

/** Which version `current` points at, or null when nothing is installed. */
export function currentVersion(root = installRoot()): string | null {
  const link = currentLink(root);
  if (!existsSync(link)) return null;
  try { return basename(readlinkSync(link)); } catch { return basename(link); }
}

export class RuntimeError extends Error {}

/** Point `current` at an installed version, and make sure the PATH shim points at `current`. */
export function useVersion(version: string, root = installRoot()): string {
  const target = join(versionsDir(root), version);
  if (!existsSync(target)) {
    const have = installedVersions(root).map((v) => v.version);
    throw new RuntimeError(`${version} is not installed${have.length ? ` — have: ${have.join(", ")}` : ""}`);
  }
  const link = currentLink(root);
  // Replace rather than mutate: an interrupted upgrade should leave either the old link or none, never
  // a half-written one.
  if (existsSync(link) || isLink(link)) unlinkSync(link);
  symlinkSync(target, link, "dir");
  linkShim(root);
  return target;
}

function isLink(p: string): boolean {
  try { readlinkSync(p); return true; } catch { return false; }
}

/** `~/.fishtea/bin/fishtea` → `../current/bin/fishtea`. Relative, so the whole root stays movable. */
export function linkShim(root = installRoot()): string {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const shim = join(bin, "fishtea");
  if (existsSync(shim) || isLink(shim)) unlinkSync(shim);
  symlinkSync(join("..", "current", "bin", "fishtea"), shim, "file");
  return shim;
}

/** What a staged release must contain before we will install it. */
export const RELEASE_CONTENTS = ["bin/fishtea", "templates", "plugins"] as const;

export function checkRelease(dir: string): string[] {
  return RELEASE_CONTENTS.filter((p) => !existsSync(join(dir, p))).map((p) => `missing ${p}`);
}

/**
 * Install a staged release directory as `version`. Refuses to overwrite an existing version unless asked:
 * two different builds answering to one version number is the kind of thing that wastes an afternoon.
 */
export function installRelease(staged: string, version: string, o: { root?: string; force?: boolean; activate?: boolean } = {}): string {
  const root = o.root ?? installRoot();
  const problems = checkRelease(staged);
  if (problems.length) throw new RuntimeError(`${staged} is not a fishtea release: ${problems.join(", ")}`);

  const target = join(versionsDir(root), version);
  if (existsSync(target)) {
    if (!o.force) throw new RuntimeError(`${version} is already installed (${target}) — pass --force to replace it`);
    rmSync(target, { recursive: true, force: true });
  }
  mkdirSync(versionsDir(root), { recursive: true });
  cpSync(staged, target, { recursive: true, dereference: true });
  if (o.activate !== false) useVersion(version, root);
  return target;
}

/** Remove an installed version. The current one is protected: switch away first, deliberately. */
export function removeVersion(version: string, root = installRoot()): void {
  if (currentVersion(root) === version) {
    throw new RuntimeError(`${version} is the current version — fishtea use <other> first`);
  }
  const target = join(versionsDir(root), version);
  if (!existsSync(target)) throw new RuntimeError(`${version} is not installed`);
  rmSync(target, { recursive: true, force: true });
}

/** Is `~/.fishtea/bin` actually on PATH? Being installed but unreachable is a confusing state. */
export function shimOnPath(root = installRoot(), path = process.env.PATH ?? ""): boolean {
  const bin = join(root, "bin");
  return path.split(":").some((p) => resolve(p) === bin);
}
