# Getting started

## What you need

[Bun](https://bun.sh) 1.4+, and Docker with Compose v2 for Postgres and the classifier pool. Python 3.9+
only if you want to run the classifier outside Docker.

Postgres and the classifier are **services**, not files, so they are never bundled into the binary.

## Install

```bash
curl -fsSL https://fishtea.io/install | bash
```

That fetches a binary for your platform, checks it against the published `SHA256SUMS`, and puts a
standalone `fishtea` in `~/.fishtea/bin` — with every version you install kept side by side, so
`fishtea use <version>` can put any of them back. The script is plain text in a browser if you would
rather read it before running it.

Builds are published for linux-x64, linux-arm64, darwin-x64, darwin-arm64 and windows-x64. From a
checkout instead, which produces exactly the same thing:

```bash
git clone <the repo> fishtea
./fishtea/install.sh --from ./fishtea
```

Or work from the checkout directly, with no install at all:

```bash
cd fishtea && bun install && bun fishtea templates
```

## Make an application

```bash
fishtea templates                                        # the five archetypes
fishtea new myshop --template ecommerce --interactive     # answer the interview
cd myshop
```

The interview turns a generic archetype into *your* business: what you sell, how people shop for it,
whether stock is yours or a vendor's, what shipping and returns look like. Answers patch spec paths, enum
vocabularies and seed rows — and sometimes more: telling the ecommerce archetype you are affiliate-only
removes the cart shapes and the mid-purchase persona entirely.

Non-interactively, `--answers answers.json`, where the keys are the question ids in the template's
`onboard.json`.

**Where it goes.** An application is its own project, so it is never created inside the framework
checkout. It lands in the current directory, or wherever `--dir` says; `--workspace` (or
`FISHTEA_WORKSPACE`) sets the parent.

## Run it

```bash
fishtea up
```

Postgres with pgvector, the needle3 classifier pool, the core and the browser UI. The first classifier
start downloads ~35 MB of weights; Docker keeps them in a volume.

```bash
fishtea doctor    # spec, database, classifier, binding, framework compatibility
```

```
✓ framework   1.2.0 satisfies ^1.1.0
✓ spec        My Shop v2026.09.22-1
✓ database    postgres://fishtea:***@localhost:5432/fishtea
✓ classifier  http://localhost:8081 · needle3 · 3/3 workers · 11 tools
✓ binding     0.0.0.0:3000 · other machines dial http://10.0.0.19:3000
```

A missing classifier is a **warning**: the core still runs and pours `ask` for text utterances. A missing
database stops start-up, with the command to fix it.

## Without Docker

With a Postgres that has pgvector on `DATABASE_URL`:

```bash
fishtea migrate && fishtea seed && fishtea dev
```

And with no classifier at all, for a scripted conversation with no UI:

```bash
fishtea headless
```

That uses the **lexical** classifier, which is a development harness and a benchmark baseline — never
production. If a step routes differently under lexical than under needle, adjust the script or the shape's
`triggers`, not the engine.

## What is in the directory

```
spec.json          the business: entities, calls, rules, shapes, personas, envelope
calls/             SQL with $1..$n parameters, and compute modules
seed/              rows per entity
rules/             tables the spec names (tax, pricing)
scripts/           headless walkthroughs
plugins/           plugins local to this application
.fishtea/          provenance — commit manifest.json
docker-compose.yml its own stack
fishtea.ts         finds the framework: installed, vendored, or a checkout
```

`spec.json` is the only source. If something entity-specific lives in code outside `calls/`, that is a
bug.

## The operator console

```bash
fishtea tui
```

Six screens on number keys:

1. **Dashboard** — service dots, spec version, what is running
2. **Spec** — browse, edit a value in place, open a section in `$EDITOR`, add a shape
3. **Conversations** — visitors, their trails, the unmet channel, notify
4. **Run** — migrate, seed, reload, restart, compose, headless, bench
5. **Onboard** — the archetype interview
6. **Versions** — what is running, what else is installed, update this application

## Next

- [Archetypes](archetypes.html) — what each one is and what its interview asks
- [Plugins](plugins.html) — integrations, design systems, auth
- [Versioning and updates](versioning.html) — picking up framework changes without regenerating
- [Spec reference](spec-reference.html) — every section, generated from the schema
