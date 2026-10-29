# Classifier service contract (needle3 pool)

Validated in Phase 0 on 2026-09-21 against `cactus-needle 3.0.4` (engine 3.0.1, weights `Cactus-Compute/needle3`, `needle3.cact`, 35 MB incl. engine).

## Findings that changed the blueprint

| Blueprint assumption (§9, §15) | Measured | Consequence |
|---|---|---|
| Embedding dimension 768 | **3072** floats from `Needle.embed()` | Schema uses `halfvec(3072)` + HNSW (pgvector caps `vector` indexes at 2000 dims). `FISHTEA_EMBED_DIM` overrides. |
| `/embed` may not be exposed | `Needle.embed(text)` exists on generation 3; ~10 ms | Same model, same pool; no sentence-transformer needed. |
| Classify budget 60 ms | 130–270 ms per `complete()` on this CPU (prefill ~800 tok/s, decode ~330 tok/s); +10 ms embed | Default `rules.classify.budgetMs` is **400**; the §11 budgets for classify are re-baselined in `packages/bench/budgets.json`. |
| Stateless calls | **The model carries state across `complete()` calls**: "something bold for a wedding" after a bridgeStyles turn became `addToCart(productId="bold")` | Every request `reset()`s first; context is folded into the request text ("Earlier: … Now: …"). |
| Tool-list size | With 18 tools a clear query misfired to an unrelated tool at 0.36 confidence; with 6 it was right at 0.94 | Persona filtering is an accuracy lever, not only a security one. |
| Switching tool subsets | `needle_init` is global per process: switching a worker to another subset costs **0.7–1.2 s** with the samples' doc-rich tool JSON (`bind` in the pool's `timings`), vs 125–310 ms for `complete` | Workers hold one subset each; the dispatcher assigns unassigned workers first, then least-recently-used, and prefers the worker already on the subset. **Size `NEEDLE_WORKERS` ≥ the number of distinct persona subsets** (core logs it at start; 3 for both samples). Each worker holds ~160 MB. |
| Workers side by side | One completion already spreads across every core. Measured on 16 cores with three workers: one classify alone 200 ms, two at once **1.6 s** each, three at once past **4 s**. Pinning each worker to its own third of the cores was worse still (single classifies past 8 s): the engine keeps a thread per core whichever cores it is given | Workers compute **one at a time** (`NEEDLE_CONCURRENCY`, 1): queued, the third of three answers in ~650 ms and four at once still mostly inside a 1 s budget. Each worker is bound to one persona's subset at warm-up (round robin), and the dispatcher always prefers the worker already on a subset, even busy, over switching another (~3 s with twenty tools). Measured on shawnstewart.me's server, a warm classify is 200–280 ms; its one switch cost 1.5 s |
| Compound requests | "quiet and polished, for the office" → two `findAccessories` calls (0.85) | Pour takes the top call and offers the rest as `next[]` (§8). |
| Off-topic | "what's the weather in Lagos" → `function_calls: []`, confidence 0.94 | Empty list is a confident "no": pour `ask`, record `answered=false`. |
| Confidence on bare verbs | "check out" → `checkout`, confidence 0.15 | Below the 0.35 floor → `form` for checkout with knowns (correct behaviour). |

**A client that hangs up is normal, not an error.** The core aborts a classify the instant its budget
expires — past the budget the pour is `ask` — so the pool routinely finishes work for a socket nobody is
holding. The handler treats `ConnectionResetError`/`BrokenPipeError` as a closed connection rather than
letting `socketserver` print a traceback, which previously made every ordinary timeout read like a crash.
And `/classify` reserves a margin inside the budget it was handed (`budget − min(50 ms, 10%)`), because
the core starts its abort timer before the request leaves: a pool given the *whole* budget is cut off
mid-reply every time, and even its "timed out" answer is thrown away.

Tool JSON accepted by `needle.Needle(tools=[...])` is plain `{name, description, parameters: <JSON Schema object>, triggers?: [..]}` — exactly what `@fishtea/spec` `deriveTools()` emits, so no Python-side function synthesis is needed.

Response fields from `complete()`: `type`, `success`, `function_calls[{name, arguments}]`, `suppressed_calls`, `reasoning`, `confidence`, `validation{ungrounded, negation}`, `prefill_tps`, `decode_tps`, `peak_ram_mb`.

## HTTP

```
POST /classify  { "text": "...", "context": ["last answer listed: 1. p_x Name; …", ...], "tools": ["findAccessories", ...], "maxTokens": 64 }
  → { "function_calls": [{ "name", "arguments" }], "reasoning", "confidence": 0..1, "embedding": [3072 floats], "ms", "worker", "active": [tool names], "timings": { "bind", "complete", "embed" }, "cached": true when the answer came from the pool's cache }
  optional "budgetMs" in the request bounds the pool-side wait; a request whose deadline passed before a worker picked it up is skipped
  503 { "error": "no tools loaded" } until /reload (or FISHTEA_SPEC at start)
POST /embed     { "texts": ["..."] }        → { "embeddings": [[...]], "ms" }
POST /reload    { "tools": [ToolSpec...], "subsets": [[tool names]...] }  → { "ok", "count", "errors", "warming" }   subsets = one per persona; workers pre-build an agent per subset in the background, one worker at a time
POST /warm      { "subsets": [[...]] } → 202; GET /healthz reports "warming" until done
GET  /healthz   → { "ok", "model": "needle3", "workers", "ready", "tools", "dim", "active" }
```

Core-side rules live in `packages/core/src/engine.ts`: hard budget via `AbortController`, floor, strict mode, dev lexical classifier.

## Environment

`NEEDLE_WORKERS` (3; ≥ distinct persona subsets), `NEEDLE_CONCURRENCY` (1; how many compute at once — see Phase 5 before raising it), `NEEDLE_MAX_NEW_TOKENS` (64; the tail), `NEEDLE_CACHE` (512 answers; 0 disables), `NEEDLE_PORT` (8081), `NEEDLE_REQUEST_TIMEOUT` (5 s), `NEEDLE_MODEL_PATH` (an explicit `.cact`, which overrides the model the pool otherwise discovers from `models/model.json` beside the spec — see `fishtea tune install`), `NEEDLE_SYSTEM`, `HF_HOME` / `HOME` decide where weights cache (`~/.cache/cactus-needle/v3/<ver>/needle3.cact`). First start downloads ~35 MB from Hugging Face; the Compose `models` volume keeps it.

## Phase 5 — the cost model, and what is not a lever

Measured 2026-10-29 on a 16-core i7-10700F, against both the pinned `cactus-needle 3.0.4` (engine 3.0.1)
and the then-latest `3.2.8` (engine 3.3.3), with the ecommerce archetype's own derived tools.

**Latency is decode length and almost nothing else.** Per query, repeated six times, the spread inside a
query is ±1 %:

| utterance | calls / arguments emitted | warm |
|---|---|---|
| `show my cart` | `viewCart`, none | **122 ms** |
| `what's trending` | `trending`, none | **127 ms** |
| `where is my order` | `orderStatus`, one | **146 ms** |
| `i love these` | `react`, two | **188 ms** |
| `compare x and y` | `compareProducts` **twice**, four | **613 ms** |

So `latency ≈ 110 ms + tokens ÷ 310`. The tail is not jitter; it is how much JSON the model decided to
emit, and the duplicate call in the last row is half that row's cost.

**Therefore the token cap is the budget's real lever.** `complete()` defaults to 512 tokens, far past any
routing decision. At 64 (`NEEDLE_MAX_NEW_TOKENS`, or `rules.classify.maxTokens`), on 3.0.4, over 24 cases:

| cap | p50 | p90 | worst | over the 400 ms budget | accuracy |
|---|---|---|---|---|---|
| 512 | 180 ms | 644 ms | 2196 ms | 4/24 | 18/24 |
| **64** | **194 ms** | **251 ms** | **458 ms** | **1/24** | **18/24** |
| 48 | 164 ms | 200 ms | 225 ms | 0/24 | 16/24 |

p90 falls 61 % and the worst case 79 % for no accuracy at all. Below 48 it collapses. Deriving the cap
from the widest tool in the subset was tried and was **worse** than the measured constant (136 → p90
476 ms), because the model does not emit every argument it could. What 64 costs is a long `compare`,
which blew the budget anyway, and a free-text `checkout` whose uncapped answer was already nonsense.

**Classification is a pure function of (subset, text, cap).** The same question asked five times,
interleaved with others, returns a byte-identical answer and confidence; so does `embed`. Hence the
pool's cache (`NEEDLE_CACHE`, 512 entries, cleared by `/reload`). Against the live pool a repeat goes
from 170–440 ms to **11 ms**, and — the actual point — spends no permit.

**Concurrency cannot be bought, and the reason is now known.** The engine starts **12 threads** at
`needle_init` and keeps them; it reads **no environment variables** (there is no `getenv` in
`libneedle.so`) and it ignores `sched_getaffinity`, so the thread count is fixed whatever cores it is
given. Threads spin rather than sleep, so oversubscription is catastrophic rather than merely slower:

| | one classify | throughput |
|---|---|---|
| alone, 16 cores | 238 ms | 4.21/s |
| two at once | ~3.0 s each | 0.65/s |
| four at once | ~11 s each | 0.33/s |
| alone, pinned to 8 cores | **9.9 s** | — |
| alone, pinned to 1 core | **92.7 s** | — |

Running two classifies side by side is **6.5× worse total throughput** than running them one after the
other. `NEEDLE_CONCURRENCY=1` is therefore not a tuning choice but a load-bearing one, and **a CPU limit
on the classifier container (`--cpus`, a Kubernetes quota) would be ruinous** — the 8-core row is what
that looks like. Capacity is **~4–5 classifies/s per host**, and the only way to scale out is more hosts.

**Tool-list size is not a latency lever.** This corrects the claim in the §9 notes above: 2 tools is
139 ms and 11 tools is 179 ms, for 5× the prompt. Persona subsetting earns its place on accuracy and on
not dangling what a visitor cannot have — not on speed.

**The depth ladder does not give a cascade.** `needle build --layers N` exports any rung from 2 to 20,
and latency tracks depth closely (L20 182 ms, L14 145, L8 78, L4 42; peak RSS 119, 133, 83, 54 MB). But
accuracy tracks it too (16/24, 14/24, 8/24, 12/24), and the shallow rung's confidence does **not**
identify which of its own answers are right: to match L20's accuracy you must escalate 20 of 24 queries,
by which point the mean is 243 ms against L20's 184 ms. Shallow-first is a dead end at stock weights.
Two rungs *can* be held side by side with no switch cost (a `weights=` agent runs in its own subprocess,
outside the global `needle_init`), so the mechanism is sound; it is the gate that fails. The remaining
path is a rung **fine-tuned on one application's tools**, which is the only thing that moves the curve
rather than sliding along it.

**Upgrading past 3.0.4 recalibrates confidence, with identical weights.** `needle3.cact` is
byte-identical between 3.0.4 and 3.2.8 (`md5 71c31b0b…`); only the engine differs. Latency is unchanged
at every percentile (p50 184/188, p90 633/646, p99 763/781 over 64 warm calls). Confidence is not:

| | median confidence on correct routes | correct routes clearing the 0.35 floor | wrong routes offered |
|---|---|---|---|
| 3.0.4 | 0.79 | 13/16 | **6** (one at **1.00**) |
| 3.1.0 | 0.09 | 4/13 | — |
| 3.2.8 | 0.07 | **4/14** | **2** |

So the 0.35 floor is a property of the engine's calibration, not a constant: on 3.2.8 the equivalent is
0.05–0.10. 3.0.4's apparent advantage is an illusion — its floor admits **6 of 6** wrong routes, so it
filters nothing, while 3.2.8 offers a third as many wrong routes and fails by declining rather than by
acting. Any move must re-derive the floor from a labelled set, and accuracy varies 15–18/24 between
process instances on the same inputs, so one run is not a measurement.

**A recalled turn must never be phrased as a question.** The recall path used to pass
`earlier this visitor asked: X → shape args`. Over eight anaphoric queries that made needle answer **X**
rather than what was said, for **all eight**, with the right answer absent from the call list entirely —
a prior request in the prompt reads as a pending request. Reworded to
`this visitor has previously been interested in <known args>`, hijacks go to **0 of 8**. By contrast
`recentContext()`'s own line (`last answer listed: 1. p_x Name; …`) earns its keep: same accuracy, but it
resolves `more like that one` to `productId=p_pearl_drop` instead of `productId="more like"` — 4/8
references resolved against 0/8 — for +160 ms, which is why it is gated on an anaphoric utterance.

**Whistle was assessed and not adopted.** `needle.Whistle` (same engine, same `.cact` container) needs
`cactus-needle ≥ 3.1.0`, so it cannot be had without the recalibration above; it transcribes a 5 s clip
in 73 ms and co-resides with the classifier in one process at 139 MB with no switch penalty, but it
shares the engine and collapses under concurrency identically (two at once: 72 ms → 670 ms each), so it
would compete for the one permit. Speech belongs on the device: `--platform wasm` emits a 0.93 MB engine
beside the 16.9 MB model, and the Web Speech API costs nothing at all.

**Where the megabytes are, and how small it goes.** The published `needle3.cact` is 35.34 MB, and taking
the archive apart (header, nameless tensor directory, aligned blobs) says what of: **engram tables
20.21 MB at CQ2 (57%)**, transformer layers 9.53 MB at CQ2, embedding 3.24 MB at CQ4, FP16 norms and
gates 1.22 MB, tokenizer 0.11 MB. Depth is the dominant lever because it takes the engram sites with it
(five at 20 layers, two at 8, one at 4), not because of the transformer. The other 1.9× is width: the
published archive is two-bit, the pip exporter writes four and refuses anything else (`WEIGHT_BITS = 4`,
`_cq_pack` raises), though the format defines 1–4 plus ternary, the runtime reads them, and
`quantize.py` already builds the 2-bit codebook. Lifting that guard locally gives archives the engine
loads and runs: **2 layers 7.00 MB / 36 MB RSS, 4 layers 8.12 / 40, 8 layers 14.44 / 58**, against 15.39
and 27.41 MB for the same rungs at four bits — the documented 8–29 MB range, reproduced, with no
measurable accuracy cost at this depth. A floor of 3.35 MB (embedding 8192×768 plus the tokenizer)
survives any rung. For the browser, `--platform wasm` emits `needle.wasm` at 0.93 MB and `needle.js` at
62 KB beside the archive. See docs/TUNING.md.

## Phase 6 — the engine in a browser

Headless Chromium, sixteen cores, the twenty-nine ecommerce cases used throughout, warmed four calls,
`needle_reset` before each completion so it matches how the pool runs stateless.

| rung | archive | native median | wasm median | ratio | cold start | heap | wasm accuracy |
|---|---|---|---|---|---|---|---|
| 20 layers | 35.34 MB | 187 ms | 888 ms | 4.7× | 6.1 s | 85 MB | 22/29 (native 23) |
| 8, 2-bit | 14.44 MB | 81 ms | 392 ms | 4.8× | 2.4 s | 35 MB | 18/29 (native 18) |
| 4, 2-bit | 8.12 MB | 47 ms | 215 ms | 4.6× | 1.2 s | 20 MB | 17/29 (native 16) |
| 2, 2-bit | 7.00 MB | 30 ms | 142 ms | 4.7× | 0.7 s | 17 MB | 15/29 (native 13) |

**The 4.7× is the thread count, and it is not a flag.** `needle.wasm` contains no pthread machinery and
never references `SharedArrayBuffer`: it is single-threaded where the native engine spins twelve. The
ratio holding to within 0.2× across a ten-fold range of model sizes is what says it is structural rather
than incidental. `needle build --platform wasm` downloads a prebuilt engine rather than compiling one —
the binary is byte-identical whether `cactus-needle` 3.0.4 or 3.2.8 fetches it (md5
`ae92433d75dbc571576000226c4c8cc2`) — so the build flags are Cactus's to change. Upstream ask, like
`WEIGHT_BITS`. Were threads enabled it would also want COOP/COEP headers on the serving origin.

**Cold start is `needle_init`, not the download.** Fetch and compile are tens of milliseconds; the
prefill of the 579-token system-and-tools prefix is 646 ms at two layers and 5977 ms at twenty. It scales
with the tool list, which makes a persona subset a startup lever in the browser and not only an accuracy
one.

**A classify on the main thread freezes the page.** Probing `requestAnimationFrame` across one second of
classifying: idle draws 74 frames with a 17 ms worst gap; the main thread draws 14 frames with a
**1000 ms** worst gap; a `Worker` draws 74 frames at 17 ms while completing the same five classifies, at
an unchanged 203 ms each. The engine belongs on a worker, always.

**The WASM engine has the newer calibration, so the pinned floor would mute it.** Median confidence on a
correct route is 0.22 at twenty layers, 0.22 at eight, 0.05 at four, 0.01 at two — the 3.2.8 profile,
not 3.0.4's 0.79. At `rules.classify.floor = 0.35` a browser build keeps 8 of 19 correct routes at full
depth and **0 of 13** at four layers. Anyone shipping the browser target must re-derive the floor or use
a derived confidence first; inheriting 0.35 ships an application that answers nothing.

Harness: `wasm-bench/{index.html,worker.js,drive.ts,block.ts,native.py}` in the session scratchpad.

## Phase 7 — what 194 labelled cases say

`fishtea eval` over `templates/*/eval/classify.jsonl`: 56 ecommerce, 45 portfolio, 46 program, 47
verification, each case naming the asking persona (which decides the tool subset), the shape it must
reach or `null` for silence, the arguments that must be extracted, and a population tag. About a third
of every set is a refusal, because a set of positives cannot separate the populations a floor exists to
separate.

| | 3.0.4 (pinned) | 3.2.8 |
|---|---|---|
| overall | 48 / 47 / 54 / 49 % | 46 / 56 / 61 / 51 % |
| cases that should route | 61 / 56 / 59 / 44 % | 37 / 50 / 53 / 41 % |
| cases that should stay silent | 13 / 23 / 42 / 62 % | **73 / 69 / 83 / 77 %** |
| answers offered, and wrong | 134, **59 wrong** | 83, **20 wrong** |

**3.0.4 substitutes rather than declines.** `out-of-subset` is 0 on every archetype: given a stranger's
five tools, "check out" returns `trending` at 0.57 with the reasoning "User wants to check out. Use
trending to see what's popular." The subset was correctly restricted — the pool received five tool names
and the model picked one of them anyway. 3.2.8 declines instead, which is the failure mode the budget
rule already asks for, and is a stronger argument for the upgrade than the calibration difference.

**No gate separates right from wrong routes on either engine.** Over all 194 cases:

| gate | 3.0.4 keeps / admits | 3.2.8 keeps / admits | model-only wins kept |
|---|---|---|---|
| `head ≥ 0.35` | 66/75 · 45/59 | 17/63 · 0/20 | 11/12 · 2/7 |
| `head ≥ 0.20` | 70/75 · 53/59 | 23/63 · 9/20 | 11/12 · 4/7 |
| required arguments present | 71/75 · 58/59 | 59/63 · 20/20 | 12/12 · 7/7 |
| arguments present **and** lexical agrees | 59/75 · 2/59 | 52/63 · 2/20 | **0/12 · 0/7** |
| arguments present, lexical not contradicting | 67/75 · 51/59 | 55/63 · 18/20 | 8/12 · 3/7 |

The last column is the finding. The only derived gate that filters discards every answer the model got
and the lexical router missed — a gate requiring the dictionary's agreement is the dictionary. Its
aggregate score flatters it because most correct answers are ones the dictionary also finds. Everything
else admits 17–58 of the wrong routes, so the wrong answers are indistinguishable from the right ones on
every signal available without a trained head.

**Therefore accuracy blocks confidence, not the reverse.** Phase 5 and docs/TUNING.md recorded tuning as
blocked by the missing confidence head; at a 24–44% error rate on offered answers, no threshold helps,
and tuning is the only measured lever on accuracy. Tune first, re-run `fishtea eval`, then ask what gates
it. The labelled set is the held-out twin of the derived corpus and is never fed to `fishtea tune data`.

## Phase 8 — the engine moved, and the floor went to 0

`requirements.txt` now pins **cactus-needle 3.2.8**. Measured on a quiet machine over the four labelled
sets, it is better on every one:

| | 3.0.4 (was pinned) | 3.2.8 (now) |
|---|---|---|
| ecommerce | 25–26/56 | **29/56** |
| portfolio | 20/45 | **26/45** |
| program | 23–24/46 | **26/46** |
| verification | 23–25/47 | **26/47** |
| cases where silence is correct | 13–62% | **69–92%** |

Latency is unchanged (medians 215–234 ms against 217–249 ms). The gain is mostly refusals: 3.0.4
substitutes a tool it was offered when it cannot serve the request — "check out" with only a stranger's
five tools came back as `trending` at 0.57, reasoning "User wants to check out. Use trending to see
what's popular" — and 3.2.8 declines instead, which is the failure mode the budget rule already asks
for.

**`rules.classify.floor` ships at 0.** The two populations overlap almost completely on this engine:
wrong routes land at 0.085, 0.125 and 0.138, while correct ones run 0.002 → 0.456 with ten of eighteen
*below* the wrong ones. No threshold separates them. Any non-zero floor discards correct answers without
excluding wrong ones, and the sweep loses a third to a half of correct routes at the first non-zero step.
The engine default moved from 0.35 to 0 with the templates, so an application that omits the field is not
muted. Protection comes from the gate, `missingRequired`, `confirm-write` and the model's own refusals —
all of which were doing the work already. A floor of 0 additionally admits a locally tuned rung, whose
head `needle build --lora` drops.

Raise it only from a measurement of your own classifier: `fishtea eval` prints the sweep.
