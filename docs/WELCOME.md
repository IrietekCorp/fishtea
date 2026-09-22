# Welcome

FishTea is a framework for building businesses you talk to instead of navigate.

You describe a business once, in one JSON file — what things are, what can be asked, what may be changed,
and by whom. Everything else is derived from that description: the database, the list of tools a small
language model is allowed to call, the planner that composes them, the interface a visitor sees, and the
console an operator runs it from. There are no routes to design, no pages to lay out, and no funnel to
maintain, because there are no pages.

If you want to start immediately, [Getting started](getting-started.html) is four commands. This page is
for the other question: *why does this exist, and why is it shaped like this?*

## Where the name comes from

The name is older than the software you are reading about. FishTea began in **2006**, written in PHP, XML
and Smarty, and it already had the idea at its centre: you described a problem in markup, and the data
layer, the module, the template and the connective tissue between them grew out of that description
rather than being written by hand.

Four things in that original still matter, because all four are here again:

- **The URL was the question.** Not a location — an intent.
- **A module described the problem, and its template grew from it.** One description, two derivations.
- **Components were embeddable answers.** A result could appear anywhere it made sense.
- **`Renv` remembered where you came from.** Arrival context was a first-class input.

It stopped half-finished, and for an honest reason: the *data* half was achievable in 2006 and the
*conversation* half was not. Nothing available then could conduct an interview or work out what someone
meant cheaply enough to sit in front of every request. So the project described businesses beautifully
and then handed you a page anyway.

<!--
  NOTE: the etymology of the word "FishTea" itself — why that name, in 2006 — is the author's to tell.
  Drop a sentence or two here and it will read naturally after the paragraph above.
-->

The liquid vocabulary grew up around the name and stayed: an answer **pours** into a **vessel**, the
conversation leaves a **trail**, and the whole thing runs on the principle that gives the project its
tagline — *solid ground, liquid UI*.

## Why it was rebuilt

Because the constraint that stopped it in 2006 is gone.

A small tool-calling model now runs **on the machine you already have**, classifies what someone said in
a couple of hundred milliseconds, and costs nothing per request. That single change makes the missing
half possible, and it makes it possible *cheaply enough to put in front of every request* — which was
always the real bar. Intent classification can finally replace routing.

That is the whole thesis. Everything in FishTea follows from it.

## What problem it solves

Conventional web applications make you build the same scaffolding for every business: routes, pages,
navigation, forms, a funnel, an admin panel — and then keep all of it in agreement with the data model
underneath as both drift. Most of that work is not about your business at all. It is about the *shape of
the web*, re-litigated per project.

FishTea replaces that scaffolding with a description and a conversation.

**Nothing is entity-specific outside the spec.** There is no `ProductCard` component, no `/products/:id`
route, no checkout wizard. There is a description of a product and what may be asked about one, and the
interface is derived. Change the description and the database migration, the model's tool list, the
forms and the UI all move together, because they were never separate things.

**The conversation is the unit of navigation.** A visitor says what they want. A classifier turns that
into a *shape* — a question the business can answer — the planner runs the typed *calls* the shape names,
and the answer pours into one of seven vessels. There is nothing to memorise and no path to re-walk.

**State is a point in a conversation, not a URL.** The trail is append-only, rewindable and branchable. Go
back three turns, ask something different, and you have a branch — the original is still there. Return
tomorrow and the "homepage" is the resumed conversation: the cart, the three things you were comparing,
the offer that is relevant *because of where you are*. First visit and return visit are the same code
path.

**A failed question is information, not an error.** When someone asks for something the business cannot
answer, that lands in an operator's unmet channel. It is demand signal.

**What must stay fixed, stays fixed.** Permissions, pricing, tax, who may see what, what may be written —
these live in the spec and in code, never in a prompt. The model chooses *which question* is being asked.
It never decides whether you are allowed to ask it, never evaluates a rule, and never authors a write: a
write always pours a confirmation first. That separation is what "solid ground" means, and it is the part
that makes the liquid half safe to build on.

## How it fits together

```
visitor says something
   ↓
classifier  →  a shape (a question the business can answer)
   ↓
planner     →  typed calls, composed
   ↓
pour        →  ask · form · answer · confirm-write
   ↓
vessel      →  list · card · detail · compare · timeline · confirm · notice
```

Every pour carries its own provenance — which shape answered, what it read, what it wrote, how long it
took — and the UI shows it. You can always see why you got what you got.

## What to read next

- **[Getting started](getting-started.html)** — install it and make something in four commands.
- **[Glossary](glossary.html)** — this project uses a small, precise vocabulary. Ten minutes here saves an
  hour later.
- **[Archetypes](archetypes.html)** — the five starting points and what their interviews ask.
- **[The blueprint](blueprint.html)** — the full design, including the decisions that are settled and why.
- **[What the build measured](measured.html)** — where the implementation deviated from the design, each
  deviation backed by a measurement rather than an opinion.
