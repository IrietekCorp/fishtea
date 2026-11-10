# Getting started

## What you need

[Bun](https://bun.sh) 1.4+, and Docker with Compose v2 for Postgres and the classifier pool. Python 3.9+
only if you want to run the classifier outside Docker.

Postgres and the classifier are **services**, not files, so they are never bundled into the binary.

## Install

FishTea is open source (Apache-2.0). Release binaries are not published at `fishtea.io` yet, so the
route in is a checkout, which also produces the standalone binary:

```bash
git clone https://github.com/IrietekCorp/fishtea
./fishtea/install.sh --from ./fishtea
```

You need [Bun](https://bun.sh) (the version in `.bun-version`) and Docker for Postgres and the classifier.

That puts `fishtea` in `~/.fishtea/bin`, keeping every version you install side by side so
`fishtea use <version>` can put any of them back. Builds exist for linux-x64, linux-arm64, darwin-x64,
darwin-arm64 and windows-x64.

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
vocabularies and seed rows, and sometimes more: telling the ecommerce archetype you are affiliate-only
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
fishtea doctor    # spec, database, classifier, binding, framework, labelled set, tuned model
```

```
✓ framework   1.8.12 satisfies ^1.8.12
✓ spec        My Shop v2026.11.01-1
✓ database    postgres://fishtea:***@localhost:5432/fishtea
✓ classifier  http://localhost:8081 · needle3 · 3/3 workers · 11 tools
✓ binding     0.0.0.0:3000 · other machines dial http://10.0.0.19:3000
✓ labels      56 labelled cases
```

A missing classifier is a **warning**: the core still runs and pours `ask` for text utterances. A missing
database stops start-up, with the command to fix it.

Two more rows appear once you have them. **labels** is `eval/classify.jsonl`, the labelled set your
archetype came with, the only measurement of the classifier a spec cannot derive. **model** appears when
`models/` holds a classifier tuned for this business, and it *fails* when the model is older than the
shapes and personas it was trained on, because a stale model is worse than the stock one in the way that
is hardest to notice. See [Tuning the classifier](tuning.html).

## Without Docker

With a Postgres that has pgvector on `DATABASE_URL`:

```bash
fishtea migrate && fishtea seed && fishtea dev
```

And with no classifier at all, for a scripted conversation with no UI:

```bash
fishtea headless
```

That uses the **lexical** classifier, which is a development harness and a benchmark baseline, never
production. If a step routes differently under lexical than under needle, adjust the script or the shape's
`triggers`, not the engine.

## What is in the directory

```
spec.json          the business: entities, calls, rules, shapes, personas, envelope
calls/             SQL with $1..$n parameters, and compute modules
seed/              rows per entity
rules/             tables the spec names (tax, pricing)
scripts/           headless walkthroughs
eval/              classify.jsonl, the labelled set — ground truth for the classifier
models/            a classifier tuned for this business, if you have trained one
plugins/           plugins local to this application
.fishtea/          provenance — commit manifest.json
docker-compose.yml its own stack
fishtea.ts         finds the framework: installed, vendored, or a checkout
```

`spec.json` is the only source. If something entity-specific lives in code outside `calls/`, that is a
bug.

## The operator console

There are two, and they are for different jobs. `/admin` is where an operator works; the TUI is where
you work on the application itself.

### In the browser: `/admin`

Served by the ui package, over the core's `/op`. Operators sign in: argon2id passwords, a hashed
session token, a first password that must be changed before anything else opens. Nothing about a running
application is public.

- **Reports**: the page it opens on. An application declares what its operators need to see in
  `spec.operator.reports`, and the console draws it: a page per report, a period above it, and panels
  that are query calls rendered as tiles, a line, a bar or a table. A panel may only read.
- **Jobs**: the application's operator shapes, each with its inputs and a Run button. A run starts at
  once and carries on in the core, so a catalogue sync is not bounded by what a proxy will wait for, and
  every run is kept so the last good answer survives a restart. A shape can also carry a `schedule` and
  run itself daily or once per release.
- **Conversations and the spec**, as the TUI has them.

[Running it](operating.html#admin) has the whole of it.

### In the terminal: `fishtea tui`

```bash
fishtea tui
```

Six screens on number keys:

1. **Dashboard**: service dots, spec version, what is running
2. **Spec**: browse, edit a value in place, open a section in `$EDITOR`, add a shape
3. **Conversations**: visitors, their trails, the unmet channel, notify
4. **Run**: migrate, seed, reload, restart, compose, headless, bench
5. **Onboard**: the archetype interview
6. **Versions**: what is running, what else is installed, update this application

## Next

- [Archetypes](archetypes.html): what each one is and what its interview asks
- [Running it](operating.html): the stack, the classifier pool, `/admin`, and visitor accounts
- [Echoes](echoes.html): recording what a visitor did with an answer that took them elsewhere
- [Tuning the classifier](tuning.html): the labelled set, and a model trained for one business
- [Plugins](plugins.html): integrations, design systems, auth
- [Versioning and updates](versioning.html): picking up framework changes without regenerating
- [Spec reference](spec-reference.html): every section, generated from the schema
