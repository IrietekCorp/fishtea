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

**Train on a schedule, elsewhere.** `needle finetune` is JAX, and on sixteen CPU cores here it is roughly
**two minutes a step** — a thousand-example run at ten epochs is the better part of a day. It wants a GPU
box or Cactus's hosted service, on a cadence (nightly, weekly) rather than in `fishtea up`.

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

A first cut of this scores competitively with the model's own head on the stock weights, where there is
a head to compare against — over 29 ecommerce cases it admits 0 of 3 wrong routes while keeping 12 of 23
correct ones, where the head needs a 0.8 floor to keep 13. That is a tie on a sample far too small to
set a threshold from, which is the next piece of work: **a labelled set per archetype**, which is the
same artefact that re-derives `rules.classify.floor` for a newer engine.


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

Two things stand between here and there, and both are the same piece of work already described above: a
shallow rung has to be *tuned* to be worth running (untuned, 4 layers is 11/24), and a tuned rung has no
confidence head, so FishTea has to supply the gate itself. Neither is a browser problem. The WASM build's
own speed is unmeasured.

## Why the floor is not a constant

Worth knowing before changing anything here. `needle3.cact` is byte-identical between `cactus-needle`
3.0.4 and 3.2.8 — only the engine differs — and latency is identical at every percentile. Confidence is
not:

| | median confidence on correct routes | clearing the 0.35 floor | wrong routes offered |
|---|---|---|---|
| 3.0.4 (pinned) | 0.79 | 13/16 | **6**, one at **1.00** |
| 3.2.8 | 0.07 | 4/14 | **2** |

So `rules.classify.floor` is a property of an engine's calibration, not a universal number, and 3.0.4's
apparent advantage is an illusion: its floor admits six wrong routes out of six, so it filters nothing.
Any move — to a newer engine, or to a tuned model with a derived confidence — has to re-derive the floor
from a labelled set rather than inherit 0.35.
