# Fishtea

*Solid ground, liquid UI.* Describe a business once — entities, calls, rules, shapes, personas — and derive the Postgres schema, the classifier's tool list, the planner, the UI vessels and the operator console from that one JSON file. Conversation replaces routing: a small on-device tool-calling model (needle3) turns what a visitor says into a **shape**, the planner composes typed **calls**, and the answer pours into one of seven **vessels**. The trail is rewindable, branchable, and never dies.

Applications start from an **archetype** in `templates/` and become a specific business through an **onboarding interview** (`onboard.json` in each template): the TUI asks the questions, or `fishtea new --answers file.json` answers them non-interactively. Every archetype is itself a complete, runnable example with seed data.

| archetype | what it is | the interview asks about |
|---|---|---|
| `ecommerce` | catalog (local rows or vendor feeds: mock, CSV, eBay, generic HTTP), cart, checkout, orders, reactions | categories, what people shop by, fulfilment (stock / affiliate-only / both), shipping, tax, returns, which vendor feeds |
| `portfolio` | a person you can interview: skills, projects, experience, an interview bank with follow-ups, honest fit assessment, contact | name, headline, summary, availability, skill areas, what visitors may ask for |
| `verification` | employee engagement verification: requester → consent → verifier attestation → minimal disclosure by purpose | purposes served, consent TTL, retention, engagement kinds |
| `program` | sessions-based program: find a session, register (multi-child, sibling discount, capacity, age rules), scholarships, device loans, schedule, FAQ | price, discount, ages, capacity, hours, location, tracks, equipment |
| `blank` | one entity, one read shape, one write shape | name, description, greeting |

## Setup

Prerequisites: [Bun](https://bun.sh) 1.4+, Docker with Compose v2, and Python 3.9+ only if you run the classifier pool outside Docker. The first classifier start downloads ~35 MB of needle3 weights from Hugging Face; Docker keeps them in the `models` volume.

```bash
git clone <this repo> ~/development/fishtea && cd ~/development/fishtea
bun install
bun fishtea templates        # the archetypes and their onboarding interviews
```

## Create an application

```bash
bun fishtea new my-shop --template ecommerce --interactive     # answer the interview in the terminal
# or non-interactive:  --answers answers.json  (keys are the question ids in templates/ecommerce/onboard.json)
# or from the console: bun run tui → Onboard
cd my-shop
cp .env.example .env         # vendor credentials (EBAY_APP_ID, …) go here, never in spec.json
```

The generated directory holds `spec.json`, `calls/`, `seed/`, `rules/`, `scripts/`, its own `docker-compose.yml`, and a `fishtea.ts` shim that runs the framework CLI from this checkout. Nothing to install inside it.

## Build and run (Docker, the whole stack)

```bash
bun run up                   # builds the images; db (:5432) + classifier pool (:8081) + core (:3000) + ui (:5173)
bun run tui                  # the operator console (see below)
bun run logs core            # or: classifier, ui, db
bun run down                 # add -v to drop the data volume
```

Open http://localhost:5173. `curl http://localhost:3000/` returns the resumed conversation as JSON; `curl http://localhost:3000/healthz` shows db + classifier status. `bun run restart` restarts core; entity edits made in the TUI prompt for a migration.

### The operator console

`bun run tui` opens a persistent console for the application in the current directory. Five screens, on the number keys:

| key | screen | what it is for |
|---|---|---|
| `1` | Dashboard | core, classifier and database status, refreshed every few seconds; what to do next |
| `2` | Spec | browse every section, edit one value at a time, open a section in `$EDITOR`, add a shape. Edits validate, bump that section's version and hot-reload the core |
| `3` | Conversations | visitors and their trails, and the unmet channel: what people asked that the spec could not answer. `n` sends a notification |
| `4` | Run | migrate, seed, reload, restart, Compose up/down/logs, the headless walkthrough, the bench |
| `5` | Onboard | create another application from an archetype, answering its interview |

`r` refreshes, `q` quits, `/` filters a list, `esc` steps back. Typing in a field never triggers a shortcut.

## Run without Docker (core only)

You need a PostgreSQL 18 with pgvector. The quickest is the image the stack uses:

```bash
docker run -d --name fishtea-db -e POSTGRES_USER=fishtea -e POSTGRES_PASSWORD=fishtea \
  -e POSTGRES_DB=fishtea -p 5432:5432 pgvector/pgvector:pg18
export DATABASE_URL=postgres://fishtea:fishtea@localhost:5432/fishtea

# inside a generated app:
bun run migrate && bun run seed
bun run headless             # scripted conversation from scripts/walkthrough.json, no UI, dev lexical classifier
bun run dev                  # core on :3000

# or an archetype straight from the framework checkout:
bun run migrate --app templates/portfolio && bun run seed --app templates/portfolio
bun run dev --app templates/portfolio
```

The real classifier is the needle3 pool. Start it and point the core at it:

```bash
cd packages/classifier
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
NEEDLE_WORKERS=3 .venv/bin/python needle_service.py                # :8081; pre-warms one worker per persona
CLASSIFIER_URL=http://localhost:8081 FISHTEA_INTENT=needle bun run dev
```

`NEEDLE_WORKERS` must be at least the number of distinct persona tool subsets (3 for the shipped archetypes); a worker switching subsets pays a ~1 s re-initialisation. If `~/.cache/huggingface` is not writable, set `HOME` to a writable directory for the pool. Without `CLASSIFIER_URL` the core falls back to the lexical classifier, which is a development harness only (blueprint D5).

The UI dev server:

```bash
cd packages/ui && bun install && bun run dev      # :5173, VITE_CORE_URL defaults to http://localhost:3000
bun run build                                     # static build in packages/ui/dist
```

`--app <dir>` names an application directory (`spec.json` + `calls/` + `seed/`); it defaults to `FISHTEA_APP` or the current directory, so inside a generated app you never pass it.

## Test

```bash
# a throwaway pgvector Postgres for the suite (port 5434, so it never collides with a running stack)
docker run -d --name fishtea-test-db -e POSTGRES_USER=fishtea -e POSTGRES_PASSWORD=fishtea \
  -e POSTGRES_DB=fishtea -p 5434:5432 pgvector/pgvector:pg18

bun test packages/spec packages/core/test/core.test.ts packages/core/test/http.test.ts \
  packages/core/test/camp.test.ts packages/core/test/templates.test.ts     # 50 tests; every archetype runs its walkthrough
bunx tsc -p tsconfig.json --noEmit

# against the real classifier (start the pool first; runs alone because it resets the database)
CLASSIFIER_URL=http://localhost:8081 bun test packages/core/test/needle.test.ts
```

Set `FISHTEA_TEST_DATABASE_URL` to use another database. The tests drop and recreate the `business`, `conversation` and `fishtea` schemas, so never point them at a stack you care about.

## Bench

```bash
FISHTEA_OPERATOR_TOKEN=x PORT=3010 bun run dev --app templates/ecommerce &
bun run bench -- --core http://localhost:3010 --iterations 20 --conventional
```

Budgets are in `packages/bench/budgets.json`; the run fails if a budget is exceeded or fewer than 90 % of text utterances produce an answer. Results land in `packages/bench/results/`; `--baseline` writes `baseline.json` for later diffs.

## Everyday commands

| command | what it does |
|---|---|
| `bun fishtea validate` | validate `spec.json`, print section hashes |
| `bun fishtea derive --ddl` / `--tools` / `--forms` | show what the spec derives |
| `bun fishtea migrate [--allow-destructive]` | additive migration; destructive changes are refused unless allowed |
| `bun fishtea seed` | upsert `seed/*.json` |
| `bun fishtea headless [--script f.json] [--json]` | run a scripted conversation, print each pour |
| `bun fishtea notify <visitorId> "text"` | queue an operator notification (needs `FISHTEA_OPERATOR_TOKEN`) |
| `bun fishtea new <id> --template <t>` | scaffold; `--interactive`, `--answers f.json`, `--dir`, `--name`, `--force` |

Inside a generated app the same commands are `bun run <name>`; in this checkout add `--app <dir>`.

## How it fits together

```
spec.json ──derive──▶ DDL · tool list · forms · vessels · zod
   │
   ▼
visitor utterance ─▶ persona (from the trail) ─▶ tool list filtered by allow[] ─▶ needle3 pool ─▶ shape + args
                                                                                        │
                            pour: ask | form | confirm-write | answer ◀── planner (calls in topological waves)
                                                                                        │
                            trail (append-only tree, JSONB) ◀── provenance, embedding ──┘
```

- `packages/spec` — the format and every derivation.
- `packages/core` — trail, persona, planner, pour, notifications (SSE), Hono transport, headless runner.
- `packages/classifier` — the needle3 worker pool (Python). `contract.md` has the measured findings.
- `packages/cli` — `fishtea` (templates · new · validate · derive · migrate · seed · serve · headless · tui · up · bench). `new.ts` applies an archetype's interview answers to its spec.
- `packages/tui` — the operator console (Ink): live service status, spec browsing and editing, the trail and the unmet channel, migrations and Compose, and the archetype interview.
- `packages/ui` — React + Tailwind; seven vessels; understood line; verify strip; next chips; live region.
- `packages/bench` — budgets enforced, conventional multi-page baseline measured alongside.

See `docs/BLUEPRINT.md` for the design and `docs/DESIGN.md` for what the build measured and changed.
