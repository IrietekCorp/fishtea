# Welcome

FishTea is a framework for building businesses you *ask*, instead of businesses you navigate.

You describe a business once, in one JSON file: what things are, what can be asked, what may be changed,
and by whom. Everything else is derived from that description: the database, the list of tools a small
language model is allowed to call, the planner that composes them, the interface a visitor sees, and the
console an operator runs it from. There are no routes to design, no pages to lay out, and no funnel to
maintain, because there are no pages.

If you want to start immediately, [Getting started](getting-started.html) is four commands. This page is
for the other question: *why does this exist, and why is it shaped like this?*

## Where the name comes from

**Fish tea** is a Jamaican broth. It contains no tea at all. It is called tea because it is kept thin and
clear, unlike the heavy stews and thick cornmeal soups it sits beside, and because it is served in a mug
and **sipped** rather than eaten in one go. It is what you are handed when you are fighting a cold. Whole
fish, thyme, scallion, garlic, pimento, cho-cho, green banana, yam, spinners: everything goes in the one
pot, and the broth carries all of it.

Four things about that dish describe this software better than any metaphor we could have invented.

**It is thin on purpose.** The thing that makes it *tea* is what has been left out. A framework earns the
same way: one description, everything derived, and no thick layer of conditional logic in between.

**Everything goes in one pot.** You do not make the broth in pieces and assemble it. The spec is the pot,
holding entities, rules, permissions, prices, what may be asked and by whom, and the schema, the tools, the forms
and the interface are all the same broth poured into different cups.

**The Scotch bonnet goes in whole and is never burst.** All of the heat, none of the chaos. That is
precisely the rule this framework is built on: the model is in the pot, and it is the reason the whole
thing has flavour, but it never decides whether you are allowed to ask something, never evaluates a
rule, and never authors a write. Burst that pepper into the broth and you cannot get it back out.

**It is liquid, and it is sipped.** An answer **pours** into a **vessel**. The conversation is a **trail**
you follow a sip at a time, not a page you swallow whole. *Solid ground, liquid UI.*

The name came from a 2006 project in PHP, XML and Smarty that already had the idea at its centre: you
described a problem in markup, and the data layer, the module and the template grew out of that
description instead of being written by hand. It got the data half right and stopped, for an honest
reason. The *conversation* half needed something that could work out what a person meant, cheaply enough
to sit in front of every single request. Nothing in 2006 could do that at any price, so the project
described businesses beautifully and then handed you a page anyway.

That constraint is gone. The name waited.

## What problem it solves

Software is assembled from modules built for everyone, so every variation (a different customer, tier,
market or permission) is paid for in conditional logic draped over something generic. That is inherited
rather than careless: we store data in rows and columns, then build software in the shape of the storage,
so anything not uniform (permissions, personalisation, pricing that depends on who is asking) arrives
late as a layer bolted on. It shows up most sharply in the URL, a string we have spent two decades
forcing to behave like a memory.

FishTea starts from a different premise: **a business is not a set of pages, it is an authority that
answers questions.** A shoe store is a place where you can ask anything about shoes, and that is the whole
definition, and none of it requires a page.

Four things follow, and they are the reason the rest of this is shaped the way it is:

- **Browsing is not a funnel.** It is how someone works out what they implicitly like. Most of it carries
  no purchase intent, and treating it as a path to checkout measures the wrong thing.
- **Search is not a result set to filter.** The search *is* the question, and what comes back is a set of
  opportunities to ignore or to go deeper. "Not those, something warmer" is the next turn, not a filter.
- **The domain is the constraint, and that is the feature.** A shoe store answers shoe questions. That
  boundary is what makes the expertise possible; a spec is that boundary written down.
- **Personalisation stops being a layer.** If the interaction *is* the conversation, every surface is
  already personal, by what was actually said, not by a profile.

→ The full argument is an essay: [Why a business is not a set of pages](blog/why-a-business-is-not-a-set-of-pages.html).

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
tomorrow and the "homepage" is the resumed conversation: the cart, the three things you were comparing,
the offer that makes sense *because of where you are*. First visit and return visit are the same code
path.

And a question the business cannot answer is not a 404. It goes to the operator's unmet channel, which
makes a failed question **demand signal** rather than an error.

## What a conversation grows into

The same description carries three things a site would otherwise need separate software for.

- **A visitor who comes back as themselves.** One rule turns on accounts: sign up with an email and a
  password or with Google, keep a profile and saved items across devices. The account is a row of *your*
  entity, so signing in makes the conversation personal without introducing a second idea of a person.
- **An operator console you declare.** Reports are query calls arranged into panels (tiles, a line, a
  bar, a table) with a period above the page. Jobs are the operator shapes themselves, each with a Run
  button and, if you want, a clock. Neither is a page anyone writes.
- **What the visitor did next.** An answer can end somewhere else: the shop that sells it, the paper
  behind the citation. An **echo** records that beside the turn whose answer offered the link, and only
  for a destination the conversation actually published, so it is the fact a business needs without
  being an open redirect.

## What to read next

- **[Getting started](getting-started.html)**: install it and make something in four commands.
- **[Glossary](glossary.html)**: a small vocabulary used precisely. Ten minutes here saves an hour later.
- **[Archetypes](archetypes.html)**: the five starting points and what their interviews ask.
- **[ChicDuJour](case-chicdujour.html)** and **[shawnstewart.me](case-shawnstewart.html)**: two live
  businesses running on this, and the specific mechanisms each one leans on.
- **[Running it](operating.html)**: the stack, the classifier pool, `/admin`, and visitor accounts.
- **[Echoes](echoes.html)**: what a visitor did with an answer that took them out of the conversation.
- **[The blueprint](blueprint.html)**: the full design, and the decisions that are settled.
- **[What the build measured](measured.html)**: where the implementation deviated from the design, each
  deviation backed by a measurement rather than an opinion.
