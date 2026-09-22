/**
 * `fishtea update` — bring an application up to this framework build without regenerating it.
 *
 * Three things can be out of date, and they are handled separately because they fail separately:
 *
 *   the pin        package.json → fishtea.version, the range this application accepts. A minor release
 *                  satisfies `^1.1.0` and needs no action at all; that is the whole point of the pin.
 *   the spec       spec.json → `fishtea`, the document format. Migrated by the chain in @fishtea/spec.
 *   the files      calls/, seed/, rules/, scripts/ — copied from a template at scaffold time and, until
 *                  the manifest existed, frozen forever. Reconciled three ways (see manifest.ts).
 *
 * Nothing is written without saying what will be written first. `--dry-run` stops after the plan.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pc from "picocolors";
import { FISHTEA_VERSION, SPEC_FORMAT, bumpVersion, caretRange, checkCompatibility, migrateSpec, sectionHashes, validateSpec, SpecError } from "@fishtea/spec";
import { COUNTS, hashFile, readManifest, reconcile, sha256, templateFiles, writeManifest, type AppManifest, type FileProvenance, type FileVerdict } from "./manifest.ts";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface UpdatePlan {
  appDir: string;
  template: string;
  templateDir: string;
  /** the range in package.json, if any */
  pin?: string;
  pinSatisfied: boolean;
  specFrom: string;
  specTo: string;
  specSteps: { from: string; to: string; doc: string }[];
  specNotes: string[];
  verdicts: FileVerdict[];
  manifest: AppManifest | null;
  /** nothing to do */
  clean: boolean;
}

function appPackage(appDir: string): any {
  const p = join(appDir, "package.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
}

/** Work out everything that would change. Reads only. */
export function planUpdate(appDir: string, fishteaHome: string): UpdatePlan {
  const pkg = appPackage(appDir);
  const manifest = readManifest(appDir);
  const template = manifest?.template ?? pkg.fishtea?.template;
  if (!template) throw new Error(`cannot tell which archetype ${appDir} came from — add "fishtea": { "template": "<name>" } to its package.json`);
  const templateDir = join(fishteaHome, "templates", template);
  if (!existsSync(templateDir)) throw new Error(`this framework has no "${template}" template (looked in ${templateDir})`);

  const pin: string | undefined = pkg.fishtea?.version;
  const pinSatisfied = checkCompatibility(pin).ok;

  const rawSpec = JSON.parse(readFileSync(join(appDir, "spec.json"), "utf8"));
  const specFrom = String(rawSpec.fishtea ?? "1.0");
  const migration = migrateSpec(rawSpec, SPEC_FORMAT);
  const verdicts = reconcile(appDir, templateDir, manifest);
  const c = COUNTS(verdicts);

  return {
    appDir, template, templateDir, pin, pinSatisfied,
    specFrom, specTo: SPEC_FORMAT,
    specSteps: migration.steps.map((s) => ({ from: s.from, to: s.to, doc: s.doc })),
    specNotes: migration.notes,
    verdicts, manifest,
    clean: specFrom === SPEC_FORMAT && c.update === 0 && c.conflict === 0 && c.new === 0 && (manifest?.fishtea === FISHTEA_VERSION),
  };
}

export function renderPlan(plan: UpdatePlan): string {
  const L: string[] = [];
  const c = COUNTS(plan.verdicts);
  L.push(`${pc.bold("framework")}  ${plan.manifest?.fishtea ?? "unknown"} → ${FISHTEA_VERSION}${plan.pin ? pc.dim(`  (pinned ${plan.pin}${plan.pinSatisfied ? "" : pc.red(" — not satisfied")})`) : ""}`);
  L.push(`${pc.bold("archetype")}  ${plan.template}`);
  if (plan.specFrom === plan.specTo) L.push(`${pc.bold("spec")}       format ${plan.specFrom} ${pc.dim("(current)")}`);
  else {
    L.push(`${pc.bold("spec")}       format ${plan.specFrom} → ${plan.specTo}`);
    for (const s of plan.specSteps) L.push(`             ${pc.dim(`${s.from}→${s.to}  ${s.doc}`)}`);
    if (!plan.specNotes.length) L.push(`             ${pc.dim("additive: the marker moves, nothing in your spec is rewritten")}`);
    for (const n of plan.specNotes) L.push(`             ${n}`);
  }
  L.push(`${pc.bold("files")}      ${c.update} to update, ${c.new} new, ${c.conflict} conflicting, ${c.yours} yours, ${c.unchanged} unchanged${c.deleted ? `, ${c.deleted} deleted` : ""}`);
  for (const v of plan.verdicts) {
    if (v.status === "update") L.push(`   ${pc.green("↑")} ${v.rel}`);
    else if (v.status === "new") L.push(`   ${pc.green("+")} ${v.rel}`);
    else if (v.status === "conflict") L.push(`   ${pc.yellow("!")} ${v.rel} ${pc.dim("— you changed it and so did the archetype; the new one lands as .new")}`);
  }
  if (!plan.manifest) L.push(pc.yellow(`\n  no manifest: this application predates provenance tracking.`));
  return L.join("\n");
}

export interface UpdateResult { wrote: string[]; conflicts: string[]; specMigrated: boolean }

/** Carry out a plan. */
export function applyUpdate(plan: UpdatePlan, opts: { specOnly?: boolean; filesOnly?: boolean } = {}): UpdateResult {
  const wrote: string[] = [];
  const conflicts: string[] = [];
  let specMigrated = false;

  if (!opts.filesOnly && plan.specFrom !== plan.specTo) {
    const specPath = join(plan.appDir, "spec.json");
    const raw = JSON.parse(readFileSync(specPath, "utf8"));
    const { spec } = migrateSpec(raw, plan.specTo);
    // The business's own revision moves too: the document changed, and every consumer keys off that.
    spec.business.version = bumpVersion(spec.business.version);
    validateSpec(spec, { dir: plan.appDir }); // refuse to write a spec this build cannot load
    writeFileSync(specPath, JSON.stringify(spec, null, 2) + "\n");
    wrote.push("spec.json");
    specMigrated = true;
  }

  if (!opts.specOnly) {
    for (const v of plan.verdicts) {
      if (v.status === "update" || v.status === "new") {
        const dest = join(plan.appDir, v.rel);
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, v.incoming!);
        wrote.push(v.rel);
      } else if (v.status === "conflict") {
        const dest = join(plan.appDir, v.rel + ".new");
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, v.incoming!);
        conflicts.push(v.rel);
      }
    }
  }

  // Re-base provenance, file by file, and only where we actually did something.
  //
  //   written        we put the archetype's bytes there verbatim, so both bases are the archetype's hash
  //   conflict       the .new sits beside it; the base does NOT move, so the conflict is still reported
  //                  next time if they ignore it — silently adopting it would lose their edit
  //   yours          untouched base, so it stays yours through every future update
  //   unchanged      may be stale after a resolved conflict: the file agrees with the archetype again, so
  //                  rebase it too, which is what finally clears that conflict
  const files: Record<string, FileProvenance> = { ...(plan.manifest?.files ?? {}) };
  for (const v of plan.verdicts) {
    const agrees = v.status === "unchanged" && v.incomingHash;
    const written = (v.status === "update" || v.status === "new") && wrote.includes(v.rel) && v.incomingHash;
    if (agrees || written) files[v.rel] = { template: v.incomingHash!, app: v.incomingHash! };
  }
  const now = new Date().toISOString();
  writeManifest(plan.appDir, {
    fishtea: FISHTEA_VERSION,
    specFormat: plan.specTo,
    template: plan.template,
    files,
    created: plan.manifest?.created ?? now,
    updated: now,
  });

  // Move the pin forward so the application accepts this build and its future minors.
  const pkgPath = join(plan.appDir, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    pkg.fishtea = { ...(pkg.fishtea ?? {}), version: caretRange(FISHTEA_VERSION), template: plan.template };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }

  return { wrote, conflicts, specMigrated };
}

/**
 * Adopt an application that predates the manifest. Only files that *currently match* the archetype are
 * recorded; anything that differs is left unrecorded, which reconcile() reads as "yours". That way
 * adoption can never cause the next update to overwrite an edit made before we started tracking.
 */
export function adopt(appDir: string, templateDir: string, template: string): AppManifest {
  const files: Record<string, FileProvenance> = {};
  for (const rel of templateFiles(templateDir)) {
    const appHash = hashFile(join(appDir, rel));
    if (appHash === null) continue;
    const tplHash = sha256(readFileSync(join(templateDir, rel)));
    // Only files that still match the archetype exactly get a base. Anything that differs is left
    // unrecorded, which reconcile() reads as "yours" — adoption can never overwrite a pre-existing edit.
    if (appHash === tplHash) files[rel] = { template: tplHash, app: appHash };
  }
  const rawSpec = JSON.parse(readFileSync(join(appDir, "spec.json"), "utf8"));
  const now = new Date().toISOString();
  const m: AppManifest = { fishtea: FISHTEA_VERSION, specFormat: String(rawSpec.fishtea ?? "1.0"), template, files, created: now, updated: now };
  writeManifest(appDir, m);
  return m;
}
