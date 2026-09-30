# Generative UI: what to take from json-render

[json-render](https://json-render.dev/) is Vercel's generative-UI framework. A model emits a JSON tree,
a catalogue constrains what it may emit, and renderers for React, Vue, Svelte and Solid paint it as it
streams. It is the closest public thing to the part of FishTea that turns an answer into an interface,
so it is worth being precise about where it agrees with us, where it is ahead, and where it goes
somewhere we should not follow.

*Read from the site, the `vercel-labs/json-render` README and its actions documentation. Where a claim
below rests on what the documentation does not say, it says so.*

## What it is

```json
{
  "root": "card-1",
  "elements": {
    "card-1": { "type": "Card", "props": { "title": "Hello" }, "children": ["button-1"] },
    "button-1": { "type": "Button", "props": { "label": "Click me" }, "children": [] }
  }
}
```

A **catalogue** declares which components and actions exist and types their props with Zod, so the model
can only name things you have already built. Props can be expressions — `{"$state": "/form/country"}`,
`{"$cond": …, "$then": …, "$else": …}`, `{"$template": "Hello, ${/user/name}!"}`. Elements can carry
`visible` conditions and `watch` blocks that fire an action when a watched value changes. A built-in
`setState` action writes to a state tree; custom actions are functions you register, receiving
`(params, setState, state)`.

## The thing you noticed

Your read was that it might be a superficial paint. Half right, and the half that is wrong is worth
separating out.

**The rendering is genuinely runtime.** It streams and paints progressively as the model emits. That
part is real and is better than what we do.

**The spec is what is frozen.** As documented, an action's only outward effect is `setState`; there is
no mechanism for an interaction to produce a *new* spec. So after generation the interface is a fixed
tree with a local state machine attached. A toggle can recolour a tab and a `visible` condition can hide
an alert, because those are bindings re-evaluating — but nothing can change *what the interface is*. If
a demo component did nothing when you pressed it, the likely reason is simply that its `emit("press")`
had no action wired behind it in that catalogue, and there is nothing in the architecture that would
have noticed.

That is the whole divergence, and it is not a detail. **json-render generates an interface once.
FishTea answers a turn, every turn.**

## Where it is ahead of us

Three things, and I would take all three.

**The flat element map is a better encoding than a nested tree.** `{root, elements}` with ids and
`children: ["id"]` means an element can be sent, replaced or patched without resending its ancestors.
That is why they can stream progressively, and it is exactly the encoding the [composite
pour](nested-shapes.html) needs — a pour made of several vessels wants to be an addressable map, not a
nested blob, or every update is a full repaint and no part of it can be referred to later.

**Progressive rendering.** We pour whole: the planner finishes, then the vessel appears. A list whose
rows arrive as the query streams is a real improvement and the encoding above is what makes it possible.

**`watch` as element-level reactivity.** An element that reacts to a value *changing* rather than to a
render is a primitive we do not have. Our nearest thing is a notification, which is server-pushed and
much heavier. Worth stealing carefully — see the caution below.

Their devtools are also good and we should note the shape: spec tree, state editor, action log, stream
log, catalogue browser, DOM picker. We have the verify strip, which is aimed at the *visitor* rather
than the developer and is the better instinct, and the operator console. An **action log** is the piece
we are missing.

## Where we should not follow

**The model composes the layout.** This is the deepest difference. In json-render the model decides
which components appear and how they nest; the catalogue exists to stop that going wrong. In FishTea the
model never chooses a vessel at all — it classifies intent into a shape, and the *answer's shape* picks
the vessel. Our guardrail is not a constraint on generation, it is the absence of generation.

That is the stronger position and we should hold it. A model that lays out an interface will lay it out
differently for the same question tomorrow, and a catalogue narrows that without removing it. "Seven
vessels, never a page" is the same guardrail taken to its conclusion.

**A frozen spec plus accumulating client state.** This is a cousin of the URL-as-memory problem in
[Addresses](addresses.html): state piles up in a tree nobody declared, in the client, where it cannot be
inspected, resumed, rewound or reasoned about after the fact. Our trail is append-only, rewindable,
branchable and on the server. We should not grow a second, worse memory beside it — which is the
caution on `watch`: a watcher that mutates local state is the start of exactly that.

**The expression language.** `$cond`, `$template`, `$computed` is a programming language living in JSON,
untyped at its edges, and it only ever grows. It also breaks a rule of the house outright: *the model
never evaluates a rule.* Rules belong in `spec.rules` and compute modules; a `$cond` in a spec the model
wrote is a rule the model wrote. Our version of `$template` already exists and is narrower — notification
templates render `{order.id}` against declared args, server-side, from a spec a human wrote.

## The conversation point, sharpened

> *interacting with dynamic UI is like having a conversation — we don't know what you're going to say,
> but we have a common medium to say the things and communicate. Agreeing and disagreeing is proof the
> system works.*

This is the thesis json-render does not have, and it is worth being clear that we are not behind on it —
we are the only one of the two that has it at all.

A frozen spec has no way to disagree. There is nothing in `{root, elements}` that can say *no*, or *not
you*, or *did you mean this instead*, because the interface was decided before you touched it. The most
it can do is hide something.

Our disagreement machinery already exists and is scattered across four mechanisms that are worth naming
as one idea:

| | what it is |
|---|---|
| `ask` | the classifier was not confident, so the system says so and offers what it *can* answer |
| the gate | this persona may not ask that, and here is the way in |
| `confirm-write` | it understood, and will not act until you agree |
| the unmet channel | it could not answer, and the operator will see that it could not |

Those are the turns where the system declines, and they are exactly the "agreeing and disagreeing" that
makes the medium real. A system that can only ever succeed is not communicating; it is painting.

What this comparison does say is that our medium is currently coarse. One pour, one vessel, whole, at
the end. The conversation is real but each utterance produces a single monolithic reply. That is where
their encoding earns its place with us.

## What to borrow, concretely

Four things, in dependency order. The first is the one the others need; the last two are days of work
and independent of everything else.

### 1. A composite pour is a flat map of parts

Today an answer is one vessel and one blob:

```ts
export interface AnswerPour {
  kind: "answer"; shape: string; phrase: string;
  vessel: VesselName; answer: unknown; next: Chip[]; provenance: Provenance;
}
```

Borrowing their encoding, and *only* their encoding:

```ts
export interface CompositePour {
  kind: "composite";
  shape: string;
  phrase: string;
  root: string;                        // which part leads
  parts: Record<string, Part>;         // id → part, flat, patchable
  next: Chip[];
  provenance: Provenance[];            // one per part that ran calls
  classifier?: ClassMeta;
}

export interface Part {
  /** An existing pour, unchanged. Not a new component type. */
  of: AnswerPour | FormPour | NotificationPour;
  children?: string[];
  /** which plan step produced it, so the verify strip can stay honest */
  from?: string;
}
```

The important line is the comment. json-render had to invent a component catalogue because a model was
choosing the components; **we already have seven vessels and they keep their contracts exactly.** A part
*is* a pour. `container.tsx` gains one case, every vessel is untouched, and vessel overrides compose for
free because they are looked up per pour kind already.

Why a map rather than the list I first suggested in [nested shapes](nested-shapes.html): a list can only
be replaced whole. A map means one part can be patched while the others stand, a part can be *named* —
by a chip, by a stream patch, by an anchor — and the thing can arrive in pieces. None of that is
possible with an array, and all of it is the point.

**This is additive.** `composite` is a new member of the `Pour` union; nothing that exists changes
shape. Every `switch (pour.kind)` gains a case and keeps its others. That is what makes it worth doing
before the spec-format work rather than as part of it.

### 2. Streaming is plan progress, not token progress

We already have the channel — `/events`, and `Event { type: "turn" | "notification" | "ping" | "reload" }`.
Two more kinds:

```ts
{ type: "part", data: { turnId, id, part } }   // upsert one part of a composite
{ type: "settled", data: { turnId } }          // the plan finished; nothing more is coming
```

The planner already runs steps in order and records `{ id, call, ms, kind }` per step, so the emit point
exists. The visitor sees the catalogue results while the recommendations are still running.

Note what is being streamed. json-render streams *the model emitting a spec* — the UI appears because
generation is slow. We would stream *the plan resolving*, which is a better thing to show: not "the
model is still typing" but "the products are here, the delivery estimate is still coming". It also keeps
the classifier where it is, inside its hard budget, rather than on the critical path of the render.

### 3. `watch` becomes a chip that fires itself

Theirs reacts to a change by mutating local state. Ours should react to a change by *taking a turn* —
which is one field on something that already exists:

```ts
export interface Chip {
  label: string; shape: string; args?: Record<string, unknown>; gated?: boolean;
  /** fire on this field changing rather than on a click */
  on?: { field: string };
}
```

A country select changes, the chip fires, the engine classifies nothing and runs `loadCities{country}`
as a normal utterance: gated by persona, planned, provenanced, and appended to the trail. The cities
part is replaced by a patch from §2.

**Their watcher is a state mutation; ours is an utterance.** That difference is the whole reason not to
copy it directly — a watcher that writes to a client-side tree is the beginning of the second, worse
memory this document warns about twice.

### 4. An action log in the operator console

Every turn: persona, shape, confidence, the calls with their timings, what was read and written, the
outcome — including the refusals, which is what makes it interesting. The trail already holds all of
it and `Provenance` is already the right record. This is a query and a screen, not a system.

### 5. The answer's layout, declared — and derived when it is not

*Added with `rules.present` (`packages/spec/src/present.ts`), first tried in the shawnstewart site.*

Seven vessels say what *kind* of answer something is; they cannot say that a résumé leads with a
timeline, or that a press item's podcast-ness picks its icon and its "Listen". Every application that
cared wrote a hand-made vessel per shape, and every shape without one fell back to a readable dump.
`rules.present` is the spec saying how an answer looks, the way triggers say what a question means:

- **molecules** — per entity, which field is the title, eyebrow, body, link, tags, meter;
- **organisms** — per shape, the ordered sections its answer is laid out as (hero, stats, facets, grid,
  timeline, chips, steps, quotes, faq, prompts, panel, callout, actions…).

Undeclared, both are **derived**: field names and types give a molecule (an enum named `level` becomes a
meter), a shape's answer type gives its organisms, and a shape's `next[]` with `each: "answer.x"` gives
what clicking a row of `x` asks. The core resolves the tree and sends it with every answer as
`pour.present`, so a headless caller, an API client and every front end get the same page; `validate`
checks the declarations against the spec.

**How it holds the line above.** No model composes anything: the layout is a pure function of a spec a
human wrote and the answer the plan produced, and the same inputs give the same tree (there is a test).
A click is still an utterance — it asks a shape, gated and planned and appended to the trail — never a
client-side state mutation. `vessel` stays on the pour, so nothing that reads it changes.

**Where it leans on the line, said plainly.** Bindings are a small expression language, which is the
thing this document warns only ever grows: templates (`"{pillar} · {year}"`), a closed set of filters
(`date`, `year`, `upper`, `count`, `count:k=v`, `before`, `after`, `or`, `pad`), and one conditional
form (`{ "by": "$kind", "map": {…} }`). The guard is that the set is closed *in code* — a spec cannot
define a filter — and that every filter formats or counts; none decides what the business does. If
someone reaches for `$cond`, that is the moment to write a compute module instead.

## What not to borrow, and one more

The three from above stand: the model composing layout, a frozen spec with accumulating client state,
and the `$cond`/`$template`/`$computed` expression language.

One more, which is tempting: **code export**, turning a generated UI into a standalone React component
with no runtime dependency. It is a good escape hatch for their model — generation is expensive and
freezing a good result is sensible. For us it is backwards: our UI is derived from the spec, and the
whole argument of `fishtea update` is that derived things move when the source does. An exported copy is
a fork with extra steps.

## Order, and cost

| | | cost |
|---|---|---|
| 1 | composite pour, `{root, parts}` | the big one — touches `packages/ui`, the TUI, the headless runner, the bench and the e2e suite, because the pour union is load-bearing. Additive, so no migration. |
| 2 | streamed parts | small once 1 exists; the emit points are already there |
| 3 | self-firing chips | a day, independent |
| 4 | action log | a day, independent |

3 and 4 can be done now and are worth doing whether or not 1 ever happens. 1 should be decided before
[nested shapes](nested-shapes.html), because a composite is the thing an area pours and the encoding is
harder to change afterwards than to choose now.
