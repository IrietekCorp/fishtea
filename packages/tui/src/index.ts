/**
 * The operator console (BLUEPRINT §13, D12): an editor and control surface over the spec.
 *   Onboard — walk an operator through a new spec from a template.
 *   Edit    — pick a section; scoped prompts or $EDITOR; validate; bump version; hot-reload; migrate if entities.
 *   Run     — status of the services, restart core, regenerate a section, tail the unmet channel, notify.
 * Same engine pointed at itself: operator actions are shapes (op.*) over the core's /op surface.
 */
import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadApp, validateSpec, SpecError, SECTIONS, deriveDDL, deriveTools, shapes as specShapes, entities as specEntities, calls as specCalls, bumpVersion, type App } from "@fishtea/spec";
import { connect, migrate, seed, entitiesDrift } from "@fishtea/core";

export interface TuiOptions { dir: string; fishteaHome: string; flags: Record<string, string | boolean> }

const env = (k: string, d = "") => process.env[k] ?? d;

export async function tui(o: TuiOptions) {
  p.intro(pc.bgCyan(pc.black(" fishtea ")) + " operator console");
  const specPath = join(o.dir, "spec.json");
  if (!existsSync(specPath)) {
    p.note(`No spec.json in ${o.dir}`, "Onboard");
    const created = await onboard(o.dir, o.fishteaHome);
    if (!created) return p.outro("nothing created");
  }
  const core = new Core(env("FISHTEA_CORE_URL", `http://localhost:${env("FISHTEA_CORE_PORT", env("PORT", "3000"))}`), env("FISHTEA_OPERATOR_TOKEN", "change-me"));
  while (true) {
    const app = safeLoad(o.dir);
    const online = await core.health();
    const status = online ? pc.green(`core up · ${online.classifier?.name}${online.strict ? " strict" : ""} · v${online.version}`) : pc.yellow("core offline (start with: bun run dev / bun run up)");
    const action = await p.select({
      message: `${app ? `${app.spec.business.name} (${app.spec.business.id}) · spec v${app.spec.business.version}` : pc.red("spec invalid")} · ${status}`,
      options: [
        { value: "edit", label: "Edit a section", hint: "scoped prompts or $EDITOR; validates; bumps the section version; hot-reloads" },
        { value: "run", label: "Run", hint: "status, restart, migrate, regenerate, unmet channel, notify" },
        { value: "inspect", label: "Inspect", hint: "shapes, entities, DDL, tool list, section hashes" },
        { value: "onboard", label: "Onboard a new application", hint: "fishtea new from a template" },
        { value: "quit", label: "Quit" },
      ],
    });
    if (p.isCancel(action) || action === "quit") break;
    try {
      if (action === "edit" && app) await edit(app, core);
      else if (action === "run") await run(o, app, core);
      else if (action === "inspect" && app) await inspect(app);
      else if (action === "onboard") await onboard(undefined, o.fishteaHome);
      else if (!app) { const e = tryLoadError(o.dir); p.note(e, "spec invalid — fix the file, or edit with $EDITOR"); if (await p.confirm({ message: "Open spec.json in $EDITOR?" })) await editWhole(specPath, o.dir, core); }
    } catch (e) {
      if (p.isCancel(e)) continue;
      p.log.error((e as Error).message);
    }
  }
  p.outro("bye");
}

function safeLoad(dir: string): App | null { try { return loadApp(dir); } catch { return null; } }
function tryLoadError(dir: string): string { try { loadApp(dir); return ""; } catch (e) { return e instanceof SpecError ? e.problems.join("\n") : (e as Error).message; } }

// ── core client (operator shapes over HTTP) ─────────────────────────────────

class Core {
  constructor(public url: string, public token: string) {}
  private h() { return { "content-type": "application/json", "x-fishtea-operator": this.token }; }
  async health(): Promise<any | null> { try { const r = await fetch(`${this.url}/healthz`, { signal: AbortSignal.timeout(1500) }); return r.ok ? await r.json() : null; } catch { return null; } }
  async op(shape: string, args: Record<string, unknown> = {}) { const r = await fetch(`${this.url}/op/utter`, { method: "POST", headers: this.h(), body: JSON.stringify({ shape, args }), signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`${shape}: ${r.status} ${await r.text()}`); return r.json(); }
  async reload() { const r = await fetch(`${this.url}/op/reload`, { method: "POST", headers: this.h(), signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`reload: ${r.status} ${await r.text()}`); return r.json(); }
  async unmet(since: string) { const r = await fetch(`${this.url}/op/unmet?since=${encodeURIComponent(since)}`, { headers: this.h() }); if (!r.ok) throw new Error(`unmet: ${r.status}`); return (await r.json()).unmet as any[]; }
  async visitors() { const r = await fetch(`${this.url}/op/visitors`, { headers: this.h() }); if (!r.ok) throw new Error(`visitors: ${r.status}`); return (await r.json()).visitors as any[]; }
  async notify(visitorId: string, text: string) { const r = await fetch(`${this.url}/op/notify`, { method: "POST", headers: this.h(), body: JSON.stringify({ visitorId, text }) }); if (!r.ok) throw new Error(`notify: ${r.status} ${await r.text()}`); return r.json(); }
}

// ── onboard ─────────────────────────────────────────────────────────────────

/** Run a template's onboarding interview (templates/<t>/onboard.json) and return the answers. */
export async function interview(fishteaHome: string, template: string, seed: { name?: string } = {}): Promise<Record<string, unknown>> {
  const { listTemplates } = await import(join(fishteaHome, "packages/cli/src/new.ts"));
  const tpl = listTemplates(fishteaHome).find((t: any) => t.name === template);
  if (!tpl) throw new Error(`unknown template ${template}`);
  const answers: Record<string, unknown> = {};
  if (tpl.onboard.doc) p.note(tpl.onboard.doc, `${template} · onboarding`);
  for (const q of tpl.onboard.questions) {
    const def = typeof q.default === "string" ? q.default.replace("{{name}}", seed.name ?? "") : q.default;
    let v: unknown;
    switch (q.type) {
      case "enum": v = await p.select({ message: q.ask, options: (q.values ?? []).map((x: string) => ({ value: x, label: x })), initialValue: def as string }); break;
      case "multi": v = await p.multiselect({ message: q.ask, options: (q.values ?? []).map((x: string) => ({ value: x, label: x })), initialValues: (def as string[]) ?? [], required: false }); break;
      case "boolean": v = await p.confirm({ message: q.ask, initialValue: def !== false }); break;
      case "int": case "number": v = await p.text({ message: q.ask, initialValue: def == null ? "" : String(def), validate: (x) => (x === "" || !isNaN(Number(x)) ? undefined : "a number") }); break;
      default: v = await p.text({ message: q.ask, initialValue: def == null ? "" : String(def) });
    }
    if (p.isCancel(v)) throw Object.assign(new Error("cancelled"), { cancelled: true });
    answers[q.id] = v;
  }
  return answers;
}

async function onboard(dir: string | undefined, fishteaHome: string): Promise<boolean> {
  const { scaffold, listTemplates } = await import(join(fishteaHome, "packages/cli/src/new.ts"));
  const templates = listTemplates(fishteaHome);
  const template = await p.select({ message: "Which kind of application? (an archetype; the interview makes it yours)", options: templates.map((t: any) => ({ value: t.name, label: t.name, hint: t.doc.slice(0, 90) })) });
  if (p.isCancel(template)) return false;
  const id = dir ? resolve(dir).split("/").pop()!.toLowerCase().replace(/[^a-z0-9-]/g, "-") : await p.text({ message: "Application id (lowercase, dashes; also the directory name)", placeholder: "my-shop", validate: (v) => (/^[a-z][a-z0-9-]{1,40}$/.test(v) ? undefined : "lowercase letters, digits, dashes") });
  if (p.isCancel(id)) return false;
  const name = String(id).split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  let answers: Record<string, unknown>;
  try { answers = await interview(fishteaHome, String(template), { name }); } catch (e) { if ((e as any).cancelled) return false; throw e; }
  const target = dir ?? resolve(String(id));
  const ok = await p.confirm({ message: `Create ${target} from the ${String(template)} archetype with these answers?` });
  if (p.isCancel(ok) || !ok) return false;
  const s = p.spinner(); s.start("scaffolding");
  const out = await scaffold({ id: String(id), template: String(template), dir: target, name: String(answers.name ?? name), fishteaHome, force: !!dir, answers });
  s.stop(`created ${out.dir} (${out.answered.length} answers applied)`);
  p.note(`cd ${target}\ncp .env.example .env\nbun run up      # or: bun run migrate && bun run seed && bun run dev\nbun run tui`, "next");
  return true;
}

// ── edit ────────────────────────────────────────────────────────────────────

async function edit(app: App, core: Core) {
  const section = await p.select({ message: "Which section?", options: SECTIONS.map((s) => ({ value: s, label: s, hint: sectionHint(app, s) })) });
  if (p.isCancel(section)) return;
  const how = await p.select({
    message: `Edit ${section} how?`,
    options: [
      ...(section === "rules" || section === "business" ? [{ value: "scoped", label: "Scoped prompts", hint: "edit one value at a time" }] : []),
      ...(section === "shapes" ? [{ value: "addShape", label: "Add a shape", hint: "wizard: asks, input, answer, plan over one call" }] : []),
      ...(section === "entities" ? [{ value: "addField", label: "Add a field to an entity" }] : []),
      { value: "editor", label: "Open in $EDITOR", hint: env("EDITOR", env("VISUAL", "vi")) },
      { value: "regen", label: "Regenerate from template", hint: "replace this section with the template's version" },
    ],
  });
  if (p.isCancel(how)) return;
  const { applySectionPatch } = await import(join(app.dir, "..", "..", "packages/cli/src/edit.ts")).catch(() => import("@fishtea/cli/src/edit.ts" as any));
  let result: { version: string } | undefined;
  if (how === "scoped") result = await scoped(app, section as string, applySectionPatch);
  else if (how === "addShape") result = await addShape(app, applySectionPatch);
  else if (how === "addField") result = await addField(app, applySectionPatch);
  else if (how === "editor") result = await editInEditor(app, section as string, applySectionPatch);
  else if (how === "regen") result = await regenerate(app, section as string, applySectionPatch);
  if (!result) return;
  p.log.success(`${section} → v${result.version} written to ${app.specPath}`);
  await afterEdit(app, section as string, core);
}

function sectionHint(app: App, s: string): string {
  const sec: any = (app.spec as any)[s];
  if (!sec) return "absent";
  const n = Object.keys(sec).filter((k) => k !== "version" && k !== "doc").length;
  return `v${sec.version} · ${s === "operator" ? Object.keys(sec.shapes ?? {}).length + " shapes" : s === "envelope" ? `${sec.accept.length} accepted keys` : `${n} entries`}`;
}

async function afterEdit(app: App, section: string, core: Core) {
  if (section === "entities") {
    const db = safeConnect();
    if (db) {
      const next = loadApp(app.dir);
      const drift = await entitiesDrift(db, next);
      if (drift.drifted && (await p.confirm({ message: "Entities changed. Run the migration now? (additive; destructive changes are refused unless you allow them)" }))) {
        const destructive = await p.confirm({ message: "Allow destructive changes (drop columns/tables that left the spec)?", initialValue: false });
        const s = p.spinner(); s.start("migrating");
        const r = await migrate(db, next, { allowDestructive: destructive === true });
        s.stop(`migrated: ${r.created.length} created, ${r.added.length} added, ${r.dropped.length} dropped${r.refused.length ? `, refused ${r.refused.join(",")}` : ""}`);
      }
      await db.end();
    } else p.log.warn("DATABASE_URL not reachable; run `fishtea migrate` when it is");
    if (await core.health()) {
      if (await p.confirm({ message: "Restart core so the new tables are bound?" })) { await core.op("op.restart").catch(() => {}); p.log.info("core restarting (Compose restarts it; `bun run dev` needs a manual restart)"); }
    }
    return;
  }
  const h = await core.health();
  if (!h) { p.log.info("core offline; it will pick up the change on start"); return; }
  const s = p.spinner(); s.start("hot-reloading core");
  try { const r = await core.reload(); s.stop(`core reloaded → v${r.version}`); } catch (e) { s.stop(pc.yellow(`reload via /op failed (${(e as Error).message}); the file watcher will reload within a second`)); }
}

async function scoped(app: App, section: string, apply: any) {
  const sec: any = (app.spec as any)[section];
  const leaves: { path: string; value: unknown }[] = [];
  const walk = (o: any, prefix: string) => { for (const [k, v] of Object.entries(o)) { if (k === "version" || k === "doc") continue; if (v && typeof v === "object" && !Array.isArray(v)) walk(v, `${prefix}${k}.`); else leaves.push({ path: prefix + k, value: v }); } };
  walk(sec, "");
  const pick = await p.select({ message: `Which value in ${section}?`, options: leaves.map((l) => ({ value: l.path, label: l.path, hint: JSON.stringify(l.value) })) });
  if (p.isCancel(pick)) return;
  const leaf = leaves.find((l) => l.path === pick)!;
  const raw = await p.text({ message: `${pick} =`, initialValue: JSON.stringify(leaf.value), validate: (v) => { try { JSON.parse(v); return undefined; } catch { return "must be JSON (strings quoted)"; } } });
  if (p.isCancel(raw)) return;
  const value = JSON.parse(String(raw));
  const patch: any = {};
  let cur = patch;
  const parts = String(pick).split(".");
  parts.forEach((k, i) => { if (i === parts.length - 1) cur[k] = value; else cur = cur[k] = {}; });
  return apply(app.specPath, section, patch, { dir: app.dir });
}

async function addField(app: App, apply: any) {
  const ent = await p.select({ message: "Entity", options: specEntities(app.spec).map(([n]) => ({ value: n, label: n })) });
  if (p.isCancel(ent)) return;
  const name = await p.text({ message: "Field name (camelCase)", validate: (v) => (/^[a-z][A-Za-z0-9]*$/.test(v) ? undefined : "camelCase") });
  if (p.isCancel(name)) return;
  const type = await p.select({ message: "Type", options: ["string", "text", "int", "number", "money", "boolean", "email", "url", "timestamp", "date", "json", "string[]", "id[]", "enum"].map((t) => ({ value: t, label: t })) });
  if (p.isCancel(type)) return;
  let field: any = { type: String(type), optional: true };
  if (type === "enum") { const vals = await p.text({ message: "Values (a|b|c)" }); if (p.isCancel(vals)) return; field.values = String(vals).split("|").map((s) => s.trim()); }
  const doc = await p.text({ message: "Doc (optional)" });
  if (!p.isCancel(doc) && doc) field.doc = String(doc);
  return apply(app.specPath, "entities", { [String(ent)]: { fields: { [String(name)]: field } } }, { dir: app.dir });
}

async function addShape(app: App, apply: any) {
  const name = await p.text({ message: "Shape name (camelCase; this is the route)", validate: (v) => (/^[a-z][A-Za-z0-9]*$/.test(v) ? undefined : "camelCase") });
  if (p.isCancel(name)) return;
  const asks = await p.text({ message: "What does it answer? (the classifier's description and the chip label)", placeholder: "Find gifts under a budget" });
  if (p.isCancel(asks)) return;
  const call = await p.select({ message: "Which call does the plan run?", options: specCalls(app.spec).map(([n, c]) => ({ value: n, label: n, hint: `${c.kind} · in ${Object.keys(c.in).join(",")} · out ${typeof c.out === "string" ? c.out : "object"}` })) });
  if (p.isCancel(call)) return;
  const callDef = specCalls(app.spec).find(([n]) => n === call)![1];
  const input: Record<string, string> = {};
  const withMap: Record<string, string> = {};
  for (const [k, t] of Object.entries(callDef.in)) {
    const ts = typeof t === "string" ? t : (t as any).type;
    const v = await p.text({ message: `Input "${k}" (${ts}): expose as shape input? (name, or $visitor.id, or a literal, empty = skip)`, initialValue: k === "visitorId" ? "$visitor.id" : k });
    if (p.isCancel(v)) return;
    const s = String(v).trim();
    if (!s) continue;
    if (s.startsWith("$") || /^[\d"[{]/.test(s) || s === "true" || s === "false") withMap[k] = s.startsWith("$") ? s : JSON.parse(s);
    else { input[s] = ts; withMap[k] = `$${s}`; }
  }
  const effect = callDef.kind === "mutation" ? "write" : "read";
  const allow = await p.multiselect({ message: "Personas allowed", options: Object.keys(app.spec.personas).filter((k) => k !== "version" && k !== "doc").map((k) => ({ value: k, label: k })), initialValues: Object.keys(app.spec.personas).filter((k) => k !== "version" && k !== "doc") });
  if (p.isCancel(allow)) return;
  const shape = { asks: String(asks), input, answer: callDef.out, effect, allow, plan: [{ call: String(call), with: withMap }] };
  p.note(JSON.stringify(shape, null, 2), `shapes.${name}`);
  if (!(await p.confirm({ message: "Write it?" }))) return;
  return apply(app.specPath, "shapes", { [String(name)]: shape }, { dir: app.dir });
}

async function editInEditor(app: App, section: string, apply: any) {
  const editor = env("EDITOR", env("VISUAL", "vi"));
  const tmp = mkdtempSync(join(tmpdir(), "fishtea-"));
  const file = join(tmp, `${section}.json`);
  writeFileSync(file, JSON.stringify((app.spec as any)[section] ?? { version: "2026.01.01-1" }, null, 2) + "\n");
  while (true) {
    const proc = Bun.spawn([editor, file], { stdio: ["inherit", "inherit", "inherit"] });
    await proc.exited;
    try {
      const next = JSON.parse(readFileSync(file, "utf8"));
      const r = apply(app.specPath, section, next, { replace: true, dir: app.dir });
      rmSync(tmp, { recursive: true, force: true });
      return r;
    } catch (e) {
      p.log.error(e instanceof SpecError ? e.message : (e as Error).message);
      const again = await p.confirm({ message: "Fix it in the editor?" });
      if (p.isCancel(again) || !again) { rmSync(tmp, { recursive: true, force: true }); return; }
    }
  }
}

async function editWhole(specPath: string, dir: string, core: Core) {
  const editor = env("EDITOR", env("VISUAL", "vi"));
  const proc = Bun.spawn([editor, specPath], { stdio: ["inherit", "inherit", "inherit"] });
  await proc.exited;
  const err = tryLoadError(dir);
  if (err) p.log.error(err); else { p.log.success("spec valid"); if (await core.health()) await core.reload().catch(() => {}); }
}

async function regenerate(app: App, section: string, apply: any) {
  const pkg = existsSync(join(app.dir, "package.json")) ? JSON.parse(readFileSync(join(app.dir, "package.json"), "utf8")) : {};
  const home = pkg.fishtea?.home ?? resolve(app.dir, "..", "..");
  const { listTemplates } = await import(join(home, "packages/cli/src/new.ts"));
  const templates = listTemplates(home);
  const template = pkg.fishtea?.template ?? (await p.select({ message: "Template", options: templates.map((t: any) => ({ value: t.name, label: t.name })) }));
  if (p.isCancel(template)) return;
  const tpl = templates.find((t: any) => t.name === template);
  if (!tpl) throw new Error(`template ${template} not found`);
  const src = JSON.parse(readFileSync(join(tpl.dir, "spec.json"), "utf8"));
  const next = src[section];
  if (!next) throw new Error(`template has no ${section}`);
  if (section === "business") { next.id = app.spec.business.id; next.name = app.spec.business.name; }
  p.note(`This replaces ${section} (v${(app.spec as any)[section]?.version}) with the ${template} template's ${section}. Other sections are untouched.`, "regenerate");
  if (!(await p.confirm({ message: "Proceed?" }))) return;
  return apply(app.specPath, section, next, { replace: true, dir: app.dir });
}

// ── run ─────────────────────────────────────────────────────────────────────

function safeConnect() { try { return connect(process.env.DATABASE_URL); } catch { return null; } }

async function run(o: TuiOptions, app: App | null, core: Core) {
  const what = await p.select({
    message: "Run",
    options: [
      { value: "status", label: "Status of the services" },
      { value: "restart", label: "Restart core", hint: "op.restart" },
      { value: "migrate", label: "Migrate + seed", hint: "fishtea migrate; seed when empty" },
      { value: "unmet", label: "Unmet channel", hint: "op.unmetReport — what people asked that we couldn't answer" },
      { value: "notify", label: "Send a notification to a visitor", hint: "op.notify" },
      { value: "compose", label: "Docker Compose", hint: "up / down / logs" },
    ],
  });
  if (p.isCancel(what)) return;
  if (what === "status") {
    const h = await core.health();
    const lines = [`core       ${h ? pc.green("up") + ` · ${core.url} · classifier ${h.classifier?.name} ${h.classifier?.ok ? pc.green("ok") : pc.yellow("down")} · sse ${h.sse}` : pc.red("down") + ` · ${core.url}`}`];
    const cls = env("CLASSIFIER_URL", "http://localhost:8081");
    try { const r = await fetch(`${cls}/healthz`, { signal: AbortSignal.timeout(1500) }); const j: any = await r.json(); lines.push(`classifier ${j.ok ? pc.green("up") : pc.yellow("not ready")} · ${cls} · ${j.model} · ${j.ready}/${j.workers} workers · ${j.tools} tools · dim ${j.dim}`); } catch { lines.push(`classifier ${pc.red("down")} · ${cls}`); }
    const db = safeConnect();
    if (db) { try { const [{ n }] = await db.unsafe("SELECT count(*)::int AS n FROM conversation.turn"); const d = app ? await entitiesDrift(db, app) : null; lines.push(`db         ${pc.green("up")} · ${n} turns${d?.drifted ? pc.yellow(" · entities drifted: migrate") : ""}`); } catch (e) { lines.push(`db         ${pc.red("error")} ${(e as Error).message}`); } await db.end(); } else lines.push(`db         ${pc.red("no DATABASE_URL")}`);
    p.note(lines.join("\n"), "status");
  } else if (what === "restart") {
    await core.op("op.restart"); p.log.success("restart requested");
  } else if (what === "migrate" && app) {
    const db = safeConnect(); if (!db) throw new Error("DATABASE_URL not set");
    const s = p.spinner(); s.start("migrating");
    const r = await migrate(db, app);
    s.stop(`migrated: ${r.created.length} created, ${r.added.length} added${r.refused.length ? `, refused ${r.refused.join(",")}` : ""}`);
    const counts = await seed(db, app);
    p.log.info(`seeded ${JSON.stringify(counts)}`);
    await db.end();
  } else if (what === "unmet") {
    const since = await p.text({ message: "Since", initialValue: "7d" });
    if (p.isCancel(since)) return;
    const rows = await core.unmet(String(since));
    p.note(rows.length ? rows.slice(0, 40).map((r) => `${String(r.at).slice(0, 16)}  ${pc.bold(r.asked ?? "(chip)")}${r.campaign ? pc.dim(`  ← ${r.campaign}`) : ""}`).join("\n") : "nothing unmet — every question was answered", `unmet (${rows.length})`);
  } else if (what === "notify") {
    const visitors = await core.visitors();
    const v = await p.select({ message: "Visitor", options: visitors.map((x) => ({ value: x.id, label: x.id, hint: `${x.customer_id ?? "anonymous"} · ${x.trails} trails · seen ${String(x.last_seen).slice(0, 16)}` })) });
    if (p.isCancel(v)) return;
    const text = await p.text({ message: "Text" });
    if (p.isCancel(text)) return;
    const r = await core.notify(String(v), String(text));
    p.log.success(`queued${r.delivered ? " and delivered over SSE" : " (delivered on next visit)"}`);
  } else if (what === "compose") {
    const sub = await p.select({ message: "docker compose", options: ["up -d --build", "down", "logs --tail 50 core", "logs --tail 50 classifier", "ps", "restart core"].map((c) => ({ value: c, label: c })) });
    if (p.isCancel(sub)) return;
    const proc = Bun.spawn(["docker", "compose", ...String(sub).split(" ")], { cwd: o.dir, stdio: ["inherit", "inherit", "inherit"], env: { ...process.env, FISHTEA_HOME: o.fishteaHome } });
    await proc.exited;
  }
}

// ── inspect ─────────────────────────────────────────────────────────────────

async function inspect(app: App) {
  const what = await p.select({ message: "Inspect", options: [{ value: "shapes", label: "Shapes" }, { value: "entities", label: "Entities" }, { value: "ddl", label: "Derived DDL" }, { value: "tools", label: "Classifier tool list" }, { value: "hashes", label: "Section versions + hashes" }] });
  if (p.isCancel(what)) return;
  if (what === "shapes") p.note(specShapes(app.spec).map(([n, s]) => `${pc.bold(n.padEnd(18))} ${s.effect === "write" ? pc.magenta("write") : pc.dim("read ")} ${s.allow.join(",").padEnd(36)} ${s.asks}`).join("\n"), "shapes");
  if (what === "entities") p.note(specEntities(app.spec).map(([n, e]) => `${pc.bold(n)}: ${Object.keys(e.fields).join(", ")}`).join("\n"), "entities");
  if (what === "ddl") console.log(deriveDDL(app.spec));
  if (what === "tools") console.log(JSON.stringify(deriveTools(app.spec), null, 2));
  if (what === "hashes") p.note(SECTIONS.map((s) => `${s.padEnd(14)} v${(app.spec as any)[s]?.version ?? "-"}  ${app.hashes[s] ?? ""}`).join("\n"), "sections");
}

export { bumpVersion, validateSpec };
