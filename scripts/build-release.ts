#!/usr/bin/env bun
/**
 * `bun run build-release` — compile the framework into something installable.
 *
 *   bun run build-release                    this machine's target, into dist/
 *   bun run build-release --target linux-x64 --target darwin-arm64
 *   bun run build-release --install          build, then install it into ~/.fishtea and make it current
 *   bun run build-release --tarball          also produce dist/fishtea-<version>-<target>.tar.gz
 *
 * A release is a binary *and* the files the framework reads at runtime: `templates/` (archetypes),
 * `plugins/` (the builtin ones), `packages/ui/` (the browser bundle's source, which Compose builds), and
 * the Dockerfiles. `bun build --compile` embeds code, not data directories, so the layout is:
 *
 *   <release>/bin/fishtea        the compiled CLI, which resolves its home two levels up
 *   <release>/templates/ plugins/ packages/ui/ …
 *
 * That is exactly the shape runtime.ts installs, so `--install` is a copy and a symlink.
 */
import { existsSync, mkdirSync, rmSync, cpSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { currentVersion } from "../packages/cli/src/runtime.ts";
import { installRelease } from "../packages/cli/src/runtime.ts";

const HOME = resolve(dirname(new URL(import.meta.url).pathname), "..");
const VERSION = readFileSync(join(HOME, "packages/spec/src/release.ts"), "utf8").match(/FISHTEA_VERSION = "([^"]+)"/)![1];

/** Bun's cross-compile targets we publish for. `bun build --compile --target=bun-<t>`. */
export const TARGETS = ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "windows-x64"] as const;
export type Target = (typeof TARGETS)[number];

export function hostTarget(): Target {
  const os = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `${os}-${arch}` as Target;
}

/** Runtime data a compiled binary cannot contain but the framework reads. */
const RUNTIME_FILES = ["templates", "plugins", "packages/ui", "Dockerfile.core", "Dockerfile.classifier", "packages/classifier", "docker-compose.yml"];

export async function build(target: Target, o: { outDir: string; quiet?: boolean } = { outDir: join(HOME, "dist") }): Promise<string> {
  const staged = join(o.outDir, `fishtea-${VERSION}-${target}`);
  rmSync(staged, { recursive: true, force: true });
  mkdirSync(join(staged, "bin"), { recursive: true });

  const exe = join(staged, "bin", target.startsWith("windows") ? "fishtea.exe" : "fishtea");
  const proc = Bun.spawn([
    "bun", "build", "--compile",
    `--target=bun-${target}`,
    join(HOME, "packages/cli/src/index.ts"),
    "--outfile", exe,
  ], { cwd: HOME, stdio: ["inherit", o.quiet ? "pipe" : "inherit", "inherit"] });
  if (await proc.exited !== 0) throw new Error(`compiling for ${target} failed`);

  for (const rel of RUNTIME_FILES) {
    const from = join(HOME, rel);
    if (!existsSync(from)) continue;
    // node_modules is not shipped: the browser bundle is built where it is deployed.
    cpSync(from, join(staged, rel), {
      recursive: true,
      filter: (src) => !src.includes("node_modules") && !src.includes("/.venv") && !src.endsWith("/dist"),
    });
  }
  writeFileSync(join(staged, "VERSION"), VERSION + "\n");
  writeFileSync(join(staged, "TARGET"), target + "\n");
  return staged;
}

async function tarball(staged: string): Promise<string> {
  const out = `${staged}.tar.gz`;
  const proc = Bun.spawn(["tar", "-czf", out, "-C", dirname(staged), staged.split("/").pop()!], { stdio: ["inherit", "inherit", "inherit"] });
  if (await proc.exited !== 0) throw new Error("tar failed");
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const targets = args.reduce<Target[]>((acc, a, i) => (a === "--target" && args[i + 1] ? [...acc, args[i + 1] as Target] : acc), []);
  const chosen = targets.length ? targets : [hostTarget()];
  for (const t of chosen) {
    if (!TARGETS.includes(t)) throw new Error(`unknown target "${t}" — one of ${TARGETS.join(", ")}`);
  }

  const outDir = join(HOME, "dist");
  mkdirSync(outDir, { recursive: true });
  for (const target of chosen) {
    const staged = await build(target, { outDir });
    const size = (await Bun.file(join(staged, "bin", target.startsWith("windows") ? "fishtea.exe" : "fishtea")).arrayBuffer()).byteLength;
    console.log(`✓ ${target.padEnd(14)} ${staged}  (binary ${(size / 1e6).toFixed(0)} MB)`);
    if (args.includes("--tarball")) console.log(`  ${await tarball(staged)}`);
    if (args.includes("--install")) {
      if (target !== hostTarget()) { console.log(`  skipping --install: ${target} is not this machine`); continue; }
      const was = currentVersion();
      installRelease(staged, VERSION, { force: true });
      console.log(`  installed ${VERSION}${was && was !== VERSION ? ` (was ${was}; fishtea use ${was} goes back)` : ""}`);
    }
  }
}
