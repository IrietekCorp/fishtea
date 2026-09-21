/**
 * `fishtea new`: scaffold an application from an archetype in templates/. Each template is a complete app
 * directory (spec.json, calls/, seed/, scripts/) plus `onboard.json`, the interview that turns the archetype
 * into *this* business. Answers come from the TUI, from `--answers file.json`, or from defaults.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { bumpVersion, validateSpec } from "@fishtea/spec";

export interface Template { name: string; dir: string; doc: string; onboard: Onboard }
export interface Question { id: string; ask: string; type: "string" | "text" | "int" | "number" | "boolean" | "enum" | "multi" | "list"; path?: string; values?: string[]; default?: unknown; apply?: string; also?: { path?: string; seed?: string; field?: string }[]; seed?: string; field?: string }
export interface Onboard { doc?: string; questions: Question[] }

export function listTemplates(fishteaHome: string): Template[] {
  const root = join(fishteaHome, "templates");
  return readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory() && existsSync(join(root, d, "spec.json"))).sort().map((name) => {
    const dir = join(root, name);
    const spec = JSON.parse(readFileSync(join(dir, "spec.json"), "utf8"));
    const onboard: Onboard = existsSync(join(dir, "onboard.json")) ? JSON.parse(readFileSync(join(dir, "onboard.json"), "utf8")) : { questions: [] };
    return { name, dir, doc: spec.business?.doc ?? "", onboard };
  });
}

export interface ScaffoldOptions { id: string; template: string; dir?: string; name?: string; doc?: string; fishteaHome: string; force?: boolean; answers?: Record<string, unknown> }

const setPath = (obj: any, path: string, value: unknown) => { const parts = path.split("."); let cur = obj; for (const p of parts.slice(0, -1)) cur = cur[p] ??= {}; cur[parts.at(-1)!] = value; };
const getPath = (obj: any, path: string) => path.split(".").reduce((o, p) => o?.[p], obj);
const asList = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** Apply one answered question to the spec (and note seed edits for later). */
export function applyAnswer(spec: any, q: Question, value: unknown, side: { seed: Record<string, Record<string, unknown>>; flags: Record<string, unknown> }) {
  if (value === undefined || value === "" || value === null) return;
  const coerce = (): unknown => {
    switch (q.type) {
      case "int": return Math.trunc(Number(value));
      case "number": return Number(value);
      case "boolean": return value === true || value === "true" || value === "yes";
      case "list": case "multi": return asList(value);
      default: return value;
    }
  };
  const v = coerce();
  const targets = [...(q.path ? [{ path: q.path }] : []), ...(q.also ?? [])];
  for (const t of targets) {
    if (t.seed && t.field) { (side.seed[t.seed] ??= {})[t.field] = v; continue; }
    if (!t.path) continue;
    switch (q.apply) {
      case "enum": { const cur = getPath(spec, t.path); if (cur && typeof cur === "object") { cur.values = asList(v); if (cur.default && !cur.values.includes(cur.default)) cur.default = cur.values[0]; } break; }
      case "joinDoc": setPath(spec, t.path, `one of: ${asList(v).join(", ")}`); break;
      default: setPath(spec, t.path, v);
    }
  }
  if (q.seed && q.field) (side.seed[q.seed] ??= {})[q.field] = v;
  if (q.apply && !["enum", "joinDoc"].includes(q.apply)) side.flags[q.apply] = v;
}

export async function scaffold(o: ScaffoldOptions): Promise<{ dir: string; template: string; answered: string[] }> {
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(o.id)) throw new Error("id must be lowercase letters, digits and dashes, starting with a letter");
  const tpl = listTemplates(o.fishteaHome).find((t) => t.name === o.template);
  if (!tpl) throw new Error(`unknown template "${o.template}"; use one of ${listTemplates(o.fishteaHome).map((t) => t.name).join(", ")}`);
  const dir = resolve(o.dir ?? o.id);
  if (existsSync(dir) && readdirSync(dir).length && !o.force) throw new Error(`${dir} exists and is not empty (use --force)`);
  mkdirSync(dir, { recursive: true });
  for (const sub of ["calls", "seed", "rules", "scripts"]) if (existsSync(join(tpl.dir, sub))) cpSync(join(tpl.dir, sub), join(dir, sub), { recursive: true });
  const spec = JSON.parse(readFileSync(join(tpl.dir, "spec.json"), "utf8"));
  const name = o.name ?? o.id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  spec.business = { ...spec.business, id: o.id, name, doc: o.doc ?? spec.business.doc, version: bumpVersion(undefined) };

  const side = { seed: {} as Record<string, Record<string, unknown>>, flags: {} as Record<string, unknown> };
  const answered: string[] = [];
  const answers = { name, doc: o.doc, ...(o.answers ?? {}) } as Record<string, unknown>;
  for (const q of tpl.onboard.questions) {
    const raw = answers[q.id] ?? (typeof q.default === "string" ? q.default.replace("{{name}}", name) : q.default);
    if (answers[q.id] !== undefined) answered.push(q.id);
    applyAnswer(spec, q, raw, side);
  }
  applyFlags(spec, side.flags, dir);
  for (const [entity, patch] of Object.entries(side.seed)) {
    const file = join(dir, "seed", `${entity}.json`);
    if (!existsSync(file)) continue;
    const rows = JSON.parse(readFileSync(file, "utf8"));
    if (rows[0]) Object.assign(rows[0], patch);
    writeFileSync(file, JSON.stringify(rows, null, 1) + "\n");
  }
  for (const s of ["entities", "calls", "rules", "shapes", "personas", "envelope", "notifications", "operator"]) if (spec[s]) spec[s].version = bumpVersion(undefined);
  validateSpec(spec, { dir });
  writeFileSync(join(dir, "spec.json"), JSON.stringify(spec, null, 2) + "\n");
  writeAppFiles(dir, { id: o.id, name, template: o.template, fishteaHome: o.fishteaHome });
  return { dir, template: o.template, answered };
}

/** Template-specific consequences of answers (keepSeed, fulfilment, vendors). Everything else is a path patch. */
function applyFlags(spec: any, flags: Record<string, unknown>, dir: string) {
  if (flags.keepSeed === false || flags.keepSeed === "false") {
    for (const f of readdirSync(join(dir, "seed"))) if (f.endsWith(".json") && !/^(vendor|faq|organization)\.json$/.test(f)) writeFileSync(join(dir, "seed", f), "[]\n");
  }
  if (flags.fulfilment) {
    const mode = String(flags.fulfilment);
    if (mode.startsWith("affiliate")) {
      for (const s of ["addToCart", "removeFromCart", "viewCart", "checkout", "orderStatus"]) delete spec.shapes[s];
      for (const s of Object.values(spec.shapes) as any[]) if (s?.next) s.next = s.next.filter((n: any) => !["addToCart", "checkout", "viewCart"].includes(n.shape));
      delete spec.personas["mid-purchase"]; delete spec.envelope.greeting["mid-purchase"];
      for (const s of Object.values(spec.shapes) as any[]) if (s?.allow) s.allow = s.allow.filter((p: string) => p !== "mid-purchase");
      for (const g of Object.values(spec.envelope.greeting) as any[]) if (g.offer) g.offer = g.offer.filter((s: string) => spec.shapes[s]);
      spec.envelope.greeting.customer = { resume: true, offer: ["findProducts", "trending"] };
      delete spec.notifications["order.shipped"];
      spec.entities.product.fields.fulfilment.default = "affiliate";
    }
  }
  if (flags.vendors) {
    const wanted = asList(flags.vendors);
    const file = join(dir, "seed", "vendor.json");
    if (existsSync(file)) {
      const rows: any[] = JSON.parse(readFileSync(file, "utf8"));
      const kept = rows.filter((r) => wanted.includes(r.adapter)).map((r) => ({ ...r, status: "active" }));
      for (const a of wanted) if (!kept.some((r) => r.adapter === a)) kept.push({ id: `v_${a}`, name: `${a} feed`, adapter: a, config: a === "csv" ? { file: "seed/feed.csv" } : a === "http" ? { url: "https://example.com/feed.json" } : {}, commissionPct: null, lastSyncAt: null, status: "active" });
      writeFileSync(file, JSON.stringify(kept, null, 1) + "\n");
    }
  }
}

export function writeAppFiles(dir: string, a: { id: string; name: string; template: string; fishteaHome: string }) {
  const home = a.fishteaHome;
  const files: Record<string, string> = {
    "package.json": JSON.stringify({
      name: a.id, version: "0.1.0", private: true, type: "module", description: `${a.name} — a Fishtea application (${a.template} archetype)`,
      scripts: { fishtea: "bun fishtea.ts", validate: "bun fishtea.ts validate", derive: "bun fishtea.ts derive", migrate: "bun fishtea.ts migrate", seed: "bun fishtea.ts seed", dev: "bun fishtea.ts serve", headless: "bun fishtea.ts headless", tui: "bun fishtea.ts tui", up: "bun fishtea.ts up", down: "bun fishtea.ts down", logs: "bun fishtea.ts logs", bench: "bun fishtea.ts bench" },
      fishtea: { template: a.template, home },
    }, null, 2) + "\n",
    "fishtea.ts": `#!/usr/bin/env bun
// Runs the Fishtea CLI from the framework checkout named in package.json ("fishtea.home") or FISHTEA_HOME.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
const here = dirname(new URL(import.meta.url).pathname);
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));
const home = process.env.FISHTEA_HOME ?? pkg.fishtea?.home;
const cli = home && join(home, "packages/cli/src/index.ts");
if (!cli || !existsSync(cli)) { console.error(\`fishtea: framework not found at \${home ?? "(unset)"} — set FISHTEA_HOME or package.json fishtea.home\`); process.exit(1); }
const proc = Bun.spawn(["bun", cli, ...process.argv.slice(2)], { stdio: ["inherit", "inherit", "inherit"], env: { ...process.env, FISHTEA_HOME: home, FISHTEA_APP: process.env.FISHTEA_APP ?? here } });
process.exit(await proc.exited);
`,
    ".env.example": `DATABASE_URL=postgres://fishtea:fishtea@localhost:5432/fishtea\nCLASSIFIER_URL=http://localhost:8081\nFISHTEA_INTENT=needle          # lexical = dev/offline only, never production (D5)\nFISHTEA_STRICT=0\nFISHTEA_OPERATOR_TOKEN=change-me\nFISHTEA_HOME=${home}\nPORT=3000\n# vendor credentials (ecommerce adapters read these; never put them in spec.json)\n# EBAY_APP_ID= EBAY_CERT_ID= EBAY_CAMPAIGN_ID=\n`,
    "docker-compose.yml": composeFile(home),
    ".gitignore": "node_modules/\n.env\n.fishtea/\n",
    "README.md": `# ${a.name}

A [Fishtea](${home}) application from the \`${a.template}\` archetype. Everything derives from \`spec.json\`.

\`\`\`
cp .env.example .env
bun run up        # docker compose: Postgres (pgvector) + needle3 classifier pool + core + ui
bun run tui       # the operator console: edit sections, restart, regenerate, watch the unmet channel
\`\`\`

Without Docker (a Postgres with pgvector on DATABASE_URL): \`bun run migrate && bun run seed && bun run dev\`, and \`bun run headless\` for the scripted conversation with no UI.

Layout: \`spec.json\` (the business), \`calls/\` (SQL with $1..$n parameters, compute modules${a.template === "ecommerce" ? ", vendor adapters in calls/adapters/" : ""}), \`seed/\` (rows per entity), \`rules/\`, \`scripts/\` (headless walkthroughs). Every script runs the framework CLI through \`fishtea.ts\`; \`package.json\` → \`fishtea.home\` points at the framework checkout.
`,
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
}

export function composeFile(home: string): string {
  return `# One Compose stack = one business (D15). The framework image is built from FISHTEA_HOME; this directory is mounted at /app.
services:
  db:
    image: pgvector/pgvector:pg18
    environment: { POSTGRES_USER: fishtea, POSTGRES_PASSWORD: fishtea, POSTGRES_DB: fishtea }
    volumes: [ "pgdata:/var/lib/postgresql/data" ]
    ports: [ "\${FISHTEA_DB_PORT:-5432}:5432" ]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U fishtea"], interval: 3s, retries: 20 }
  classifier:
    build: { context: \${FISHTEA_HOME:-${home}}, dockerfile: Dockerfile.classifier }
    environment: { NEEDLE_WORKERS: "\${NEEDLE_WORKERS:-3}", FISHTEA_SPEC: /app/spec.json }
    volumes: [ "models:/models", "./:/app:ro" ]
    ports: [ "\${FISHTEA_CLASSIFIER_PORT:-8081}:8081" ]
    healthcheck: { test: ["CMD", "curl", "-fs", "http://localhost:8081/healthz"], interval: 5s, retries: 60 }
  core:
    build: { context: \${FISHTEA_HOME:-${home}}, dockerfile: Dockerfile.core }
    env_file: [ path: .env, required: false ]
    environment:
      DATABASE_URL: postgres://fishtea:fishtea@db:5432/fishtea
      CLASSIFIER_URL: http://classifier:8081
      FISHTEA_APP: /app
      FISHTEA_INTENT: needle
      FISHTEA_STRICT: "\${FISHTEA_STRICT:-0}"
      FISHTEA_OPERATOR_TOKEN: "\${FISHTEA_OPERATOR_TOKEN:-change-me}"
    volumes: [ "./:/app" ]            # the TUI edits spec.json here; core watches and hot-reloads
    ports: [ "\${FISHTEA_CORE_PORT:-3000}:3000" ]
    depends_on: { db: { condition: service_healthy }, classifier: { condition: service_healthy } }
  ui:
    build: { context: \${FISHTEA_HOME:-${home}}, dockerfile: Dockerfile.core, target: ui }
    environment: { VITE_CORE_URL: "http://localhost:\${FISHTEA_CORE_PORT:-3000}" }
    ports: [ "\${FISHTEA_UI_PORT:-5173}:5173" ]
    depends_on: [ core ]
volumes: { pgdata: {}, models: {} }
`;
}

export { rmSync };
