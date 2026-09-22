---
title: The five measurements that changed the design
date: 2026-09-21
summary: A blueprint is a hypothesis. Here is what happened when we pointed a profiler at the parts of it that mattered, and what we changed as a result.
author: Shawn J. Stewart
tags: classifier, performance
---

Every framework's design document is a set of predictions. Ours made five about the classifier, and four
of them were wrong. None of the corrections made the system worse — but all of them would have been
expensive to find later, which is the argument for measuring the risky parts before building on them.

## The embedding was four times larger than planned

The design assumed 768-dimension embeddings, because that is what most sentence encoders return. needle3's
`embed()` returns **3072 floats**.

That matters more than it sounds, because pgvector's `vector` index type caps out at 2000 dimensions. The
fix was `halfvec(3072)` with HNSW indexes throughout, which stores at half precision and indexes fine.
`FISHTEA_EMBED_DIM` overrides it for anyone whose model disagrees.

The lesson is narrow and useful: check the output dimension of the model you actually have before
choosing the column type it lands in.

## Classification is 200ms, not 30ms

The design budgeted 30ms at the median and 60ms at the tail. Reality on CPU, per `complete()` call:
**130–270ms**, plus about 10ms to embed, plus roughly 300ms extra the first time a worker sees a new tool
subset.

We did not try to make it faster. We changed the budget to 1000ms in the shipped samples and re-baselined
the benchmark around the truth. What matters is not the number; it is that the number is a *hard ceiling*
with a defined behaviour past it. Past the budget the pour is `ask` — the system says "tell me more"
rather than silently swapping in a worse model or holding the request open. A deadline you actually honour
is more valuable than a deadline you wish were shorter.

For the record, end to end: a scripted ten-step task takes 1.3s at the median, and the classifier is about
90% of it.

## The model was not stateless

The design assumed classification calls were independent. They are not — needle carries conversation state
across `complete()` calls, which meant an earlier utterance could quietly colour a later one.

The pool now `reset()`s before every request. This is the kind of assumption that produces bugs which look
like model flakiness and are not.

## Summarised context made it worse, not better

The plan was to give the classifier the last *k* turns, summarised. We tried it. Summaries like
`visitor: … → findAccessories (8 results)` actively confused the model: it started copying the prior
shape instead of reading the current utterance, and the longer prefill cost time for the privilege.

What works instead is narrower and cheaper. Context is (a) recalled turns from *other* trails, when they
genuinely resonate, and (b) for anaphoric utterances only — "the second one", "again" — the previous
answer's items by id and name. That is enough to make "add the second one" resolve to
`addToCart(productId=p_chrome_studs)`, and nothing more is needed.

More context is not better context. Anaphora needs a list; everything else needs silence.

## One worker per persona subset, not one pool for everything

The obvious design is a pool of interchangeable workers. Measured, switching a worker between tool subsets
costs a `needle_init` of **0.7–1.2 seconds** with documentation-rich tool JSON — against 125–310ms for the
classification itself. Under load it reached 3.7 seconds, and one abandoned slow request queued behind the
next produced a timeout cascade.

So each worker holds one persona subset. The dispatcher assigns unassigned workers first, then
least-recently-used, and prefers a worker already on the subset it needs. Requests whose client deadline
has passed are skipped rather than run. `NEEDLE_WORKERS` must be at least the number of distinct persona
subsets — three for every archetype we ship.

Warm-up is sequential on purpose: parallel initialisation thrashed to 48 seconds.

## What generalises

Four of these five findings are about the same thing: the cost model of a small local model is not the
cost model of an API call. Loading a tool list is expensive and inference is cheap, which inverts the
usual advice about pooling and caching. Measure that boundary early, because every architectural decision
downstream of it depends on which side is expensive.

The full record, including the parts that went to plan, is in
[what the build measured](../measured.html).
