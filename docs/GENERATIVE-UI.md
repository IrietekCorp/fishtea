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

## What to actually do

1. **Adopt `{root, elements}` for composite pours.** A flat, id-addressed map, patchable per element.
   This is a prerequisite for composites rather than a nice-to-have, and it should be decided before the
   [nested-shapes](nested-shapes.html) work, not after.
2. **Stream a pour progressively**, once the encoding allows a partial one to be meaningful.
3. **An action log in the operator console** — every turn's shape, args, calls and outcome, in order.
   Most of the data is already on the trail; it is a screen, not a system.
4. **`watch`, only if it can be server-side.** An element reacting to a change is useful; a second
   client-side state tree is not. If it cannot be expressed as a turn, do not build it.
5. **No expression language.** If a spec needs a condition, it is a rule, and rules have a home.
