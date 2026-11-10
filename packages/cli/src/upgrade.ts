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
import { existsSync, mkdtempSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FISHTEA_VERSION, compareVersions } from "@fishtea/spec";
import { RuntimeError, currentVersion, installRelease, installedVersions } from "./runtime.ts";

/** Where published releases live. Overridable so a team can host its own. */
export const releaseBase = () => process.env.FISHTEA_RELEASES ?? "https://fishtea.io/releases";

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

/**
 * The published checksums, as a map of filename → sha256.
 *
 * Absent is an empty map, and an empty map means the download cannot be checked, which upgradeFromRelease
 * refuses: the same contract as install.sh, which fails closed on the same three things.
 */
async function publishedSums(base: string): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${base}/SHA256SUMS`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return {};
    const out: Record<string, string> = {};
    for (const line of (await res.text()).split("\n")) {
      const [hash, name] = line.trim().split(/\s+/);
      if (hash && name) out[name.replace(/^\*/, "")] = hash;
    }
    return out;
  } catch { return {}; }
}

/** Download, unpack and install a published release. */
export async function upgradeFromRelease(version: string, o: { base?: string; force?: boolean } = {}): Promise<{ version: string; from: string | null }> {
  const base = o.base ?? releaseBase();
  const target = hostTarget();
  const name = `fishtea-${version}-${target}`;
  const url = `${base}/${name}.tar.gz`;

  const sums = await publishedSums(base);

  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new RuntimeError(`${url} answered ${res.status} — is there a ${target} build of ${version}?`);

  const work = mkdtempSync(join(tmpdir(), "fishtea-upgrade-"));
  try {
    const tgz = join(work, "release.tar.gz");
    await Bun.write(tgz, res);

    // Same contract as install.sh: a mismatch is fatal, and so is having nothing to check against, unless
    // a self-hosted mirror that publishes no checksums says so with FISHTEA_INSECURE_DOWNLOAD=1.
    const want = sums[`${name}.tar.gz`];
    if (want) {
      const got = createHash("sha256").update(readFileSync(tgz)).digest("hex");
      if (got !== want) {
        throw new RuntimeError(`checksum mismatch for ${name}.tar.gz\n  expected ${want}\n  got      ${got}\n  Refusing to install.`);
      }
    } else if (process.env.FISHTEA_INSECURE_DOWNLOAD === "1") {
      console.error(`⚠ no checksum published for ${name}.tar.gz — installing unverified (FISHTEA_INSECURE_DOWNLOAD=1)`);
    } else {
      throw new RuntimeError(`no checksum published for ${name}.tar.gz at ${base}/SHA256SUMS\n  Refusing to install what cannot be checked. FISHTEA_INSECURE_DOWNLOAD=1 overrides this for a self-hosted mirror.`);
    }
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
