/**
 * `fishtea present [shape…] [--live] [--core URL] [--args JSON]`
 *
 * How each shape's answer will be laid out — the tree `resolvePresent` builds, which is what the core sends
 * as `pour.present`: its organisms, the part of the answer each reads, the molecule its rows use and what
 * clicking one asks, marked declared, inline or derived. Then `rules.present` is checked against the spec
 * (the same check `validate` runs), and a problem is a non-zero exit.
 *
 * With --live it asks a running core for each answer, and shows how the first row of each section reads,
 * the figures a stats organism computes and the values a facet offers. It asks as one visitor, remembered
 * in the application's `.fishtea/present.visitor`, so checking a layout never mints a new anonymous visitor.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pc from "picocolors";
import { checkPresent, presentRows, resolvePresent, textPresent, type App, type ResolvedOrganism } from "@fishtea/spec";

export interface PresentOptions { shapes: string[]; live: boolean; core: string; args: Record<string, unknown> }

type Pour = { kind: string; answer?: unknown; phrase: string; present?: unknown };

const tag = (src?: string) => src === "declared" ? pc.green("declared") : src === "inline" ? pc.cyan("inline") : pc.yellow("derived");
const cut = (v: string) => (v.length > 90 ? v.slice(0, 87) + "…" : v);
const read = (v: unknown, path: string): unknown => path === "$" ? v : path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), v);

function lines(o: ResolvedOrganism, answer: unknown, scope: unknown): string[] {
  const label = o.title ? pc.dim(`  “${textPresent(o.title, scope) || String(o.title)}”`) : "";
  const out = [`  ${pc.bold(o.organism.padEnd(9))} ${o.from ? `from ${o.from}` : ""}${label}`];
  if (answer !== undefined) for (const s of o.stats ?? []) out.push(`            ${textPresent(s.label, scope).padEnd(18)} ${textPresent(s.value, scope) || pc.dim("(empty — hidden)")}${s.go ? pc.dim(` → ${s.go.shape}`) : ""}`);
  if (answer !== undefined) for (const f of o.facets ?? []) {
    const src = f.from ? read(answer, f.from) : undefined;
    const vals = f.field ? [...new Set((Array.isArray(src) ? src : []).flatMap((r) => (read(r, f.field!) as string[]) ?? []))] : Array.isArray(src) ? src : [];
    out.push(`            ${f.label.padEnd(12)} sets ${f.arg}${pc.dim(` · ${vals.length} values`)}`);
  }
  if (o.tagGo) out.push(`            click → ${o.tagGo.shape}`);
  const m = o.molecule;
  if (!m) return out;
  out.push(`            molecule ${m.as ?? "card"} ${pc.dim("(")}${tag(o.moleculeSource)}${pc.dim(")")}${m.go ? ` → ${m.go.shape}` : ""}${(m.tags ?? []).map((t) => pc.dim(` · tags ${t.from}${t.go ? ` → ${t.go.shape}` : ""}`)).join("")}`);
  if (answer === undefined) return out;
  const rows = presentRows(o, answer);
  out.push(pc.dim(`            ${rows.length} row${rows.length === 1 ? "" : "s"}`));
  if (rows[0] !== undefined) for (const slot of ["number", "eyebrow", "title", "subtitle", "body", "meta", "hint", "cta"] as const) {
    const v = textPresent(m[slot], rows[0]);
    if (v) out.push(`              ${slot.padEnd(8)} ${cut(v)}`);
  }
  return out;
}

export async function present(app: App, appDir: string, o: PresentOptions): Promise<number> {
  const spec = app.spec as never;
  const shapes = o.shapes.length ? o.shapes : Object.entries(app.spec.shapes).filter(([k, s]) => k !== "version" && (s as { effect?: string }).effect === "read").map(([k]) => k);
  const visitorFile = join(appDir, ".fishtea", "present.visitor");
  let visitor = existsSync(visitorFile) ? readFileSync(visitorFile, "utf8").trim() : "";

  const ask = async (shape: string): Promise<Pour> => {
    const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "fishtea-present", "x-fishtea-tool": "present" };
    if (visitor) headers["x-fishtea-visitor"] = visitor;
    const r = await fetch(`${o.core}/utter`, { method: "POST", headers, body: JSON.stringify({ shape, args: o.args, submit: true }) });
    const j = (await r.json()) as { pour: Pour; visitor?: { id: string } };
    if (j.visitor?.id && j.visitor.id !== visitor) {
      visitor = j.visitor.id;
      try { mkdirSync(join(appDir, ".fishtea"), { recursive: true }); writeFileSync(visitorFile, visitor + "\n"); } catch { /* read-only: fine */ }
    }
    if (j.pour.kind !== "answer") throw new Error(`${shape} poured ${j.pour.kind}: ${j.pour.phrase}`);
    return j.pour;
  };

  for (const shape of shapes) {
    if (!(shape in app.spec.shapes)) { console.log(`${shape}: no such shape`); continue; }
    let pour: Pour | undefined;
    if (o.live) try { pour = await ask(shape); } catch (e) { console.log(pc.dim(`  (live: ${(e as Error).message})`)); }
    const answer = pour?.answer;
    const tree = resolvePresent(spec, shape, answer);
    const scope = { ...(answer && typeof answer === "object" && !Array.isArray(answer) ? answer : {}), $phrase: pour?.phrase, $args: o.args, $answer: answer };
    console.log(`\n${pc.bold(shape)}  ${tag(tree.source)}${pour?.present ? pc.dim("  (the core sent its own tree)") : ""}`);
    for (const org of tree.organisms) console.log(lines(org, answer, scope).join("\n"));
  }

  const problems = checkPresent(spec);
  console.log(problems.length ? `\n${pc.red(`${problems.length} problem(s)`)}\n${problems.map((p) => `  ${p}`).join("\n")}` : `\n${pc.green("✓")} rules.present is consistent with the spec`);
  return problems.length ? 1 : 0;
}
