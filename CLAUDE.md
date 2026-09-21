# Fishtea — build brief

Describe a business once in `spec.json`; derive the data layer, the classifier's tool list, the planner, the vessels and the operator console from it. `docs/BLUEPRINT.md` is the design; `docs/DESIGN.md` records where the build deviated from it and why (measured, not asserted).

## Commands

```bash
bun install
docker run -d --name fishtea-test-db -e POSTGRES_USER=fishtea -e POSTGRES_PASSWORD=fishtea -e POSTGRES_DB=fishtea -p 5434:5432 pgvector/pgvector:pg16
bun test packages                 # spec + core + http + camp (needs the container above on :5434)
bun run validate --app templates/ecommerce
bun run headless --app templates/ecommerce --script templates/ecommerce/scripts/walkthrough.json   # DATABASE_URL, lexical classifier
bun run dev --app templates/ecommerce # core on :3000 (FISHTEA_INTENT=needle + CLASSIFIER_URL for the real classifier)
bun run tui --app templates/ecommerce # operator console
bun run up                        # docker compose: db + classifier + core + ui for FISHTEA_APP_DIR (default templates/ecommerce)
bun fishtea templates && bun fishtea new my-shop --template ecommerce --answers a.json   # scaffold (its own compose + TUI)
bun run bench -- --conventional   # against a running core
bunx tsc -p tsconfig.json --noEmit
```

## Layout

- `packages/spec` — type vocabulary, JSON Schema, loader (structural checks: plan cycles, unknown calls, SQL interpolation markers), derivations (DDL, tools, forms, vessels, zod, phrases), section hashes.
- `packages/core` — engine (`engine.ts`: utter/resume/persona/gate/write-confirm), trail service, planner, call executors, classifier clients (needle pool, lexical dev), Hono transport, headless runner.
- `packages/classifier` — Python needle3 pool (`needle_service.py`), `contract.md` with the Phase 0 findings.
- `packages/cli` — `fishtea` binary: new/validate/derive/migrate/seed/serve/headless/tui/up/bench/notify. `new.ts` scaffolds apps; `serve.ts` hot-reloads; `edit.ts` patches sections.
- `packages/tui` — @clack/prompts console: onboard, edit (scoped / $EDITOR / add shape / regenerate), run (status, restart, migrate, unmet, notify, compose).
- `packages/ui` — Vite + React + Tailwind v4; seven vessels; container with understood-line, verify strip, next chips, live region.
- `packages/bench` — harness, `budgets.json`, conventional multi-page baseline.
- `templates/ecommerce`, `templates/program` — the two samples; also the `commerce` and `program` templates.

## Rules of the house

- The spec is the only source. If something is entity-specific in code outside a template's or app's `calls/`, it is a bug.
- SQL files use `$1..$n` in declared input order; never string-build SQL. jsonb params are passed as JS values (postgres.js encodes them).
- Writes always pour `confirm-write` first; the model never evaluates a rule; rules live in `spec.rules` and compute modules.
- The lexical classifier is a dev harness and benchmark baseline only. Production is the needle pool.
- Every classify call has a hard budget; past it the pour is `ask`, never a dumber brain.
- Tests run against a real Postgres (pgvector). Keep them that way.
