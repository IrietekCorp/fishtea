#!/usr/bin/env bun
/**
 * `bun run deps` — every layer FishTea stands on, what it is pinned to, what is newer, and how to move it.
 *
 * The framework is a stack of other people's work: Bun underneath, Postgres with pgvector beside it, the
 * needle classifier in Python, the web and style packages from npm (Hono, React, Vite, Tailwind), and
 * components adapted from shadcn/ui and 21st.dev. Each layer moves on its own schedule, and each one has a
 * different way of being wrong when it does. This is the one place that knows all of them.
 *
 *   bun run deps                        report every layer (needs the network)
 *   bun run deps bun 1.4.3              move Bun: env.ts, .bun-version and Dockerfile.core, together
 *   bun run deps postgres <image>       move Postgres: env.ts and every file that names the image
 *   bun run deps classifier 3.2.10      move cactus-needle in requirements.txt
 *   bun run deps npm <pkg>[@range]      move an npm package in every workspace that declares it
 *   bun run deps components --record    after porting an upstream change, record what upstream now is
 *
 * Moving a pin never runs the gates for you; it prints them, because each layer's are different and some
 * (a classifier eval, a dump and restore) are not things a script should decide were fine. Like
 * `bun run release`, it never commits, tags or pushes.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const HOME = resolve(import.meta.dir, "..");

// ── pins ──────────────────────────────────────────────────────────────────────

/** Every file that names the Postgres image. env.ts holds it; the rest cannot import it (scripts/postgres.test.ts). */
export const POSTGRES_SITES = ["packages/cli/src/env.ts", "docker-compose.yml", ".github/workflows/ci.yml", "CLAUDE.md", "README.md", "CONTRIBUTING.md"];

const read = (root: string, rel: string) => readFileSync(join(root, rel), "utf8");

export function bunPin(root = HOME): string {
  const m = read(root, "packages/cli/src/env.ts").match(/export const BUN_VERSION = "([^"]+)"/);
  if (!m) throw new Error("packages/cli/src/env.ts no longer declares BUN_VERSION");
  return m[1];
}

export function postgresPin(root = HOME): string {
  const m = read(root, "packages/cli/src/env.ts").match(/export const POSTGRES_IMAGE = "([^"]+)"/);
  if (!m) throw new Error("packages/cli/src/env.ts no longer declares POSTGRES_IMAGE");
  return m[1];
}

export function classifierPin(root = HOME): string {
  const m = read(root, "packages/classifier/requirements.txt").match(/^cactus-needle==(\S+)$/m);
  if (!m) throw new Error("packages/classifier/requirements.txt no longer pins cactus-needle exactly");
  return m[1];
}

/** A rewrite that must find what it replaces: a pin site that quietly stops matching is how drift starts. */
function rewrite(root: string, rel: string, from: string | RegExp, to: string): void {
  const src = read(root, rel);
  const out = src.replace(from as any, to);
  if (out === src) throw new Error(`${rel}: found nothing to move (${String(from)})`);
  writeFileSync(join(root, rel), out);
}

export function setBun(version: string, root = HOME): string[] {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Bun is pinned to an exact version, not "${version}"`);
  const was = bunPin(root);
  if (was === version) return [];
  rewrite(root, "packages/cli/src/env.ts", `export const BUN_VERSION = "${was}"`, `export const BUN_VERSION = "${version}"`);
  rewrite(root, ".bun-version", was, version);
  rewrite(root, "Dockerfile.core", `ARG BUN_VERSION=${was}`, `ARG BUN_VERSION=${version}`);
  return ["packages/cli/src/env.ts", ".bun-version", "Dockerfile.core"];
}

export function setPostgres(image: string, root = HOME): string[] {
  if (!/^pgvector\/pgvector:\d+\.\d+\.\d+-pg\d+(-\w+)?$/.test(image)) throw new Error(`"${image}" is not an exact pgvector tag (pgvector/pgvector:<pgvector>-pg<major>-<debian>)`);
  const was = postgresPin(root);
  if (was === image) return [];
  const touched: string[] = [];
  for (const rel of POSTGRES_SITES) {
    if (!existsSync(join(root, rel)) || !read(root, rel).includes(was)) continue;
    rewrite(root, rel, new RegExp(was.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), image);
    touched.push(rel);
  }
  return touched;
}

export function setClassifier(version: string, root = HOME): string[] {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`cactus-needle is pinned to an exact version, not "${version}"`);
  const was = classifierPin(root);
  if (was === version) return [];
  rewrite(root, "packages/classifier/requirements.txt", `cactus-needle==${was}`, `cactus-needle==${version}`);
  return ["packages/classifier/requirements.txt"];
}

export const major = (v: string) => Number(v.match(/(\d+)/)?.[1] ?? NaN);
export const pgMajor = (image: string) => Number(image.match(/-pg(\d+)/)?.[1] ?? NaN);

// ── npm ───────────────────────────────────────────────────────────────────────

/** Which layer an npm package belongs to, so the report reads as a stack and not as a list. */
const NPM_LAYER: [RegExp, string][] = [
  [/^(tailwindcss|@tailwindcss\/.*|tailwind-merge|class-variance-authority|clsx)$/, "style"],
  [/^(@radix-ui\/.*|lucide-react)$/, "components"],
  [/^(react|react-dom|@types\/react.*|vite|@vitejs\/.*|react-hook-form)$/, "web"],
  [/^(hono|postgres|ajv|ajv-formats|zod)$/, "server"],
  [/^(ink|picocolors|marked)$/, "tools"],
  [/^(typescript|@types\/bun|@playwright\/test|@axe-core\/.*)$/, "build"],
];
export const npmLayer = (pkg: string) => NPM_LAYER.find(([re]) => re.test(pkg))?.[1] ?? "other";

/** Every package.json in the workspace (the root, packages/*, plugins/*). */
export function workspaces(root = HOME): string[] {
  const out = ["package.json"];
  for (const d of ["packages", "plugins"]) {
    if (!existsSync(join(root, d))) continue;
    for (const p of readdirSync(join(root, d))) if (existsSync(join(root, d, p, "package.json"))) out.push(join(d, p, "package.json"));
  }
  return out;
}

/** Where a package is declared, and with what range. */
export function declared(pkg: string, root = HOME): { file: string; range: string; dev: boolean }[] {
  const out: { file: string; range: string; dev: boolean }[] = [];
  for (const f of workspaces(root)) {
    const j = JSON.parse(read(root, f));
    if (j.dependencies?.[pkg]) out.push({ file: f, range: j.dependencies[pkg], dev: false });
    if (j.devDependencies?.[pkg]) out.push({ file: f, range: j.devDependencies[pkg], dev: true });
  }
  return out;
}

// ── components ────────────────────────────────────────────────────────────────

/**
 * What the ui package's components were adapted from. They are not copies: each was rewritten to the
 * theme tokens (shadcn's button gained `write` and `chip`; the 21st.dev pieces lost their own
 * dependencies), so upstream cannot be merged in. What can be known is whether upstream has moved since
 * someone last looked, and what changed, so a person can decide whether to port it. `upstream` is the
 * sha256 of upstream's file at that look; `--record` refreshes it after a port.
 */
export const PROVENANCE = "packages/ui/src/components/provenance.json";
export interface Source {
  file: string;
  from: string;
  registry?: string;
  licence: string | null;
  upstream?: string;
  note?: string;
}

export const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export async function upstreamOf(s: Source): Promise<string | null> {
  if (!s.registry) return null;
  const r = await fetch(s.registry);
  if (!r.ok) return null;
  const j = (await r.json()) as { files?: { content?: string }[] };
  const content = j.files?.map((f) => f.content ?? "").join("\n");
  return content ? content : null;
}

// ── the report ────────────────────────────────────────────────────────────────

const json = async (url: string): Promise<any> => {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(15_000) }); return r.ok ? r.json() : null; } catch { return null; }
};

async function latestBun(): Promise<string | null> { return (await json("https://registry.npmjs.org/bun/latest"))?.version ?? null; }
async function latestNeedle(): Promise<string | null> { return (await json("https://pypi.org/pypi/cactus-needle/json"))?.info?.version ?? null; }

/** The newest exact pgvector tag for a PostgreSQL major on the same Debian, or null when there is none. */
async function latestPgvector(pgMaj: number, debian: string): Promise<string | null> {
  const j = await json(`https://hub.docker.com/v2/repositories/pgvector/pgvector/tags?page_size=100&name=pg${pgMaj}-${debian}`);
  const tags: string[] = (j?.results ?? []).map((t: { name: string }) => t.name).filter((n: string) => new RegExp(`^\\d+\\.\\d+\\.\\d+-pg${pgMaj}-${debian}$`).test(n));
  tags.sort((a, b) => Bun.semver.order(a.split("-")[0], b.split("-")[0]));
  return tags.length ? `pgvector/pgvector:${tags[tags.length - 1]}` : null;
}

type Row = { layer: string; what: string; pinned: string; latest: string; note: string };

async function report(): Promise<void> {
  const rows: Row[] = [];

  const bun = bunPin(), bunLatest = await latestBun();
  rows.push({ layer: "runtime", what: "Bun", pinned: bun, latest: bunLatest ?? "?", note: bunLatest && bunLatest !== bun ? `bun run deps bun ${bunLatest}` : "" });

  const pg = postgresPin(), maj = pgMajor(pg), debian = pg.match(/-pg\d+-(\w+)$/)?.[1] ?? "trixie";
  const [samePg, nextPg] = await Promise.all([latestPgvector(maj, debian), latestPgvector(maj + 1, debian)]);
  rows.push({ layer: "database", what: "Postgres + pgvector", pinned: pg.replace("pgvector/pgvector:", ""), latest: (samePg ?? "?").replace("pgvector/pgvector:", ""),
    note: nextPg ? `PostgreSQL ${maj + 1} is published (${nextPg.replace("pgvector/pgvector:", "")}): a major is a dump and restore for every application` : samePg && samePg !== pg ? `bun run deps postgres ${samePg}` : "" });

  const needle = classifierPin(), needleLatest = await latestNeedle();
  rows.push({ layer: "classifier", what: "cactus-needle", pinned: needle, latest: needleLatest ?? "?", note: needleLatest && needleLatest !== needle ? `bun run deps classifier ${needleLatest}, then fishtea eval on every labelled set` : "" });
  const py = read(HOME, "Dockerfile.classifier").match(/^FROM (python:\S+)/m)?.[1] ?? "?";
  rows.push({ layer: "classifier", what: "Python image", pinned: py.replace("python:", ""), latest: "", note: py.match(/:\d+\.\d+\.\d+/) ? "" : "floats within its minor" });

  const out = Bun.spawnSync(["bun", "outdated", "--filter", "*"], { cwd: HOME, stdout: "pipe", stderr: "pipe" }).stdout.toString();
  const seen = new Set<string>();
  for (const line of out.split("\n")) {
    const c = line.split("|").map((s) => s.trim());
    if (c.length < 6 || !c[1] || c[1] === "Package" || /^-+$/.test(c[1])) continue;
    const pkg = c[1].replace(/ \(dev\)$/, "");
    if (seen.has(pkg)) continue;
    seen.add(pkg);
    const [current, update, latest] = [c[2], c[3], c[4]];
    rows.push({ layer: npmLayer(pkg), what: pkg, pinned: current, latest,
      note: update !== current ? `bun run deps npm ${pkg} (in range)` : major(latest) > major(current) ? `major: bun run deps npm ${pkg}@^${latest}` : "" });
  }

  const audit = Bun.spawnSync(["bun", "audit"], { cwd: HOME, stdout: "pipe", stderr: "pipe" });
  const advisories = audit.stdout.toString().match(/(\d+) vulnerabilit/)?.[1];

  const prov: Source[] = existsSync(join(HOME, PROVENANCE)) ? JSON.parse(read(HOME, PROVENANCE)).sources : [];
  for (const s of prov) {
    let note = "";
    if (s.registry) {
      const now = await upstreamOf(s).catch(() => null);
      note = now === null ? "upstream unreachable" : s.upstream && sha(now) !== s.upstream ? "upstream changed since it was recorded: port by hand, then --record" : s.upstream ? "" : "not yet recorded: bun run deps components --record";
    } else note = "no public registry: check the source by hand";
    if (!s.licence) note = `licence unknown${note ? "; " + note : ""}`;
    rows.push({ layer: "components", what: `${s.file.replace(/^packages\/ui\/src\//, "")} ← ${s.from}`, pinned: s.licence ?? "?", latest: "", note });
  }

  const order = ["runtime", "database", "classifier", "server", "web", "style", "components", "tools", "build", "other"];
  rows.sort((a, b) => order.indexOf(a.layer) - order.indexOf(b.layer));
  const w = (k: keyof Row) => Math.min(48, Math.max(k.length, ...rows.map((r) => r[k].length)));
  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
  console.log([pad("layer", w("layer")), pad("what", w("what")), pad("pinned", w("pinned")), pad("latest", w("latest")), "next"].join("  "));
  for (const r of rows) console.log([pad(r.layer, w("layer")), pad(r.what, w("what")), pad(r.pinned, w("pinned")), pad(r.latest, w("latest")), r.note].join("  "));
  console.log(advisories ? `\n✗ bun audit: ${advisories} advisories — bun audit for the detail` : "\n✓ bun audit: no advisories");
}

// ── the gates ─────────────────────────────────────────────────────────────────

/** What has to pass before a moved layer is a release. Printed, not run: some are judgement calls. */
export const GATES: Record<string, string[]> = {
  bun: ["bun install", "bun run test", "bun run typecheck", "bun run e2e", "bun run build-release --install   (the compiled binary is Bun too)", "bun run up   (the images build from the new tag)"],
  postgres: ["docker rm -f fishtea-test-db, then recreate it from the new image (CONTRIBUTING.md)", "bun run test", "a new PostgreSQL major is a dump and restore for every application: say so in the release notes (docs/OPERATING.md)"],
  classifier: ["packages/classifier/engine.py: add the new version to PINS, with the Hub commit it shipped against and the sha256 of its engine wheels and weights (the image build refuses a version it has no pin for)", "bun run up   (rebuilds the classifier image)", "fishtea eval on every application's labelled set, before and after: the floor and the 194-case finding in contract.md were measured on the old engine", "bun run bench -- --conventional   (latency is decode length; a new engine can move it)"],
  npm: ["bun run test", "bun run typecheck", "bun run e2e", "bun audit", "build each application's ui (FISHTEA_APP_DIR=<app> bun run build in packages/ui)"],
  components: ["bun run e2e   (the a11y suite runs axe on every vessel)", "bun run deps components --record"],
};

function gates(layer: string, touched: string[]): void {
  if (touched.length) console.log(`✓ moved, in ${touched.join(", ")}`);
  else console.log("already there; nothing moved");
  console.log("\nbefore this is a release:");
  for (const g of GATES[layer]) console.log(`  · ${g}`);
}

async function main(argv: string[]): Promise<void> {
  const [layer, arg] = argv;
  if (!layer) return report();
  if (layer === "bun") { if (!arg) throw new Error("which version? bun run deps bun 1.4.3"); return gates("bun", setBun(arg)); }
  if (layer === "postgres") {
    if (!arg) throw new Error("which image? bun run deps postgres pgvector/pgvector:0.8.8-pg18-trixie");
    const was = postgresPin();
    const touched = setPostgres(arg);
    if (pgMajor(arg) !== pgMajor(was)) console.log(`! PostgreSQL ${pgMajor(was)} → ${pgMajor(arg)}: pgdata does not move between majors. Every application's doctor will fail until it is dumped and restored.`);
    return gates("postgres", touched);
  }
  if (layer === "classifier") { if (!arg) throw new Error("which version? bun run deps classifier 3.2.10"); return gates("classifier", setClassifier(arg)); }
  if (layer === "npm") {
    if (!arg) throw new Error("which package? bun run deps npm vite@^7.3.8");
    const at = arg.lastIndexOf("@");
    const [pkg, range] = at > 0 ? [arg.slice(0, at), arg.slice(at + 1)] : [arg, ""];
    const where = declared(pkg);
    if (!where.length) throw new Error(`no workspace declares ${pkg}`);
    for (const d of where) {
      const dir = join(HOME, d.file.replace(/\/?package\.json$/, "") || ".");
      const cmd = range ? ["bun", "add", ...(d.dev ? ["-d"] : []), `${pkg}@${range}`] : ["bun", "update", pkg];
      const r = Bun.spawnSync(cmd, { cwd: dir, stdout: "inherit", stderr: "inherit" });
      if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed in ${d.file}`);
    }
    return gates("npm", where.map((d) => d.file));
  }
  if (layer === "components") {
    const path = join(HOME, PROVENANCE);
    const doc = JSON.parse(readFileSync(path, "utf8")) as { sources: Source[] };
    if (arg !== "--record") return report();
    for (const s of doc.sources) {
      const now = await upstreamOf(s).catch(() => null);
      if (now !== null) s.upstream = sha(now);
    }
    writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
    return gates("components", [PROVENANCE]);
  }
  throw new Error(`unknown layer "${layer}": bun, postgres, classifier, npm, components (or nothing, for the report)`);
}

if (import.meta.main) main(process.argv.slice(2)).catch((e) => { console.error(`✗ ${(e as Error).message}`); process.exit(1); });
