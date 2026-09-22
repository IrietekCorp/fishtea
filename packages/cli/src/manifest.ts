/**
 * Provenance: what the framework put in an application directory, and what it looked like at the time.
 *
 * `fishtea new` copies a template's `calls/`, `seed/`, `rules/` and `scripts/` into the new application and
 * then forgets about them — which is why, until now, picking up a fixed `products_search.sql` meant
 * regenerating the whole application and losing your edits. The manifest is the missing half: for every file
 * the framework wrote, the hash it had when we wrote it.
 *
 * With that one fact, an update is a three-way reconcile and never a guess:
 *
 *            template changed?   you changed it?   what happens
 *   ─────────────────────────────────────────────────────────────────────────────
 *            no                  no                nothing
 *            yes                 no                updated in place
 *            no                  yes               left alone — it is yours now
 *            yes                 yes               conflict: the new version lands beside it as `.new`
 *            —                   you deleted it    left deleted; we do not resurrect files
 *
 * The manifest is meant to be committed with the application. It is the only record of where a file came
 * from, so a teammate on another machine reconciles the same way you would.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const MANIFEST_DIR = ".fishtea";
export const MANIFEST_FILE = "manifest.json";

/** Directories a template contributes to an application. Everything else in a template is framework business. */
export const TEMPLATE_DIRS = ["calls", "seed", "rules", "scripts"] as const;

/**
 * The merge base for one file: what the archetype said, and what we actually left in the application.
 *
 * They are not always the same. `fishtea new` *transforms* some files as it copies them — an affiliate-only
 * shop has its seed rows filtered, an answered interview rewrites seed fields — so recording only the
 * application's hash would make the archetype's untouched original look like an upstream change on the very
 * next update. Two hashes, two questions: has the archetype moved, and have you edited it.
 */
export interface FileProvenance {
  /** hash of the archetype's file when we last copied from it */
  template: string;
  /** hash of what we left in the application (may differ: the scaffolder transforms some files) */
  app: string;
}

export interface AppManifest {
  /** framework version that last wrote this manifest */
  fishtea: string;
  /** spec document format at that time */
  specFormat: string;
  /** the archetype this application came from */
  template: string;
  /** relative posix path → the two hashes that make up its merge base */
  files: Record<string, FileProvenance>;
  created: string;
  updated: string;
}

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 32);
}

export function hashFile(path: string): string | null {
  if (!existsSync(path) || !statSync(path).isFile()) return null;
  return sha256(readFileSync(path));
}

/** Always store posix-style, so a manifest written on Windows reconciles on Linux. */
const posix = (p: string) => p.split(sep).join("/");

/** Every file a template contributes, as paths relative to the template (or application) root. */
export function templateFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(posix(relative(root, full)));
    }
  };
  for (const d of TEMPLATE_DIRS) walk(join(root, d));
  return out;
}

export function manifestPath(appDir: string): string {
  return join(appDir, MANIFEST_DIR, MANIFEST_FILE);
}

export function readManifest(appDir: string): AppManifest | null {
  const p = manifestPath(appDir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as AppManifest;
  } catch {
    return null; // a corrupt manifest is the same as none: we fall back to treating every file as yours
  }
}

export function writeManifest(appDir: string, m: AppManifest): void {
  mkdirSync(join(appDir, MANIFEST_DIR), { recursive: true });
  writeFileSync(manifestPath(appDir), JSON.stringify(m, null, 2) + "\n");
}

/**
 * Record the state of a freshly scaffolded application: for every file the archetype contributed, the
 * archetype's hash and the application's hash, which the scaffolder may already have made differ.
 */
export function captureManifest(appDir: string, templateDir: string, o: { fishtea: string; specFormat: string; template: string; created?: string }): AppManifest {
  const files: Record<string, FileProvenance> = {};
  for (const rel of templateFiles(templateDir)) {
    const tpl = hashFile(join(templateDir, rel));
    const app = hashFile(join(appDir, rel));
    if (tpl && app) files[rel] = { template: tpl, app };
  }
  const now = new Date().toISOString();
  return { fishtea: o.fishtea, specFormat: o.specFormat, template: o.template, files, created: o.created ?? now, updated: now };
}

export type FileStatus = "unchanged" | "update" | "yours" | "conflict" | "deleted" | "new";

export interface FileVerdict {
  rel: string;
  status: FileStatus;
  /** the template's current bytes, when there are any to write */
  incoming?: string;
  /** the template's current hash, so applyUpdate can record a new merge base without re-reading */
  incomingHash?: string;
}

/**
 * Reconcile one application against the template it came from. Pure: reads, decides, writes nothing.
 *
 * A file the manifest does not mention but the template now ships is `new` — the archetype grew a file
 * since this application was made, and there is no edit of yours to protect, so it is safe to add.
 */
export function reconcile(appDir: string, templateDir: string, manifest: AppManifest | null): FileVerdict[] {
  const verdicts: FileVerdict[] = [];
  for (const rel of templateFiles(templateDir)) {
    const incomingPath = join(templateDir, rel);
    const incoming = readFileSync(incomingPath, "utf8");
    const incomingHash = sha256(readFileSync(incomingPath));
    const recorded = manifest?.files[rel];
    const current = hashFile(join(appDir, rel));

    // Resolved by agreement. If the application's file is now byte-identical to the archetype's, there is
    // nothing left to reconcile however the two got there — you accepted a `.new`, you reverted an edit, or
    // you happened to make the same change upstream did. Without this, accepting a conflict would leave the
    // merge base stale and the file would report as conflicting forever.
    if (current !== null && current === incomingHash) {
      verdicts.push({ rel, status: "unchanged", incomingHash });
      continue;
    }

    if (recorded === undefined) {
      // Never recorded. If the application has no such file, the template grew one: add it. If it *does*
      // have one, it predates the manifest (or someone wrote it by hand) — treat it as theirs.
      verdicts.push(current === null ? { rel, status: "new", incoming, incomingHash } : { rel, status: "yours" });
      continue;
    }
    if (current === null) { verdicts.push({ rel, status: "deleted" }); continue; }

    // Two independent questions against two independent bases. This is the whole trick.
    const youChanged = current !== recorded.app;
    const templateChanged = incomingHash !== recorded.template;

    if (!youChanged && !templateChanged) verdicts.push({ rel, status: "unchanged" });
    else if (!youChanged && templateChanged) verdicts.push({ rel, status: "update", incoming, incomingHash });
    else if (youChanged && !templateChanged) verdicts.push({ rel, status: "yours" });
    else verdicts.push({ rel, status: "conflict", incoming, incomingHash });
  }
  return verdicts;
}

export const COUNTS = (v: FileVerdict[]) => {
  const c: Record<FileStatus, number> = { unchanged: 0, update: 0, yours: 0, conflict: 0, deleted: 0, new: 0 };
  for (const x of v) c[x.status]++;
  return c;
};
