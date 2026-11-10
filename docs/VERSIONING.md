# Versioning and updates

An application generated from FishTea is its own project, with its own git history, its own edits and its
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
the entire point of a pin: not ceremony, but permission to do nothing.

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
every command that runs an application warns once if the pin is not satisfied, because the symptom
otherwise shows up much deeper, as something confusing.

Two ways to be incompatible, with opposite fixes:

- **framework-behind**: the application wants a newer framework than this one. Upgrade the framework.
- **framework-ahead**: the framework has moved past the application's pin. Run `fishtea update`.

## Updating an application

```bash
fishtea update --dry-run    # show the plan, change nothing
fishtea update              # carry it out
```

Three things get reconciled, and you are told about each before anything is written.

### The pin

Moved forward to accept the running framework and its future minors.

### The install it builds from

`package.json`'s `fishtea.home`, `.env`'s `FISHTEA_HOME`, `.env.example` and the compose defaults all name
the framework install the core image is built from. Where they point into `~/.fishtea/versions/<older>`,
they move to this version too; otherwise the pin says 1.2 while the core is still built from 1.1. Only
installed-version paths move, and only when this version is installed: a checkout you pointed
`FISHTEA_HOME` at is yours, and an update run from a checkout never points at a directory that is not there.

### The spec

If `spec.json` is at an older format, the migration chain runs against it. An *additive* format change,
a new optional section or a new allowed form for an existing field, rewrites nothing and says so rather
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

Two hashes rather than one, because they are not always the same: the scaffolder *transforms* files as
it copies them, filtering seed rows and rewriting fields from your interview answers. Recording only one
would make every untouched archetype file look like an upstream change on the very next update.

With both, an update is a three-way merge and never a guess:

| the archetype changed it | you changed it | what happens |
|---|---|---|
| no | no | nothing |
| **yes** | no | updated in place |
| no | **yes** | left alone: it is yours now, and stays yours through every future release |
| **yes** | **yes** | conflict: your file stands, theirs lands beside it as `<file>.new` |
| n/a | you deleted it | left deleted; files are never resurrected |

A conflict clears when your file and the archetype's agree again, however they got there. Accept the
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
unrecorded, which reads as "yours" forever, so adoption can never cause a later update to overwrite an
edit you made before tracking began.

## Installing and switching framework versions

```bash
./install.sh --from /path/to/fishtea                 # build from a checkout: the only route today
```

That is the only route until release binaries are published at `fishtea.io`: the installer's download
path has nothing to fetch yet, and `fishtea upgrade` says so and points at `--from`. The same script
serves both; once releases are published it will also install from the site and take a version
argument, with no change to what lands on disk. A download is checked against the release's
`SHA256SUMS` and refused when it cannot be: no checksum file, no line for the tarball, or no tool to
hash it with. A self-hosted mirror without checksums says so with `FISHTEA_INSECURE_DOWNLOAD=1`.

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
application stands: its pin, whether the running build satisfies it, its spec format, which build
generated it. It can plan and apply an update, or switch framework version, without leaving the
application directory. The plan is shown first and applied only on a second keypress.

## Releasing the framework

```bash
bun run release 1.2.0         # the only writer of every version site
bun run release --check       # assert they all agree (the test suite runs this)
bun run build-release --install --tarball
```

`release` rewrites the literal in `packages/spec/src/release.ts`, every workspace `package.json`, and
`bun.lock`, which repeats each member's version, and which nothing regenerated until 1.7.1, so the
committed lockfile said 1.1.0 for six releases and dirtied every clean clone's first `bun install`. It is
regenerated with `bun install --lockfile-only`, and `--check` now reads it as a version site like any
other. `build-release` compiles the binary and stages the runtime files beside it; `--compile` embeds
code, not data directories, so `templates/`, `plugins/` and `packages/ui` ship alongside it.

Publishing is deliberately not automated:

```bash
bun run release 1.2.0 && bun test packages && git commit -am "Release 1.2.0" && git tag v1.2.0
```

## The layers underneath

The framework's own version is one number. Underneath it are other people's: Bun, Postgres with
pgvector, the needle classifier, the npm packages for the server, the browser and the styles, and the
components adapted from shadcn/ui and 21st.dev. Each moves on its own schedule, and each is wrong in its
own way when it does. `bun run deps` is the one place that knows all of them.

```bash
bun run deps                              # every layer: what is pinned, what is newer, what moves it
bun run deps bun 1.4.4                    # env.ts, .bun-version and Dockerfile.core, together
bun run deps postgres pgvector/pgvector:0.8.8-pg18-trixie
bun run deps classifier 3.2.10            # cactus-needle in packages/classifier/requirements.txt
bun run deps npm vite@^8.3.7              # in every workspace that declares it
bun run deps components --record          # after porting an upstream change by hand
```

Every pin has one source and a test that holds the copies to it: `BUN_VERSION` and `POSTGRES_IMAGE` in
`packages/cli/src/env.ts`, with `scripts/pins.test.ts` and `scripts/postgres.test.ts` failing when a
Dockerfile, a compose file, CI or the docs disagree. Exact versions only, because a floating tag is a
build that changes underneath you: `oven/bun:1` floated for months while CI ran an exact Bun.

The classifier has a second pin under the first. cactus-needle is a pure-Python package that downloads
its native engine and weights from the `main` branch of a Hugging Face repository, and on 2026-11-05
upstream removed the engines from that branch, so every fresh image of a pinned version failed to
build. `packages/classifier/engine.py` fetches them instead from the Hub commit each version shipped
against, refuses any file whose sha256 is not recorded there, and the image warms up offline to prove it
found everything. Moving cactus-needle means adding the new version's commit and hashes to it; the
build, and `scripts/pins.test.ts`, refuse a version that has none.

Moving a layer prints its gates rather than running them, because some are judgements:

| Layer | Before it is a release |
|---|---|
| Bun | the suite, the typecheck, the walkthrough, `build-release` (the binary is Bun too), the images |
| Postgres | recreate the test database from the new image, the suite; a new **major** is a dump and restore for every application, and the release notes say so |
| classifier | its engine pinned in `engine.py`, then `fishtea eval` on every labelled set, before and after (the floor was measured on the old engine), and the bench, since latency is decode length |
| npm | the suite, the typecheck, the walkthrough, `bun audit`, and each application's ui built against it |
| components | the walkthrough, whose a11y suite runs axe on every vessel |

The components are rewrites, not copies (shadcn's button gained `write` and `chip`), so upstream can never
be merged in. `packages/ui/src/components/provenance.json` records where each came from, its licence
and a fingerprint of upstream; `deps` reports when upstream has moved, and a person ports what is worth
porting. 21st.dev serves component source only to signed-in accounts and publishes no licence in its
registry, so those are checked by hand and reported as unknown until someone records one.

CI fails on any published advisory (`bun audit`), which is how a layer that needs moving announces it.

### What reaches an application

An application builds on the framework's images, so most layers arrive with `fishtea update`. Two do not,
because they are the application's own files: the Postgres its `docker-compose.yml` names, and the Bun
its own Dockerfiles (a `deploy/Dockerfile`, say) build from. `fishtea doctor` reads both. A different
PostgreSQL **major** fails, since pgdata does not move between majors; anything else is drift worth
naming and nothing more, because an application may pin its own build on purpose.
