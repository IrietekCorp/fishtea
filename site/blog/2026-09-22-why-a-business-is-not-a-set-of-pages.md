---
title: Why a business is not a set of pages
date: 2026-09-22
summary: A shoe store is a place where you can ask anything about shoes. That is the whole definition, and almost nothing we build works that way.
author: Shawn J. Stewart
tags: thesis, design
---

Walk into a shoe store and you do not navigate it. You ask.

Sometimes the question is sharp: *do you have these in a nine?* Usually it is vague: *something for a
wedding, not black, I'll be standing all day.* A good salesperson does not respond by handing you a
directory. They answer, and the answer contains a question, and twenty minutes later you have either
bought something or learned something about what you actually want.

That is what a shoe store **is**: a place where you can ask anything about shoes, from someone who knows
the stock. Everything else (the shelves, the window, the layout) is furniture arranged to support that
exchange.

Now look at the website. Categories. Filters. A grid. A breadcrumb trail telling you where you are in a
hierarchy that exists only because someone had to put the shoes *somewhere*. You are not asking anybody
anything. You are operating a database query through a costume.

We did not choose this. We inherited it.

## Modules are built for everyone, so they fit no one

Modern software is assembled. You reach for a component, a library, an API, a module, and you compose. It
is genuinely a better way to build than what came before, and it has a specific, recurring cost that we
have collectively agreed not to talk about.

A reusable module is reusable because it is built for everyone. Which means it is built for no one in
particular, and the distance between "everyone" and "you" gets paid for in **conditional logic**.

Every variation is a branch. A different customer tier. A different market. A different regulatory
regime. A different permission level. Someone mid-purchase versus someone browsing. Each one arrives as a
flag on a component, an option on a module, a branch in an endpoint, a special case in a template. None
of that complexity describes your business. All of it is the cost of bending a general thing into a
specific one, and you pay it again on every surface, because the web surface and the mobile surface and
the API surface each bend it separately.

Then the conditions start interacting, and you are maintaining a combinatorial space nobody ever designed.

## The shape of the storage became the shape of the software

This is not a failure of discipline, and you cannot refactor your way out of it, because its origin is
further back than your codebase.

We organise data in rows and columns. That is what the spreadsheet gave us, and then the relational
database formalised it, and it is genuinely one of the great ideas in computing. A table is uniform. Every
row has the same columns. That uniformity is exactly what makes queries fast, storage predictable and
reasoning tractable.

And then we built the software in the shape of the storage.

A list view is a table with the chrome on. A detail page is a row. A form is a row you are allowed to
write to. A REST endpoint is a table with a URL. The abstraction was so successful that it stopped being
one layer among several and became the grammar of the whole stack.

The trouble is that uniformity is a property of *storage*, not of *people*. Nothing about a customer is
uniform. What they are allowed to see is not uniform. What they should be shown is not uniform. What they
mean when they say "something warmer" is not uniform.

So everything non-uniform arrives late, as a layer. Permissions are a layer: a middleware, a policy
engine, a guard clause, checked after the shape of the thing has already been decided. Personalisation is
a layer: a recommendation widget bolted onto a generic page, a profile object consulted at render time.
Pricing that depends on who is asking is a layer. Every one of them is retrofitted onto a structure that
never expected them, and every one of them is where the bugs live.

## The URL is where it hurts most

If you want to see the rigidity at its sharpest, look at how we save state.

A URL is a string. We ask that string to carry where you are, what you filtered, what you sorted, which
step of a flow you reached, sometimes who you are. It is a location pretending to be a memory, and it is
terrible at it.

So we build machinery. Query-string serialisation. Router state. Deep-link restoration. Session storage
reconciled against the URL, because half the state would not fit. Analytics that tries to reconstruct
intent from a sequence of paths. Two decades of increasingly elaborate work whose entire purpose is to
make a filing-cabinet address behave like a conversation partner's short-term memory.

And it still cannot answer the simplest question a shop assistant answers effortlessly: *what were we just
talking about?*

## A business is an authority that answers questions

Here is the reframe the whole thing turns on.

A business (a shoe store, a clinic, a school programme, an employment verifier) is not a set of pages.
It is **an authority over a domain**, and a place that receives specific kinds of questions and produces
specific kinds of answers.

That definition is small and it is load-bearing. Take it seriously and several things follow that do not
follow from the page model.

**The store's job is to be expert about its own stock.** Not to display it. To classify everything it
knows well enough to answer questions about it, including questions nobody anticipated phrasing that
way. This is real work, and it is the *right* work, because it is work about your business rather than
about the shape of the web.

**Browsing is not a funnel.** We model browsing as a path toward purchase and instrument it accordingly,
and it mostly is not that. Browsing is how someone works out what they implicitly like and dislike. Much
of it has no purchase intent in it at all. Treating it as a funnel means measuring the wrong thing, and
frequently interrupting a process that was doing something genuinely useful for the customer.

**Search is not a query that returns a result set to filter.** The standard model hands the work back:
here are four hundred things, narrow them yourself. But in a conversation, the search *is* the question,
and what comes back is not a set to be filtered. It is a set of **opportunities to ignore or to go
deeper**. "Not those, something warmer" is not a refinement of a filter. It is the next turn. The
difference is not cosmetic: one of them accumulates understanding and the other resets it.

**The domain is the constraint, and that is the feature.** A shoe store answers shoe questions. Anything
outside the subject gets redirected or handled differently. That boundary is not an embarrassment to
apologise for with a general-purpose chatbot. It is precisely what makes the expertise possible. An
authority is defined by what it has authority over.

**The interface is last, and thinnest.** If the business really is a thing that answers questions, then
the conversation can happen over an API, in a voice assistant, in a terminal, or on a website, and none
of those is the *real* one. The website is a projection. That is a much healthier relationship than the
one where the website is the product and the API is an afterthought that exposes it.

**Personalisation stops being a layer.** This is the part that falls out for free, and it is the part I
find most persuasive. If the interaction between a customer and a business *is* the conversation, then
every surface is already personal: not by a profile, not by a flattened list of attributes and inferred
preferences, but by the actual richness of what has been said. There is no personalisation feature to
build, because there was never a generic surface needing to be personalised.

It also reframes analytics, which has been quietly broken for years. The session is the conversation, and
the conversation is the customer record. Not a sequence of URLs to be reverse-engineered into intent.

## What it demands

None of this is free, and I want to be precise about where the cost moves rather than pretend it vanishes.

You have to describe your business properly. What the things are, what may be asked about them, what may
be changed, by whom, under what rules. That description has to be good enough for something else to be an
expert on your behalf, which is a higher bar than "good enough to render a page."

That is the trade. You stop writing conditional logic to bend generic modules toward your specific
business, and you start writing down what your business actually is. One of those is work you can
accumulate. The other is work you repeat on every surface, forever.

And the part that has to stay fixed, stays fixed. Permissions, pricing, who may see what, what may be
written; those live in the description and in code, never in a prompt. A model can be trusted to work out
*which question* is being asked. It must never be the thing that decides whether you were allowed to ask
it.

Solid ground. Liquid UI.

---

*[FishTea](../welcome.html) is an attempt to build exactly this. The [blueprint](../blueprint.html) has
the full design, and [what the build measured](../measured.html) has the parts where reality disagreed
with it.*
