# Versioning and updates

An application generated from Fishtea is its own project, with its own git history, its own edits and its
own life. The framework moves underneath it. This is how those two facts are kept from fighting.

## Three versions, kept apart

They are separate because they fail separately, and conflating them is what makes upgrades frightening.

| version | where | what it answers |
|---|---|---|
| **framework** | `fishtea --version` | which build of the framework is running |
| **spec format** | `spec.json` → `fishtea` | the shape of the spec *document* |
| **business revision** | `spec.json` → `business.version` | which revision of *your* business this is |

The framework is semver. An application pins a range in its `package.json`:

```json
"fishtea": { "template": "ecommerce", "version": "^1.1.0", "home": "/path/to/fishtea" }
```

A minor release satisfies `^1.1.0`, so most upgrades need no action from an application at all. That is
the entire point of a pin — not ceremony, but permission to do nothing.

The spec format moves only when the vocabulary changes shape, which is far rarer than the code changing.
Migrations key off the *format*, never off the framework version, so one migration serves many releases
and most releases ship none.

## Checking where you stand

```bash
fishtea version
```

```
fishtea      1.2.0
spec format 1.2
bun         1.4.0
home        /home/you/.fishtea/versions/1.2.0

application /home/you/projects/myshop
  archetype  ecommerce
  pins       ^1.1.0 ✓ satisfied
  spec       format 1.1 → 1.2 available (fishtea update) · business v2026.09.22-3
  generated  by 1.1.0, updated 2026-09-22
```

`fishtea doctor` reports the same compatibility line alongside the database, classifier and binding, and
every command that runs an application warns once if the pin is not satisfied — because the symptom
otherwise shows up much deeper, as something confusing.

Two ways to be incompatible, with opposite fixes:

- **framework-behind** — the application wants a newer framework than this one. Upgrade the framework.
- **framework-ahead** — the framework has moved past the application's pin. Run `fishtea update`.

## Updating an application

```bash
fishtea update --dry-run    # show the plan, change nothing
fishtea update              # carry it out
```

Three things get reconciled, and you are told about each before anything is written.

### The pin

Moved forward to accept the running framework and its future minors.

### The spec

If `spec.json` is at an older format, the migration chain runs against it. An *additive* format change —
a new optional section, a new allowed form for an existing field — rewrites nothing and says so rather
than manufacturing activity:

```
spec       format 1.1 → 1.2
             1.1→1.2  adds the optional `plugins` section and the `impl.plugin` call form — both additive
             additive: the marker moves, nothing in your spec is rewritten
```

A migrated spec is validated before it is written. A spec this build could not load is never saved.

### The files

`calls/`, `seed/`, `rules/` and `scripts/` were copied from an archetype when the application was
created. `.fishtea/manifest.json` records, for every one of those files, **two** hashes: what the
archetype said, and what was actually left in your directory.

Two hashes rather than one, because they are not always the same — the scaffolder *transforms* files as
it copies them, filtering seed rows and rewriting fields from your interview answers. Recording only one
would make every untouched archetype file look like an upstream change on the very next update.

With both, an update is a three-way merge and never a guess:

| the archetype changed it | you changed it | what happens |
|---|---|---|
| no | no | nothing |
| **yes** | no | updated in place |
| no | **yes** | left alone — it is yours now, and stays yours through every future release |
| **yes** | **yes** | conflict: your file stands, theirs lands beside it as `<file>.new` |
| — | you deleted it | left deleted; files are never resurrected |

A conflict clears when your file and the archetype's agree again — however they got there. Accept the
`.new`, revert your edit, or happen to make the same change; any of them ends it. Ignoring a `.new` does
not: the conflict is reported again next time, because silently adopting it would lose your edit.

```
files      2 to update, 1 new, 1 conflicting, 3 yours, 21 unchanged

   ↑ calls/cart_add.sql
   + calls/products_newest.sql
   ! calls/products_related.sql — you changed it and so did the archetype; the new one lands as .new
```

Commit `.fishtea/manifest.json` with the application. It is the only record of where a file came from, so
a teammate on another machine reconciles the same way you would.

`--spec-only` and `--files-only` each do just their half.

### Applications made before any of this existed

```bash
fishtea update --adopt --template ecommerce
```

Adoption claims only files that *currently match* the archetype exactly. Anything that differs is left
unrecorded, which reads as "yours" forever — so adoption can never cause a later update to overwrite an
edit you made before tracking began.

## Installing and switching framework versions

```bash
curl -fsSL https://fishtea.dev/install | bash        # the newest release
curl -fsSL https://fishtea.dev/install | bash -s 1.1.0
./install.sh --from /path/to/fishtea                 # build from a checkout
```

The layout is deliberate:

```
~/.fishtea/
  versions/1.1.0/        a whole framework: bin/fishtea, templates/, plugins/, packages/ui/
  versions/1.2.0/
  current -> versions/1.2.0
  bin/fishtea -> ../current/bin/fishtea      ← the only thing on PATH
```

```bash
fishtea versions          # everything installed; * is running
fishtea use 1.1.0         # switch — one symlink
fishtea upgrade           # install the newest beside the current one and switch
fishtea upgrade --from /path/to/fishtea
fishtea uninstall 1.0.0   # the current version is protected
```

Switching is repointing one symlink, which matters most for going *back*. A framework you cannot
downgrade is a framework you are afraid to upgrade, so nothing is deleted on upgrade and the version in
use cannot be removed out from under itself.

**Upgrading the framework never touches an application.** An application moves when *it* runs `fishtea
update`, which is a separate step you can read first. That separation is what lets you carry the
framework forward across several projects without auditing all of them at once.

## In the console

`fishtea tui` → screen **6, Versions**. What is running, what else is installed, and where this
application stands — its pin, whether the running build satisfies it, its spec format, which build
generated it. It can plan and apply an update, or switch framework version, without leaving the
application directory. The plan is shown first and applied only on a second keypress.

## Releasing the framework

```bash
bun run release 1.2.0         # the only writer of every version site
bun run release --check       # assert they all agree (the test suite runs this)
bun run build-release --install --tarball
```

`release` rewrites the literal in `packages/spec/src/release.ts` and every workspace `package.json` in one
move. `build-release` compiles the binary and stages the runtime files beside it — `--compile` embeds
code, not data directories, so `templates/`, `plugins/` and `packages/ui` ship alongside it.

Publishing is deliberately not automated:

```bash
bun run release 1.2.0 && bun test packages && git commit -am "Release 1.2.0" && git tag v1.2.0
```
