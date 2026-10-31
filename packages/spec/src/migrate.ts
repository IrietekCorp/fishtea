/**
 * Spec migrations: how a spec.json written by an older framework becomes one this build can load, without
 * regenerating the application.
 *
 * The rule that makes this tractable: migrations key off `spec.fishtea` (the document format), never off
 * the framework version. A format moves only when the vocabulary changes shape, so most framework releases
 * ship no migration at all and every application updates by doing nothing.
 *
 * A migration reports what it changed. An *additive* format change — a new optional section, a new allowed
 * form for an existing field — rewrites nothing and says so; that is the common case and the notes should
 * be honest about it rather than manufacturing activity.
 */

export interface SpecMigration {
  /** the format this migration reads */
  from: string;
  /** the format it leaves behind */
  to: string;
  /** one line, shown in `fishtea update`'s plan */
  doc: string;
  /** mutate `spec` in place; return one note per real change, empty when the change is additive */
  apply(spec: any): string[];
}

/**
 * Ordered, and every `to` must be the next migration's `from`, so a spec three formats behind walks the
 * chain. `migrations()` asserts the chain is unbroken rather than trusting the author of the next one.
 */
export const MIGRATIONS: SpecMigration[] = [
  {
    from: "1.0",
    to: "1.1",
    doc: "adds the optional `plugins` section and the `impl.plugin` call form — both additive",
    apply() {
      // Nothing to rewrite. A 1.0 spec is a valid 1.1 spec: `plugins` is optional and absent means none,
      // and a call that names `impl.sql` or `impl.module` keeps working untouched. Only the marker moves.
      return [];
    },
  },
  {
    from: "1.1",
    to: "1.2",
    doc: "adds the optional `echoes` section (outbound reverbs of a turn, served at /echo) — additive",
    apply() {
      // A 1.1 spec is a valid 1.2 spec: `echoes` is optional, and absent means /echo refuses everything.
      return [];
    },
  },
];

export class MigrationError extends Error {}

/** The migration chain, verified contiguous. Throws if someone adds a migration that skips a format. */
export function migrations(): SpecMigration[] {
  for (let i = 1; i < MIGRATIONS.length; i++) {
    if (MIGRATIONS[i].from !== MIGRATIONS[i - 1].to) {
      throw new MigrationError(`migration chain is broken: ${MIGRATIONS[i - 1].to} is followed by a migration from ${MIGRATIONS[i].from}`);
    }
  }
  return MIGRATIONS;
}

export interface MigrationPlan {
  from: string;
  to: string;
  /** the migrations that would run, in order */
  steps: SpecMigration[];
  /** true when the spec is already at `to` */
  current: boolean;
}

/** What it would take to bring `format` up to `target`. Does not touch anything. */
export function planMigration(format: string, target: string): MigrationPlan {
  const chain = migrations();
  if (format === target) return { from: format, to: target, steps: [], current: true };
  const start = chain.findIndex((m) => m.from === format);
  if (start < 0) {
    const known = chain.map((m) => m.from).concat(chain.at(-1)?.to ?? []).join(", ");
    throw new MigrationError(`no migration path from spec format "${format}" (this build knows: ${known})`);
  }
  const steps: SpecMigration[] = [];
  for (let i = start; i < chain.length; i++) {
    steps.push(chain[i]);
    if (chain[i].to === target) return { from: format, to: target, steps, current: false };
  }
  throw new MigrationError(`spec format "${format}" is newer than this build understands (target ${target}) — upgrade the framework`);
}

export interface MigrationResult {
  spec: any;
  from: string;
  to: string;
  /** every note every step produced; empty means the migration was purely a marker bump */
  notes: string[];
  steps: SpecMigration[];
}

/**
 * Run the chain against a *copy* of the spec. The caller decides whether to write it, which is what lets
 * `fishtea update --dry-run` show the plan and change nothing.
 */
export function migrateSpec(raw: any, target: string): MigrationResult {
  const format = String(raw?.fishtea ?? "1.0");
  const plan = planMigration(format, target);
  const spec = structuredClone(raw);
  const notes: string[] = [];
  for (const step of plan.steps) {
    for (const note of step.apply(spec)) notes.push(`${step.from}→${step.to}: ${note}`);
    spec.fishtea = step.to;
  }
  return { spec, from: format, to: target, notes, steps: plan.steps };
}
