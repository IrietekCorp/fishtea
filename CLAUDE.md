# Fishtea — build brief

Describe a business once in `spec.json`; derive the data layer, the classifier's tool list, the planner, the vessels and the operator console from it. `docs/BLUEPRINT.md` is the design; `docs/DESIGN.md` records where the build deviated from it and why (measured, not asserted); `docs/NEXT.md` is the work list at the hand-off from the initial buildout.

## Commands

```bash
bun install
docker run -d --name fishtea-test-db -e POSTGRES_USER=fishtea -e POSTGRES_PASSWORD=fishtea -e POSTGRES_DB=fishtea -p 5434:5432 pgvector/pgvector:pg18
bun test packages                 # spec + core + http + templates + tui (needs the container above on :5434)
bun test packages/tui             # the console, driven through a pty
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
bun run site [--serve]                                  # fishtea.dev into site/dist
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
- `site/` — fishtea.dev, generated from `docs/*.md`, the JSON Schema and the CLI's own help.
- `templates/` — the five archetypes.

## Rules of the house

- The spec is the only source. If something is entity-specific in code outside a template's or app's `calls/`, it is a bug.
- SQL files use `$1..$n` in declared input order; never string-build SQL. jsonb params are passed as JS values (postgres.js encodes them).
- Writes always pour `confirm-write` first; the model never evaluates a rule; rules live in `spec.rules` and compute modules.
- The lexical classifier is a dev harness and benchmark baseline only. Production is the needle pool.
- Nothing assumes localhost. Host and port come from `packages/cli/src/env.ts` (flag, then env, then default); the core binds `0.0.0.0`. A missing database is a `SetupError` with fixes, not a stack trace.
- Generated applications live outside the framework checkout. `targetDir()` enforces it; `scaffold()` refuses otherwise.
- Every classify call has a hard budget; past it the pour is `ask`, never a dumber brain.
- A plugin is merged at *load* time and never written into `spec.json`; the application always wins a name clash, and two plugins clashing is an error.
- Three versions, kept apart: the framework build (semver, pinned by an application), the spec *format* (`spec.fishtea`, what migrations key off), and the business revision. See `docs/VERSIONING.md`.
- `.fishtea/manifest.json` records two hashes per archetype file — the archetype's and the application's — because the scaffolder transforms files as it copies them. That is what makes `fishtea update` a three-way merge instead of a guess.
- Tests run against a real Postgres (pgvector). Keep them that way.
