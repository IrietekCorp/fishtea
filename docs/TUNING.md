# A classifier for one business

Every other lever on the classifier slides along a fixed curve. Capping the decode trades a truncated
answer for a shorter tail. A shallower rung trades accuracy for speed. Persona subsets buy accuracy only
because there is less to be wrong about. Measured, the depth ladder is one straight line:

| rung | median classify | accuracy, 24 cases | peak RSS |
|---|---|---|---|
| 20 layers (stock) | 182 ms | 16/24 | 119 MB |
| 14 layers | 145 ms | 14/24 | 133 MB |
| 8 layers | 78 ms | 8/24 | 83 MB |
| 4 layers | 42 ms | 12/24 | 54 MB |

And no gate recovers the difference: to match full depth's accuracy from the 8-layer rung you must
escalate 20 of 24 queries to full depth anyway, which costs **243 ms** against full depth's 184. The
shallow rung's confidence does not know which of its own answers are right. The measurements are in
`packages/classifier/contract.md`, Phase 5.

**Fine-tuning a rung on one application's own tools is the only thing that moves the line.** The first
evidence agrees: an 8-layer rung tuned for *two steps* on twenty-one hand-written rows answered 7 of 9,
two of them held out, in **49–88 ms** against the stock model's 182.

## The corpus writes itself

This is the part that belongs to the framework rather than to the operator, because a spec has already
declared the material:

| in the spec | becomes |
|---|---|
| a shape's `triggers` | the queries — the phrases the author said people use |
| its `input`, with each field's `doc` | the arguments, and which ones are required |
| its `allow` | which persona subset the example is trained against, since a subset is what a worker binds |
| `seed/*.json` | real ids, categories, tags and brands to put in the arguments |
| the trail | what visitors **actually** said, and which shape it turned out to be |
| `conversation.unmet` | real sentences, typed at this business, that genuinely have no shape |

```bash
fishtea tune data                 # from the spec and the seed
fishtea tune data --trail         # and from what visitors really said
fishtea tune status               # is the corpus still about this spec?
```

The archetypes derive 40–120 examples from nothing but their own spec. That is a floor, not a corpus:
`--trail` adds the real thing, and `needle finetune --generate N` will synthesise more through
OpenRouter if you give it a key.

Two behaviours are trained separately, and the distinction matters more here than it would elsewhere:

- **A bare trigger names the shape with no arguments.** "check out" must reach `checkout` even though it
  carries no address, because the engine's answer to a missing required argument is to pour a form that
  collects one (`missingRequired`). Teaching the model to say nothing instead would lose the turn.
- **A trigger carrying a value fills it completely.** "add p_coral_hoops to my cart" has to come back
  with the id, not the word "add".

A half-filled call is the one case that is neither, and the corpus never contains one — it would teach
the model to drop a value it had already extracted.

Refusals are in there too. Needle is good at them out of the box ("what's the weather in Lagos" comes
back empty at 0.94 confidence) and it is the first thing a corpus of nothing but positives trains away.

## When it runs

Deriving is milliseconds, so it belongs wherever the spec changes. Training is not, so it does not.

**Derive at build time.** `fishtea tune data` reads files and writes one. Put it beside `fishtea derive`
in CI, or run it after any spec edit.

**Train on a GPU, and then it is minutes rather than a day.** `needle finetune` is JAX, and the
difference between its two backends decides whether tuning is a scheduled job or part of the loop:

| | 16 CPU cores | one RTX 3060 (12 GB) |
|---|---|---|
| throughput | ~7 examples/minute | ~240 examples/minute |
| the 120-example ecommerce corpus, 12 epochs | ~3 hours (extrapolated) | **~5 minutes** |

That is about **30×**, and it is a consumer desktop card rather than a datacentre one. It does need
`pip install "jax[cuda12]"` — the plain `cactus-needle` install is CPU-only and says so in one line at
startup, which is easy to miss — plus `sentencepiece`, `flax`, `optax` and `orbax-checkpoint`, which the
base package does not pull in. And it wants `--batch-size 2 --max-len 768`: the default batch exhausts
12 GB and fails with `RESOURCE_EXHAUSTED` partway through the first step.

So the earlier advice here — a nightly or weekly job on a GPU box, or the hosted service — understated
what a developer machine can do. At five minutes a run, tuning on a spec change is reasonable, and the
build-time/schedule split below is about *where it is appropriate*, not about what is affordable.

**Never train on the box that is serving.** The CPU run saturated all sixteen cores and the classifier
pool degraded with it: the same labelled set that scores a 227 ms median on a quiet machine scored
**951 ms** and lost eight points of accuracy while training ran beside it. That is the concurrency
collapse in `contract.md` Phase 5 arriving by a side door, and it means a benchmark taken during a
training run is not a benchmark. `fishtea eval` records its median latency in the baseline for exactly
this reason — a baseline whose median is four times the expected one was measured under load.

**Staleness is the trigger.** `.fishtea/tune/manifest.json` records the `shapes` and `personas` hashes
the corpus was derived from — the only two sections that can make a model wrong, since the first is what
the tools come from and the second decides which subsets exist. A call's SQL, a layout or a notification
can change freely. When either moves:

```
$ fishtea tune status
  corpus     120 examples  trigger:27  argument:35  intent:45  off-topic:13
  derived    2026-10-29T09:34:07.185Z
✗ stale: shapes changed since it was derived — run: fishtea tune data
$ echo $?
1
```

`fishtea doctor` reports the same line, and the non-zero exit is what a cron job or a CI step keys off.

## What is not solved: confidence

**A locally fine-tuned model has no confidence head.** The toolchain says so, and the built model
confirms it:

```
$ needle finetune corpus.jsonl --epochs 1 --out adapter.safetensors
  note      local tuning leaves the confidence head untrained; needle build drops it and confidence reports None
$ needle build --lora adapter.safetensors --layers 8 --out tuned.cact
  dropped   the confidence head; it is not trained locally, so confidence reports None
```

Every answer then comes back with `confidence: None`, which the core reads as `0`, which is below
`rules.classify.floor`, which pours `ask`. A tuned model dropped in as-is would make the application
stop answering altogether. This is the blocker, and it is a gating problem rather than a modelling one —
the routing was good.

Cactus's hosted fine-tuning would solve it — the head is trained with the model and calibrated on your
tools, and it is the only documented way to keep a calibrated confidence. **It is not an option for the
framework.** FishTea is meant to be distributed and to run locally; a framework that cannot produce a
working classifier without someone's API key has moved the dependency it was trying to remove. An
application may choose the hosted service for itself. The framework may not choose it for everybody.

So the way through is **a confidence FishTea computes itself**, from signals it already has and the
model cannot fake:

| signal | where it comes from |
|---|---|
| the call names a shape this persona may ask | the gate, which runs anyway |
| every required argument is present | `missingRequired`, which exists |
| no argument was ungrounded | `validation.ungrounded`, still in the envelope with the head gone |
| exactly one call was emitted | the envelope |
| the shape's own trigger is in the text, and no other shape's is | the lexical classifier, which ships already, and costs nothing |

That last one is the interesting one: FishTea carries a *second, independent* router, and two routers
agreeing is evidence while disagreement is exactly when you want to pour `ask`.

That set now exists — 194 labelled cases across the four archetypes, `fishtea eval` — and it says
something different from what this section expected. See **What the labelled set found** below: the
answer is not that a derived confidence rescues the gate, it is that *no* gate rescues this classifier,
and the order of the work is the other way round from how it is written above.


## The labelled set

`fishtea eval` runs a file of hand-labelled utterances — `eval/classify.jsonl`, one JSON object a line —
and reports accuracy by population, the floor the answers imply, and how the classifier compares with
the lexical router that ships anyway. The archetypes carry 194 cases between them.

```bash
fishtea eval --check                      # every label consistent with the spec, nothing run
fishtea eval --intent needle --versus     # run it, and compare with the lexical baseline
fishtea eval --json out.json              # the raw answers, for sweeping anything else
```

This is the only artefact here a spec cannot derive, and that is the point: it is a person saying what a
sentence means. Which makes a quietly wrong label worse than a missing one, so `checkCases` refuses a
case naming a persona or shape that does not exist, an argument the shape does not take, a refusal tag
that names a shape, a bare case demanding arguments, a duplicate, and — the most damaging one — a shape
the asking persona is never offered, which looks like a hard case and is an impossible one.

**The tags are the design.** Accuracy over a bag of sentences is nearly meaningless, because the
composition of the bag sets the number:

| tag | what it asks |
|---|---|
| `plain` | carries the shape's own trigger — the lexical router gets these free |
| `paraphrase` | contains no trigger at all, **the population that justifies the model** |
| `collision` | one shape's trigger inside a sentence that means another |
| `bare` | a trigger with no arguments, which must still route so a form can be poured |
| `anaphora` | needs the prior turn, in the exact line `recentContext` builds |
| `out-of-subset` | a real shape this persona is never offered: silence is the only right answer |
| `unsupported` | a plausible question about this business with no shape behind it |
| `off-topic` | nothing to do with the business |

About a third of every set is a refusal, deliberately. A set of positives cannot distinguish a floor
that keeps good answers from one that admits bad ones, which is the only question a floor exists to
settle — it would recommend zero every time and look right doing it.

## What the labelled set found

Three things, and the third one reorders the work.

**The model earns its keep exactly where it was supposed to, and only there.** On ecommerce the lexical
dev harness scores 42/56 against needle's 27/56 — the *dictionary beats the production classifier
overall* — but split by population the picture inverts where it matters: `plain` 11/11 lexical against
7/11 needle, and `paraphrase` 3/13 lexical against 7/13 needle. The lexical router wins the aggregate by
being cautious, and loses the sentences nobody phrased in the shop's own words.

**On engine 3.0.4 the classifier substitutes rather than declines.** Every archetype scores **0** on
`out-of-subset`. Offered only a stranger's five tools, "check out" comes back as `trending` at
confidence 0.57, reasoning *"User wants to check out. Use trending to see what's popular."* The gate
does not catch this, because `trending` is a shape a stranger may ask — the gate is working exactly as
designed and the wrong answer is a routing error, not an access one. Engine 3.2.8 is far better here
(refusals 69–83% against 13–62%) and marginally worse at routing, which is the right trade for a
framework whose rule is that a failed classify pours `ask` and never a worse answer.

**No gate separates right from wrong on either engine.** This is the finding that matters:

| gate | 3.0.4 keeps / admits | 3.2.8 keeps / admits | model-only wins kept |
|---|---|---|---|
| `head ≥ 0.35` (shipped) | 66/75 · **45/59** | 17/63 · **0/20** | 11/12 · 2/7 |
| `head ≥ 0.20` | 70/75 · 53/59 | 23/63 · 9/20 | 11/12 · 4/7 |
| required arguments all present | 71/75 · 58/59 | 59/63 · 20/20 | 12/12 · 7/7 |
| arguments present **and** the lexical router agrees | 59/75 · **2/59** | 52/63 · **2/20** | **0/12 · 0/7** |
| arguments present and lexical does not contradict | 67/75 · 51/59 | 55/63 · 18/20 | 8/12 · 3/7 |

Read the last column. The one derived gate that genuinely filters — arguments complete *and* the second
router agrees — throws away **every single answer the model got and the dictionary missed**: all twelve
on 3.0.4, all seven on 3.2.8. "I need a gift for my sister's birthday", "we're free the last week of
July", "take p_brass_threaders out of my cart". A gate that requires the dictionary to agree *is* the
dictionary, with a 35 MB model attached for decoration. It scores beautifully in aggregate because most
correct answers are ones the dictionary also finds, and it deletes the entire reason for the model.

Everything else admits 17 to 58 of the wrong routes. **The wrong answers look exactly like the right
ones on every signal available without the model's head.**

### So the order of the work is the other way round

This document has said that the tuning path is blocked on confidence: a locally tuned rung reports
`confidence: None`, so the gate rejects everything, so tuning cannot ship. The labelled set says the
dependency runs the other way. On 3.0.4 the classifier is wrong on **59 of the 134 answers it offers**,
and on 3.2.8 on 20 of 83. **No threshold rescues a classifier with that error rate; it only chooses
which mistakes to make.** Confidence is not blocking tuning — accuracy is blocking confidence, and
tuning is the only measured lever on accuracy.

That makes the sequence: tune a rung on the derived corpus, re-run `fishtea eval`, and only then ask
what gates it — because a classifier that is right 90% of the time can be gated by signals that are
useless at 60%, and `fishtea eval` is now the instrument that will say so. It also means the labelled
set is the training set's held-out twin, and the two must not be allowed to merge: `fishtea tune data`
derives from triggers, inputs, seed and trail, and nothing in `eval/classify.jsonl` is ever fed to it.

## What tuning actually bought

The first end-to-end run: `fishtea tune data` on the ecommerce archetype (120 derived examples),
`needle finetune --epochs 12 --batch-size 2 --max-len 768` on an RTX 3060 (~7 minutes, validation loss
0.0895, 11 of 18 held-out calls exact), `needle build --lora` at three depths, each served through the
real pool and scored with `fishtea eval` on a quiet machine.

| configuration | overall | routed | refused | paraphrase | median | archive |
|---|---|---|---|---|---|---|
| stock L20, engine 3.0.4 *(what ships)* | 26/56 | 23/41 | 3/15 | 5/13 | 249 ms | 35.3 MB |
| **tuned L20** | **31/56** | **27/41** | 4/15 | **7/13** | **203 ms** | 63.4 MB |
| stock L8 | 18/56 | 15/41 | 3/15 | 1/13 | 89 ms | 27.4 MB |
| **tuned L8** | **23/56** | 18/41 | **5/15** | 2/13 | **78 ms** | 27.4 MB |
| tuned L4 | 19/56 | 18/41 | 1/15 | 3/13 | 42 ms | 15.4 MB |

**Tuning is worth +5 of 56 at full depth and +5 at eight layers, and it costs nothing.** Same archive
size at the same depth, same or better latency. Against a run-to-run variance of ±1–2 on identical
configurations (measured: the same stock run scored 26 then 25), +5 is a real effect.

**This is the first thing measured here that moves the curve rather than sliding along it.** Tuned L8
answers in **78 ms against stock L20's 249** — 3.2× faster — and loses three correct answers doing it.
Every other lever traded accuracy for latency at roughly par; this one buys both at once, which is what
the whole document predicted and had not until now demonstrated.

**The shallow rungs fail in different ways, and only the labelled set shows it.** Tuned L4 routes as
well as tuned L8 (18/41 each) but refuses almost nothing (1/15 against 5/15): it answers everything.
That is invisible in an overall score — 19 against 23 looks like "a bit worse" — and decisive in
practice, because a router that never declines is one that confidently mis-answers. The paraphrase
column tells the other half: 7/13 at full depth, 2/13 at eight layers. Depth is what carries
generalisation; the corpus cannot put it back.

**Do not read the L8 drop as the corpus overfitting to triggers.** That was the obvious hypothesis — a
corpus derived from triggers teaching the model to be a dictionary — and the control refutes it. The
same adapter at full depth *gains* paraphrases (5 → 7) and takes collisions to 6/6. The corpus is fine;
eight layers cannot carry it.

### Two things the toolchain does that nothing documented

**`needle build --lora` drops the embedding head, not just the confidence head.** The tuned archive has
seven tensors fewer than the stock one, and `needle_embed` raises `RuntimeError: needle_embed failed
(code -1)` on every call. The pool computed its vector width during warm-up, so it reported *every*
tuned model as a worker that failed to load — the one measured lever on accuracy was unloadable. The
pool now requires routing and treats embedding as optional, reports `"embeddings": false` in
`/healthz`, and answers `/embed` with a refusal rather than dying. What is actually lost is
familiarity/recall, which needs those vectors; the turn itself is answered normally.

**A locally tuned archive is 1.8× the published size.** Tuned L20 is 63.4 MB against the published
35.3 MB, entirely because the exporter writes CQ4 where the published file is CQ2 — the same
`WEIGHT_BITS = 4` guard described below. So the edge arithmetic in that section applies to the stock
archive, and a tuned one is twice the download until that guard lifts.

## How small it goes, and what the megabytes are

The documented range for needle3 is 8–29 MB, which is a real range but not an obvious one: the published
`needle3.cact` on disk is **35.34 MB**. Taking the archive apart says why. Its format is a header, a
nameless tensor directory and 64-byte-aligned blobs, so every tensor can be measured:

| part of the published 20-layer archive | width | MB | share |
|---|---|---|---|
| **engram tables** | CQ2 | **20.21** | **57%** |
| transformer layers | CQ2 | 9.53 | 27% |
| embedding / vocabulary | CQ4 | 3.24 | 9% |
| layer norms, gates, Hadamard diagonals | FP16 | 1.22 | 3% |
| mHC blocks | CQ4 | 0.76 | 2% |
| tokenizer | RAW | 0.11 | — |
| probe heads (embedding, confidence, router) | CQ4 | 0.04 | — |

Three things set the size, and only one of them is a flag.

**Depth, which moves more than the layers.** `needle build --layers N` exports any rung from 2 to 20, and
it takes the engram sites down with it — five sites at 20 layers, two at 8, one at 4. Since the tables
are the biggest line in the file, depth is the dominant size lever precisely because of what it drags
along, not because of the transformer.

**Quantisation width, worth about 1.9×.** The published archive puts its two big parts at **two bits**.
The pip package's exporter writes **four**, and refuses anything else — `WEIGHT_BITS = 4`, with
`_cq_pack` raising on any other value — although the format defines 1, 2, 3, 4 and ternary, the runtime
reads them (the published file proves it), and the codebook machinery in `quantize.py` already builds
2- and 3-bit codebooks. Lifting that one guard locally and exporting at two bits produces archives the
engine loads and runs correctly:

| rung | as the public tooling builds it (4-bit) | at the published width (2-bit) | peak RSS | accuracy, 24 cases |
|---|---|---|---|---|
| 2 layers | — | **7.00 MB** | 36 MB | 11/24 |
| 4 layers | 15.39 MB | **8.12 MB** | 40 MB | 11/24 |
| 8 layers | 27.41 MB | **14.44 MB** | 58 MB | 13/24 |
| 20 layers | (35.34 MB published) | 35.34 MB | 119 MB | 16/24 |

That is the documented 8–29 MB range, reproduced. Two bits costs little or nothing in accuracy here,
because an untuned shallow rung is limited by its depth rather than its precision. **So everything the
public toolchain builds is about twice the size it needs to be, and closing that is a question for
Cactus rather than a thing to engineer around.**

**A floor that depth cannot touch.** The embedding is 8192 × 768 and the tokenizer is a raw blob:
**3.35 MB** that is there at two layers and at twenty. No rung goes below it.

### What that means for running the router on the client

The browser target is real and small: `needle build --platform wasm` emits `needle.wasm` at **0.93 MB**
and `needle.js` at 62 KB, beside whichever archive you choose. So a FishTea application could ship its
own router to the browser for **9–15 MB**, cached once.

The prize is not the download. It is that [the pool's hard ceiling](operating.html) — one classify at a
time, four to five a second per host, because the engine spins twelve threads and collapses when
oversubscribed — **is a property of classifying on the server.** A router that runs on the client brings
its own CPU, and the ceiling stops existing. That is the version of this that can stand in for a
conventional framework's router and session layer at any scale.

### What it actually costs in a browser

Measured in headless Chromium on sixteen cores, against the same twenty-nine ecommerce cases every
native number here comes from, so the two columns are comparable:

| rung | archive | native median | **in-browser median** | cold start | heap | accuracy |
|---|---|---|---|---|---|---|
| 20 layers | 35.34 MB | 187 ms | **888 ms** | 6.1 s | 85 MB | 22/29 (native 23) |
| 8 layers, 2-bit | 14.44 MB | 81 ms | **392 ms** | 2.4 s | 35 MB | 18/29 (native 18) |
| 4 layers, 2-bit | 8.12 MB | 47 ms | **215 ms** | 1.2 s | 20 MB | 17/29 (native 16) |
| 2 layers, 2-bit | 7.00 MB | 30 ms | **142 ms** | 0.7 s | 17 MB | 15/29 (native 13) |

**The browser is 4.7× slower than native, and it is 4.7× at every rung** — a ratio that flat is a
structural cost, not a quirk. It is the thread count: the published `needle.wasm` has no pthreads and
never touches `SharedArrayBuffer`, so it runs on one core where the native engine spins twelve. The same
spin-barrier design that makes [the native pool collapse under concurrency](operating.html) is simply
absent here. And `needle build --platform wasm` only *downloads* a prebuilt engine — the binary is
byte-identical whichever `cactus-needle` fetches it — so this is not a flag anyone can set. It is the
second thing worth raising with Cactus, beside the 4-bit export guard.

Accuracy survives the crossing: within the run-to-run variance already recorded, the browser scores what
the native engine scores on the same archive.

**The cold start is the prefix, not the download.** Fetching 8 MB and compiling a 0.93 MB engine is tens
of milliseconds; `needle_init` is 1.2 s at four layers and **6.0 s at twenty**, because it prefills the
579-token system-and-tools prefix. It is paid once per page, it scales with the tool list, and it is the
strongest argument for persona subsets in the browser — a smaller subset is a shorter prefix.

**The engine must run on a worker, and that is not an application's choice.** On the main thread a
classify is a synchronous C call that blocks everything: probing `requestAnimationFrame` through one
second of classifying gives a **worst frame gap of 1000 ms and 14 frames where idle draws 74**. The page
is frozen. Moved to a `Worker`, the same five classifies leave the main thread at 17 ms frames and 74
frames — indistinguishable from idle — and cost the same 203 ms each. A conversational interface that
freezes while it thinks is worse than a slow one.

**The floor would silence it today.** The WASM engine carries the newer calibration, not the pinned
3.0.4 one: median confidence on a *correct* route is **0.22** at twenty layers and 0.01–0.05 on the
shallow rungs. At `rules.classify.floor` of 0.35 a browser build would reject 11 of 19 correct routes on
the full model and **every** correct route on the shallow ones — the application would pour `ask` at
everything. This is the same conclusion the engine-upgrade measurement reached from the other direction,
and it is the same remedy: the floor has to be re-derived from a labelled set, or replaced by the
derived confidence above. Shipping the browser build on 0.35 would ship a mute application.

So the shape of a client-side router is already clear: **a tuned four-layer rung at two bits, on a
worker, gated by FishTea's own confidence.** That is 8 MB, a 1.2-second cold start and roughly 200 ms a
turn, with no per-host ceiling at all. Every piece of it is work already named — the tuning, the derived
confidence, the labelled set — and none of it is a browser problem.

Two caveats on the numbers. They are Chromium on a desktop; Safari and Firefox are unmeasured, and a
phone has neither these cores nor this memory bandwidth, so treat 4.7× as the shape and not the
constant. And the archive fetch above is from localhost — over a real network the 8 MB is a download,
cached after the first visit.

## Why the floor is 0

`needle3.cact` is byte-identical between `cactus-needle` 3.0.4 and 3.2.8 — only the engine differs — and
latency is identical at every percentile. Confidence is not, and the difference is not a rescaling that
a new threshold would fix.

Over the whole labelled set on **3.2.8**, the engine this framework now pins:

| | confidences, sorted |
|---|---|
| correct routes (18) | 0.002 0.003 0.004 0.015 0.018 0.024 0.025 0.038 0.047 0.048 0.094 0.106 0.148 0.348 0.363 0.407 0.429 0.456 |
| wrong routes (3) | **0.085 0.125 0.138** |

**The wrong routes sit inside the correct distribution, with ten of the eighteen correct ones below
them.** There is no threshold. A floor above 0.138 excludes the wrong answers and thirteen of the right
ones with them; a floor below 0.085 excludes nothing. Every archetype shows the same shape — the sweep
that `fishtea eval` prints loses a third to a half of correct routes at the very first non-zero step.

So `rules.classify.floor` ships at **0**, and the templates set it explicitly. That is not giving up on
safety; it is declining to pretend. A number that discards correct answers without excluding wrong ones
is not a safety valve, it is a tax that looks like one. What actually protects a turn is the machinery
that was always doing the work:

- **the gate** — permission is checked after classification, so a shape this persona may not ask is
  refused no matter how confident the model was;
- **`missingRequired`** — an incomplete call pours a form that collects the rest instead of acting;
- **`confirm-write`** — every write is shown to the visitor before it happens, and they say yes;
- **the model itself**, on this engine: 3.2.8 declines rather than substituting (69–92% of the cases
  where silence is correct, against 13–62% on 3.0.4), and a refusal needs no threshold.

A floor of 0 also admits a locally tuned rung, whose head is dropped at build time and reports 0 on
every answer — so the one measured lever on accuracy stops being gated away by a number that was never
measuring anything.

**Raise it only from your own measurement.** `fishtea eval` prints the sweep and names the best
separation for *your* cases and *your* classifier; a hosted or tuned classifier with a calibrated head
is exactly the case where a real floor exists. Inheriting one is how an application ends up mute.
