<div align="center">

# 🍵 FishTea

**Describe a business once. Derive everything else.**

*Solid ground, liquid UI.*

</div>

One `spec.json` — entities, calls, rules, shapes, personas — gives you the Postgres schema, the
classifier's tool list, the planner, the UI vessels and an operator console. Conversation replaces
routing: a small **on-device** tool-calling model turns what a visitor says into a **shape**, the planner
composes typed **calls**, and the answer pours into one of seven **vessels**. The trail is rewindable,
branchable, and never dies.

```bash
curl -fsSL https://fishtea.io/install | bash

fishtea new myshop --template ecommerce --interactive
cd myshop && fishtea up
```

That is a running application: Postgres with pgvector, a needle3 classifier pool, the core, and a browser
UI — none of it hand-written.

---

## What it looks like

A visitor types *"something linen for a summer wedding, under £80"*. The classifier picks the
`findProducts` shape and fills its arguments. The planner runs the typed calls that shape names. The
answer pours into a list vessel, with a provenance strip underneath: which shape answered, what it read,
what it wrote, how long it took.

```
POST /utter  "something linen for a summer wedding under £80"
  → findProducts@0.94 · list · 6 records
    calls products.search · 157ms (classify 149, plan 3)
```

All of it derived from the spec. If something entity-specific lives in code outside a template's or
application's `calls/`, that is a bug.

## Five archetypes

Each is a complete, runnable application with seed data, plus an interview that turns it into *your*
business.

| archetype | what it is |
|---|---|
| `ecommerce` | Catalogue, cart, checkout, orders. Stock from local rows or vendor feeds (mock, CSV, eBay, HTTP) |
| `portfolio` | A person you can interview: skills, projects, experience, an honest assessment of fit |
| `verification` | Employment verification: consent → attestation → disclosure limited to the purpose |
| `program` | Sessions and registration: capacity, ages, sibling discounts, scholarships, device loans |
| `blank` | One entity, one read shape, one write shape |

```bash
fishtea templates
```

Answers do more than fill in blanks. Tell the ecommerce archetype you are affiliate-only and it removes
the cart shapes, drops the mid-purchase persona, and prunes every chip that pointed at them — a coherent
smaller application, not one with dead ends.

## Plugins

Everything outside the conversation is a plugin: `integration`, `ui`, `auth`, `classifier`, `channel`,
`archetype`.

```bash
fishtea plugin add boutique --set accentHue=340     # a design system for shops
fishtea plugin add anthropic --as ai                # a frontier model, for answers a 3B model can't compose
fishtea plugin create loyalty --kind integration    # start your own, locally
fishtea plugin promote loyalty                      # move it into the framework for every application
```

Two rules make it safe. **The spec stays yours** — adding a plugin writes one line naming it; what it
contributes is merged when the spec loads and never written into your `spec.json`, so removing the line
removes everything it brought. **The application always wins** — name something a plugin also defines and
yours stands.

Resolution is local → `node_modules` → builtin, which is also the social model: what you are working on
beats what you installed, which beats what shipped. Promoting a plugin to core is a *move*, so the
application that had it keeps working untouched.

→ [Plugins](docs/PLUGINS.md)

## Upgrading without regenerating

An application pins a framework range and records where every file came from, so an upstream fix reaches
it without touching a line you wrote.

```bash
fishtea update --dry-run
```

```
framework  1.1.0 → 1.2.0  (pinned ^1.1.0)
spec       format 1.1 → 1.2
             additive: the marker moves, nothing in your spec is rewritten
files      2 to update, 1 new, 1 conflicting, 3 yours, 21 unchanged

   ↑ calls/cart_add.sql
   + calls/products_newest.sql
   ! calls/products_related.sql — you changed it and so did the archetype; the new one lands as .new
```

`.fishtea/manifest.json` records **two** hashes per file — what the archetype said, and what was left in
your directory — because the scaffolder transforms files as it copies them. With both, an update is a
three-way merge: a file you changed is yours forever, a file you did not takes the fix, and a file you
both changed is reported rather than resolved behind your back.

Every version you install stays on disk:

```bash
fishtea versions          # * marks the one running
fishtea use 1.1.0         # one symlink, instantly
fishtea upgrade
```

Going back is as cheap as going forward, which is the only reason going forward is comfortable.
Upgrading the framework never touches an application — an application moves when *it* runs `update`.

→ [Versioning and updates](docs/VERSIONING.md)

## The operator console

```bash
fishtea tui
```

Six screens on number keys: **Dashboard** (service dots, spec version), **Spec** (browse, edit in place,
`$EDITOR` a section, add a shape), **Conversations** (visitors, trails, the unmet channel), **Run**
(migrate, seed, reload, restart, compose, headless, bench), **Onboard** (the interview), **Versions**
(what is running, what else is installed, update this application).

Built on [Ink](https://github.com/vadimdemedes/ink), because under Bun `node:readline` echoes every
keystroke — a prompt library rendered `hheelllloo`. That and every other measured deviation from the
design is recorded in [docs/DESIGN.md](docs/DESIGN.md).

## Setup for development

```bash
git clone <this repo> fishtea && cd fishtea && bun install

docker run -d --name fishtea-test-db \
  -e POSTGRES_USER=fishtea -e POSTGRES_PASSWORD=fishtea -e POSTGRES_DB=fishtea \
  -p 5434:5432 pgvector/pgvector:pg18

bun test packages                  # needs the container above
bunx tsc -p tsconfig.json --noEmit
bun run site --serve               # the documentation site on :4000
bun run build-release --install    # compile the binary and install it
```

Tests run against a real Postgres. Keep them that way.

## Layout

| package | what it is |
|---|---|
| `packages/spec` | The vocabulary: types, JSON Schema, loader, derivations (DDL, tools, forms, vessels, zod), section hashes, plugins, migrations |
| `packages/core` | The engine: utter/resume/persona/gate/confirm-write, trails, planner, call executors, classifier clients, Hono transport |
| `packages/classifier` | The Python needle3 pool, and `contract.md` with the Phase 0 findings |
| `packages/cli` | The `fishtea` binary: new, validate, migrate, serve, headless, tui, up, bench, plugin, update, upgrade |
| `packages/tui` | The operator console, on Ink |
| `packages/ui` | Vite + React + Tailwind v4; seven vessels |
| `packages/bench` | Harness, budgets, and a conventional multi-page baseline |
| `plugins/` | Builtin plugins |
| `templates/` | The five archetypes |
| `site/` | fishtea.io, generated from these docs and the schema |

## Documentation

- [Getting started](docs/GETTING-STARTED.md)
- [Archetypes](docs/ARCHETYPES.md)
- [Plugins](docs/PLUGINS.md)
- [Versioning and updates](docs/VERSIONING.md)
- [Running it](docs/OPERATING.md)
- [The blueprint](docs/BLUEPRINT.md) — the design
- [What the build measured](docs/DESIGN.md) — where the implementation deviated, and the measurement why
- [Deploying](docs/DEPLOY.md) — how fishtea.io is hosted, and the nameserver trap that bit us
- [What is next](docs/NEXT.md) — the work list

## Rules of the house

- The spec is the only source.
- SQL files use `$1..$n` in declared input order. Never string-build SQL.
- Writes always pour `confirm-write` first. The model never evaluates a rule; rules live in `spec.rules`.
- The lexical classifier is a development harness and a benchmark baseline. Production is the needle pool.
- Nothing assumes localhost. A missing database is a `SetupError` with fixes, not a stack trace.
- Generated applications live outside the framework checkout.
- Every classify call has a hard budget. Past it the pour is `ask`, never a dumber brain.
- Tests run against a real Postgres.
