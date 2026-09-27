# FishTea — build brief

Describe a business once in `spec.json`; derive the data layer, the classifier's tool list, the planner, the vessels and the operator console from it. `docs/BLUEPRINT.md` is the design; `docs/DESIGN.md` records where the build deviated from it and why (measured, not asserted); `docs/NEXT.md` is the work list at the hand-off from the initial buildout.

## Commands

```bash
bun install
docker run -d --name fishtea-test-db -e POSTGRES_USER=fishtea -e POSTGRES_PASSWORD=fishtea -e POSTGRES_DB=fishtea -p 5434:5432 pgvector/pgvector:pg18
bun test packages scripts         # spec + core + http + templates + tui + release staging (needs the container above on :5434)
bun test packages/tui             # the console, driven through a pty
bun run e2e                       # the browser walkthrough, headless (skips cleanly with no browser/db)
bun run typecheck                 # both projects, including packages/ui
bun run validate --app templates/ecommerce
bun run headless --app templates/ecommerce --script templates/ecommerce/scripts/walkthrough.json   # DATABASE_URL, lexical classifier
bun run dev --app templates/ecommerce # core on :3000 (FISHTEA_INTENT=needle + CLASSIFIER_URL for the real classifier)
bun run tui --app templates/ecommerce # operator console
bun run up                        # docker compose: db + classifier + core + ui for FISHTEA_APP_DIR (default templates/ecommerce)
bun fishtea templates && bun fishtea new myapp --template ecommerce --answers a.json   # scaffold beside fishtea, never inside it
bun fishtea doctor --app templates/ecommerce            # spec, database, classifier, binding, framework pin
bun fishtea version | versions | use <v> | upgrade [--from <checkout>]
bun fishtea update [--dry-run|--adopt]                  # move an application to this framework
bun fishtea plugin list|info|add|remove|create|promote
bun run release <v> [--check]                           # the only writer of every version site
bun run build-release [--install] [--tarball]           # compile the binary + stage runtime files
bun run site [--serve]                                  # fishtea.io into site/dist
bun run deploy                                          # build + push to Firebase Hosting (docs/DEPLOY.md)
bun run bench -- --conventional   # against a running core
bunx tsc -p tsconfig.json --noEmit
```

## Layout

- `packages/spec` — type vocabulary, JSON Schema, loader (structural checks: plan cycles, unknown calls, SQL interpolation markers), derivations (DDL, tools, forms, vessels, zod, phrases), section hashes.
- `packages/core` — engine (`engine.ts`: utter/resume/persona/gate/write-confirm), trail service, planner, call executors, classifier clients (needle pool, lexical dev), Hono transport, headless runner.
- `packages/classifier` — Python needle3 pool (`needle_service.py`), `contract.md` with the Phase 0 findings.
- `packages/cli` — `fishtea` binary: new/validate/derive/migrate/seed/serve/headless/tui/up/bench/notify, plus version/versions/use/upgrade/update/plugin/ui-assets. `new.ts` scaffolds apps (and writes `.fishtea/manifest.json`); `serve.ts` hot-reloads; `update.ts` is the three-way reconcile; `plugin.ts` is the plugin lifecycle; `runtime.ts` is the installed-version layout.
- `packages/tui` — the operator console, built on Ink (React for terminals). Six screens on number keys: Dashboard, Spec (browse, scoped value edit, `$EDITOR`, add a shape), Conversations (visitors, trails, unmet channel, notify), Run (migrate, seed, reload, restart, compose, headless, bench), Onboard (the archetype interview), Versions (what is running, what else is installed, update this application). Driven in tests through a real pty: `packages/tui/test/pty-drive.py`. Never use `node:readline` here — Bun echoes it twice (docs/DESIGN.md).
- `packages/ui` — Vite + React + Tailwind v4; seven vessels; container with understood-line, verify strip, next chips, live region. `plugins.generated.css` is written by `fishtea ui-assets` and git-ignored.
- `packages/bench` — harness, `budgets.json`, conventional multi-page baseline.
- `plugins/` — builtin plugins (`boutique` design system, `anthropic` frontier model). A plugin is a directory with `fishtea.plugin.json`; resolution is local → node_modules → builtin.
- `scripts/` — `release.ts` (version sites) and `build-release.ts` (binary + staged runtime).
- `site/` — fishtea.io, generated from `docs/*.md`, the JSON Schema and the CLI's own help.
- `templates/` — the five archetypes.

## Rules of the house

- The spec is the only source. If something is entity-specific in code outside a template's or app's `calls/`, it is a bug.
- SQL files use `$1..$n` in declared input order; never string-build SQL. jsonb params are passed as JS values (postgres.js encodes them).
- Writes always pour `confirm-write` first; the model never evaluates a rule; rules live in `spec.rules` and compute modules.
- A `composite` pour is a flat `id → part` map (`root` + `parts`), and a part's `of` is an **ordinary
  pour** — no new component types, so every vessel keeps its contract and overrides compose for free.
  `shapes.<x>.compose` declares it; a part is always a `read` the asking persona is allowed, checked at
  load *and* per request, so composition can never smuggle past the gate or hide a write.
- **The classifier proposes, the gate disposes, the database has the last word.** Permission is checked
  *after* classification, where the classified path and the posted-chip path converge (`engine.ts`,
  `!allowed.includes(shapeName)`) — never by filtering needle's tools, which is for accuracy and
  latency. Row ownership is the call's own SQL (`AND visitor_id = $n`) and nothing else substitutes.
  A visitor id is a bearer credential: mint it with `newId`, which uses the CSPRNG, never `Math.random`.
- The lexical classifier is a dev harness and benchmark baseline only. Production is the needle pool.
- Nothing assumes localhost. Host and port come from `packages/cli/src/env.ts` (flag, then env, then default); the core binds `0.0.0.0`. A missing database is a `SetupError` with fixes, not a stack trace.
- A port nobody chose may move: `serve` and `up` probe first and step to the next free one, saying so. A
  port somebody named (`--port`, `PORT`, `FISHTEA_*_PORT`) never moves — it is a `SetupError`, because
  serving somewhere other than where you were told is worse than not serving.
- Generated applications live outside the framework checkout. `targetDir()` enforces it; `scaffold()` refuses otherwise.
- A release ships `templates/`, `plugins/`, all of `packages/` and the root manifests beside the binary.
  It is two things at once: data the framework reads, **and** the docker build context `fishtea up`
  uses, so anything a Dockerfile copies must be staged (`scripts/release.test.ts` enforces it).
  Code still never runs from there — never build an import or a subprocess from a path into
  `packages/cli/src`; pass the function in (the `Scaffolder` seam) or re-invoke `selfCommand()`.
  `packages/tui/test/seams.test.ts` enforces that half.
- Every classify call has a hard budget; past it the pour is `ask`, never a dumber brain.
- A plugin is merged at *load* time and never written into `spec.json`; the application always wins a name clash, and two plugins clashing is an error.
- A `classifier` or `channel` plugin *is* its `module` — the manifest must name one, it is imported when
  something wants the behaviour (never when a manifest is read), and every way of getting it wrong names
  the plugin and the file. A plugin classifier is wrapped in `withBudget`: the budget rule holds whether
  or not its author remembered it.
- `packages/ui/src/plugins.generated.{css,ts}` are derived and git-ignored.
  `packages/ui/scripts/ensure-generated.ts` writes the empty versions so a fresh clone builds; `fishtea
  ui-assets` writes the real ones. **A package's own scripts must not reach outside the package** — the
  container runs `bun run dev` inside `packages/ui` with only what a release ships, and `scripts/` is not
  shipped. `scripts/release.test.ts` fails on a `../..` in any packages/*/package.json script.
- Three versions, kept apart: the framework build (semver, pinned by an application), the spec *format* (`spec.fishtea`, what migrations key off), and the business revision. See `docs/VERSIONING.md`.
- `.fishtea/manifest.json` records two hashes per archetype file — the archetype's and the application's — because the scaffolder transforms files as it copies them. That is what makes `fishtea update` a three-way merge instead of a guess.
- Tests run against a real Postgres (pgvector). Keep them that way.
- **A test never points at a running stack.** Postgres is `FISHTEA_TEST_DATABASE_URL` on 5434, and the
  classifier is `FISHTEA_TEST_CLASSIFIER_URL` on 8082 — both deliberately not the real port, because the
  needle test calls `pool.reload()` and would otherwise swap a live application's tool set underneath it.
- **Prose is British English** — colour, behaviour, personalisation, catalogue, summarised. It suits a
  project named after a Jamaican broth, Jamaica being Commonwealth. This applies to prose only: code
  identifiers, CLI flags and component names keep whatever spelling they already have (`-colors` is an
  ImageMagick flag, `AlertDialog` is a component, `{"colors": […]}` is seed data). Do not "correct" those.
