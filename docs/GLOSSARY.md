# Glossary

FishTea uses a small vocabulary precisely. These words mean one thing each, in the documentation, in the
code and in the spec, and where two words look interchangeable, they are not.

## The description

**Spec**. The versioned JSON document describing a business: entities, calls, rules, shapes, personas,
envelope, notifications, operator shapes and plugins. The single source everything else is derived from.
One file, `spec.json`, plus the `calls/` it names.

**Section**. A top-level part of the spec (`entities`, `shapes`, …). Each carries its own `version` and
is content-hashed independently, so the engine and the console can tell exactly what changed.

> One word, two places, and worth keeping straight: a **spec section** is a part of the *document*; a
> **site section** (`rules.site.sections`) is a place in the *site* a shell navigates to. They are named
> the same because both are "a top-level part of the thing", and they are never the same thing.

**Entity**. A typed record kind: product, order, customer. Becomes a Postgres table.

**Call**. A named, typed data operation declared in the spec: a query, a mutation, a compute module or an
external fetch. Calls are the only way data moves. SQL calls take `$1..$n` parameters in declared order
and are never string-built.

**Shape**. A *question the business can answer*. It has an input schema, an answer schema, a plan over
calls, an effect, a list of personas allowed to use it, and the chips that follow it. One shape becomes
three things: a tool in the classifier's list, a plan for the planner, and a vessel in the UI.

**Rule**. A business constraint that lives in `spec.rules` or a compute module: pricing, tax, capacity,
who may attest. **The model never evaluates a rule.** This is the line between ground and water.

**Persona**. A named engagement state derived from what the trail knows: `stranger`, `known`, `customer`,
`mid-purchase`, `operator`. A persona gates which shapes are even visible, so a visitor cannot be
classified into something they are not allowed to do.

**Envelope**. The metadata a visit arrives with: referrer, campaign, coupon, identity or its absence. It
seeds the trail and shapes the greeting.

**Archetype**. A complete, runnable application under `templates/` (spec, calls, seed, scripts) plus an
`onboard.json` interview that turns the generic thing into *your* business. A starting point, not a cage.

## The conversation

**Utterance**. Anything a visitor does: typed text, a chip click, a form submit, or simply arriving. All
of them become turns.

**Turn**. One appended node in a trail: the utterance in, the pour out, and the provenance between them.

**Trail**. The conversation itself: an append-only *tree* of turns per visitor. It is rewindable and
branchable, and it never dies.

**Rewind**. Pointing at an earlier turn. Nothing is deleted.

**Echo**. What a visitor did with an answer that took them out of the conversation, such as following
an outbound link. It is recorded beside the turn that offered it (`conversation.echo`), never as a turn,
and served at `/echo`. A destination is followed only if that conversation published it. [Echoes](echoes.html).

**Branch**. A new utterance made from a rewound turn, creating a sibling path. The original survives.

**Pour**. The system's response to an utterance. Exactly one of four kinds:

| pour | means |
|---|---|
| `ask` | I need you to say more (also what a greeting is, and what a blown budget falls back to) |
| `form` | I know the shape; I need its arguments |
| `answer` | here is the result, in a vessel |
| `confirm-write` | this will change data; confirm it first |

**Vessel**. One of seven fixed UI containers an answer is rendered into, chosen deterministically from
the *shape of the answer*, never from the shape's name: `list`, `card`, `detail`, `compare`, `timeline`,
`confirm`, `notice`. Plus `ask` and `form` for the other pour kinds.

**Present**. The layout language (`rules.present`): how an answer is arranged once a vessel has it.
**Molecules** say which field of an entity is the title, the eyebrow, the body, the link; **organisms**
are the ordered blocks a shape's answer is laid out as. Anything undeclared is derived from the spec, so
a business that says nothing still gets a layout. Resolved into `pour.present` before it reaches the
browser; the UI is handed a layout, never asked to infer one.

**Shell**. What a visitor sees around the conversation: header, menu, footer, the page they landed on.
A `ui` plugin provides one (`sections` is the shipped one, a site navigated by `rules.site`). A shell
never shows operator data; that lives behind `/admin`.

**Site section**. A place a shell navigates to, listed in order in `rules.site.sections`. Distinct from
a *spec* section above.

**Chip**. A suggested next question, derived from the shape's `next`. Chips are how a conversation offers
direction without becoming a menu.

**Gate**. What happens when a stranger asks for something their persona cannot reach. The shape is not in
their toolset, so the classifier cannot return it; the engine instead pours a form for the first write
shape the greeting offers, with a hint. Only greeting offers can be gates.

**Unmet channel**. Where questions the business could not answer are collected for the operator. A failed
classification is demand signal, not an error.

**Familiarity**. The resonance between the current utterance and turns from earlier trails, used to recall
relevant context. Threshold lives in `rules.familiarity`.

## The machinery

**Classifier**. The component that turns an utterance into a shape and its arguments. Production is the
**needle pool**; the **lexical classifier** is a development harness and benchmark baseline, never
production.

**needle3**. The small on-device tool-calling model FishTea classifies with. It runs on ordinary CPU,
costs nothing per request, and is what makes putting classification in front of every request affordable.

**Pool**. The process holding several needle workers. Each worker holds **one persona tool subset**,
because switching a worker between subsets costs far more than a classification does.

**Budget**. The hard millisecond ceiling on a classify call (`rules.classify.budgetMs`). Past it the pour
is `ask`. Never a slower model, never a worse one: the deadline is the contract.

**Planner**. The component that runs a shape's plan: typed calls, in dependency order, with the shape's
`assemble` step producing the answer.

**Provenance**. What every answer carries and the UI shows: which shape answered, which calls ran, what
was read, what was written, and how long each part took.

**Engine**. The core: utter, resume, persona, gate, confirm-write, trails, planner, call execution.

## Versions and updates

Three versions, deliberately kept apart because they fail apart. See
[Versioning and updates](versioning.html).

**Framework version**. The semver of the FishTea build itself (`fishtea --version`). An application pins
a range against it.

**Spec format**. The version of the spec *document*'s shape (`spec.json` → `fishtea`, e.g. `1.1`).
Migrations key off this and nothing else, so one migration can serve many framework releases.

**Business revision**. Your business's own revision (`business.version`, e.g. `2026.09.22-3`). Moves when
you change the description.

**Manifest**. `.fishtea/manifest.json`, the record of where every file in an application came from. It
holds **two** hashes per file: what the archetype said, and what was actually left in your directory,
because the scaffolder transforms files as it copies them. Commit it.

**Three-way reconcile**. How `fishtea update` decides each file: the archetype moved and you did not
(update it), you moved it and the archetype did not (it is yours forever), both moved (a conflict, with
the new version left beside yours as `.new`).

**Adopt**. Taking on an application created before the manifest existed. Only files that still match the
archetype exactly are claimed; everything else is treated as yours, so adoption can never overwrite an
older edit.

## Plugins

**Plugin**. A directory with a `fishtea.plugin.json` manifest that contributes to a spec. What it brings
is merged when the spec *loads* and is never written into your `spec.json`.

**Kind**. Which seam a plugin fills: `integration`, `ui`, `auth`, `classifier`, `channel`, `archetype`.

**Provenance (plugin)**. The record of which plugin contributed which spec entry, so it is always visible
where something came from.

**Promote**. Moving a plugin from an application's own `plugins/` into the framework's, where every
application can resolve it by name. A plugin is "local" or "core" only by *where it sits*, so promoting is
a move rather than a rewrite.

**Design system**. A `ui` plugin. It supplies design tokens the base UI already defines, which is why it
replaces no component and inherits the accessibility and focus behaviour rather than re-earning it.

## Two phrases worth knowing

**"Solid ground, liquid UI."** The ground is what stays fixed: the spec, the data, the rules, who may do
what. The water is everything a human sees, and it takes its shape from the ground.

**"Describe once, derive everything."** If something entity-specific exists in code outside a template's
or an application's `calls/`, that is a bug, not a shortcut.
