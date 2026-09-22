# Welcome

FishTea is a framework for building businesses you *ask*, instead of businesses you navigate.

You describe a business once, in one JSON file — what things are, what can be asked, what may be changed,
and by whom. Everything else is derived from that description: the database, the list of tools a small
language model is allowed to call, the planner that composes them, the interface a visitor sees, and the
console an operator runs it from. There are no routes to design, no pages to lay out, and no funnel to
maintain, because there are no pages.

If you want to start immediately, [Getting started](getting-started.html) is four commands. This page is
for the other question: *why does this exist, and why is it shaped like this?*

## Where the name comes from

**Fish tea** is a Jamaican broth. It contains no tea at all — it is called tea because it is kept thin and
clear, unlike the heavy stews and thick cornmeal soups it sits beside, and because it is served in a mug
and **sipped** rather than eaten in one go. It is what you are handed when you are fighting a cold. Whole
fish, thyme, scallion, garlic, pimento, cho-cho, green banana, yam, spinners — everything goes in the one
pot, and the broth carries all of it.

Four things about that dish describe this software better than any metaphor we could have invented.

**It is thin on purpose.** The thing that makes it *tea* is what has been left out. A framework earns the
same way: one description, everything derived, and no thick layer of conditional logic in between.

**Everything goes in one pot.** You do not make the broth in pieces and assemble it. The spec is the pot —
entities, rules, permissions, prices, what may be asked and by whom — and the schema, the tools, the forms
and the interface are all the same broth poured into different cups.

**The Scotch bonnet goes in whole and is never burst.** All of the heat, none of the chaos. That is
precisely the rule this framework is built on: the model is in the pot, and it is the reason the whole
thing has flavour — but it never decides whether you are allowed to ask something, never evaluates a
rule, and never authors a write. Burst that pepper into the broth and you cannot get it back out.

**It is liquid, and it is sipped.** An answer **pours** into a **vessel**. The conversation is a **trail**
you follow a sip at a time, not a page you swallow whole. *Solid ground, liquid UI.*

The name came from a 2006 project — PHP, XML and Smarty — that already had the idea at its centre: you
described a problem in markup, and the data layer, the module and the template grew out of that
description instead of being written by hand. It got the data half right and stopped, for an honest
reason. The *conversation* half needed something that could work out what a person meant, cheaply enough
to sit in front of every single request. Nothing in 2006 could do that at any price, so the project
described businesses beautifully and then handed you a page anyway.

That constraint is gone. The name waited.

## What is actually wrong with how we build software

Software is assembled from modules, and **the modules are built for everyone**. That is what makes them
reusable, and it is also what makes them wrong for you. Every variation — a different customer, a
different tier, a different market, a different permission — is expressed as *conditional logic* draped
over something generic. The component grows flags. The API grows branches. The module grows options. None
of that complexity is about your business; it is the cost of bending a general thing into a specific one,
paid again on every surface.

This is not a failure of discipline. It is inherited. We organise data in rows and columns because that
is what spreadsheets and databases gave us, and then we build software in the shape of that storage. A
row is uniform. Every row has the same columns. So the software that reads it is uniform too, and
anything that is *not* uniform — permissions, personalisation, pricing that depends on who is asking —
arrives late, as a layer bolted onto a structure that never expected it.

The rigidity shows up most painfully in the URL. A URL is a string that has to carry state — where you
are, what you filtered, who you are, what you were doing. It is a terrible container for any of that, and
we have spent two decades building increasingly elaborate machinery to make a location pretend to be a
memory.

## The reframe

**A business is not a set of pages. It is an authority that answers questions.**

A shoe store is a place where you can ask anything about shoes. That is the whole definition. A customer
walks in with a question — sometimes sharp ("do you have these in a 9?"), usually vague ("something for a
wedding, not black") — and the store's job is to be *expert enough about its own inventory* to answer it.

Nothing about that requires a page.

**Browsing is not a funnel.** We model browsing as a path toward a purchase, and it usually is not.
Browsing is how a customer works out what they implicitly like and dislike, and most of it is not
purchase intent at all. Treating it as a funnel means measuring the wrong thing and interrupting a
process that was doing something useful.

**Search is not a query that returns a result set to filter.** That model puts the work on the customer:
here are 400 things, narrow them yourself. In a conversation, the search *is* the question, and the
results are not a set to be filtered — they are **opportunities to ignore or to go deeper**. "Not those,
something warmer" is not a refinement of a filter. It is the next turn.

**The domain is the constraint.** A shoe store answers shoe questions. Anything outside that subject is
redirected or handled differently, and that boundary is not a limitation to be apologised for — it is
what makes the expertise possible. A spec is exactly that boundary, written down.

**The interface is last and thinnest.** If the business is genuinely a thing that answers questions, the
conversation can happen over an API, in a voice assistant, in a terminal or on a website, and none of
those is the *real* one. FishTea's web UI is a projection of the conversation, not the product.

**Personalisation stops being a layer.** This is the part that falls out for free. If the interaction
between a customer and a business *is* the conversation, then every surface is already personalised —
not by a profile, not by a flattened list of attributes and preferences, but by the actual richness of
what has been said. There is no personalisation feature to build, because there was never a generic
surface to personalise.

## How that becomes software

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

The business describes itself once. That description becomes the tools the classifier is allowed to pick
from, so the model can only ever choose a question this business can actually answer. The planner runs
the typed calls that question names. The answer pours into a vessel chosen from the *shape of the data*,
never from the name of the question.

State is a point in a conversation rather than a string in a URL. The trail is append-only, rewindable and
branchable: go back three turns, ask something different, and the original is still there. Come back
tomorrow and the "homepage" is the resumed conversation — the cart, the three things you were comparing,
the offer that makes sense *because of where you are*. First visit and return visit are the same code
path.

And a question the business cannot answer is not a 404. It goes to the operator's unmet channel, which
makes a failed question **demand signal** rather than an error.

## What to read next

- **[Getting started](getting-started.html)** — install it and make something in four commands.
- **[Glossary](glossary.html)** — a small vocabulary used precisely. Ten minutes here saves an hour later.
- **[Archetypes](archetypes.html)** — the five starting points and what their interviews ask.
- **[The blueprint](blueprint.html)** — the full design, and the decisions that are settled.
- **[What the build measured](measured.html)** — where the implementation deviated from the design, each
  deviation backed by a measurement rather than an opinion.
