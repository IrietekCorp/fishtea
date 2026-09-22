/**
 * `fishtea upgrade` — get a newer framework, keeping the old one.
 *
 * Two sources, because there are two ways to be running this:
 *
 *   --from <checkout>   build a release from a framework checkout and install it. This is what you use
 *                       while developing the framework, and it needs nothing published anywhere.
 *   (default)           download a published release for this platform.
 *
 * Either way the new version lands beside the old one and `current` is repointed, so `fishtea use <old>`
 * is always the way back. Upgrading never touches an application: an application moves when *it* runs
 * `fishtea update`, which is a separate, reviewable step.
 */
import { existsSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FISHTEA_VERSION, compareVersions } from "@fishtea/spec";
import { RuntimeError, currentVersion, installRelease, installedVersions } from "./runtime.ts";

/** Where published releases live. Overridable so a team can host its own. */
export const releaseBase = () => process.env.FISHTEA_RELEASES ?? "https://fishtea.dev/releases";

export function hostTarget(): string {
  const os = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${os}-${arch}`;
}

/** The newest published version, as the release host reports it. */
export async function latestVersion(base = releaseBase()): Promise<string> {
  const url = `${base}/latest`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    throw new RuntimeError(`could not reach ${url} (${(e as Error).message}).\n  Build from a checkout instead: fishtea upgrade --from /path/to/fishtea`);
  }
  if (!res.ok) {
    throw new RuntimeError(
      `${url} answered ${res.status}.\n` +
      `  No releases are published at ${base} yet.\n` +
      `  Build from a checkout instead: fishtea upgrade --from /path/to/fishtea\n` +
      `  Or point at another host: FISHTEA_RELEASES=https://… fishtea upgrade`,
    );
  }
  return (await res.text()).trim();
}

/** Build a release from a framework checkout and install it. */
export async function upgradeFromCheckout(checkout: string, o: { activate?: boolean } = {}): Promise<{ version: string; from: string | null }> {
  const script = join(checkout, "scripts/build-release.ts");
  if (!existsSync(script)) throw new RuntimeError(`${checkout} is not a fishtea checkout (no scripts/build-release.ts)`);
  const was = currentVersion();
  const proc = Bun.spawn(["bun", script, ...(o.activate === false ? [] : ["--install"])], {
    cwd: checkout, stdio: ["inherit", "inherit", "inherit"],
  });
  if (await proc.exited !== 0) throw new RuntimeError("building the release failed");
  return { version: currentVersion() ?? FISHTEA_VERSION, from: was };
}

/** Download, unpack and install a published release. */
export async function upgradeFromRelease(version: string, o: { base?: string; force?: boolean } = {}): Promise<{ version: string; from: string | null }> {
  const base = o.base ?? releaseBase();
  const target = hostTarget();
  const name = `fishtea-${version}-${target}`;
  const url = `${base}/${name}.tar.gz`;

  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new RuntimeError(`${url} answered ${res.status} — is there a ${target} build of ${version}?`);

  const work = mkdtempSync(join(tmpdir(), "fishtea-upgrade-"));
  try {
    const tgz = join(work, "release.tar.gz");
    await Bun.write(tgz, res);
    const tar = Bun.spawn(["tar", "-xzf", tgz, "-C", work], { stdio: ["inherit", "inherit", "inherit"] });
    if (await tar.exited !== 0) throw new RuntimeError("unpacking the release failed");

    // The tarball holds one directory; take whatever it is called rather than assuming the name.
    const unpacked = readdirSync(work).map((f) => join(work, f)).find((p) => existsSync(join(p, "bin")));
    if (!unpacked) throw new RuntimeError(`${url} did not contain a fishtea release`);

    const was = currentVersion();
    installRelease(unpacked, version, { force: o.force });
    return { version, from: was };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Is there anything newer than what is running? */
export async function checkForUpdate(base = releaseBase()): Promise<{ latest: string; current: string; behind: boolean }> {
  const latest = await latestVersion(base);
  const current = currentVersion() ?? FISHTEA_VERSION;
  return { latest, current, behind: compareVersions(latest, current) > 0 };
}

export function renderVersions(): string {
  const all = installedVersions();
  if (!all.length) return "nothing installed under this root — `fishtea upgrade --from <checkout>` installs one";
  return all.map((v) => `${v.current ? "*" : " "} ${v.version.padEnd(12)} ${v.dir}`).join("\n");
}
