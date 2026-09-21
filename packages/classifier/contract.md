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
| Compound requests | "quiet and polished, for the office" → two `findAccessories` calls (0.85) | Pour takes the top call and offers the rest as `next[]` (§8). |
| Off-topic | "what's the weather in Lagos" → `function_calls: []`, confidence 0.94 | Empty list is a confident "no": pour `ask`, record `answered=false`. |
| Confidence on bare verbs | "check out" → `checkout`, confidence 0.15 | Below the 0.35 floor → `form` for checkout with knowns (correct behaviour). |

Tool JSON accepted by `needle.Needle(tools=[...])` is plain `{name, description, parameters: <JSON Schema object>, triggers?: [..]}` — exactly what `@fishtea/spec` `deriveTools()` emits, so no Python-side function synthesis is needed.

Response fields from `complete()`: `type`, `success`, `function_calls[{name, arguments}]`, `suppressed_calls`, `reasoning`, `confidence`, `validation{ungrounded, negation}`, `prefill_tps`, `decode_tps`, `peak_ram_mb`.

## HTTP

```
POST /classify  { "text": "...", "context": ["visitor: … → findAccessories (8 results)", ...], "tools": ["findAccessories", ...] }
  → { "function_calls": [{ "name", "arguments" }], "reasoning", "confidence": 0..1, "embedding": [3072 floats], "ms", "worker", "active": [tool names], "timings": { "bind", "complete", "embed" } }
  optional "budgetMs" in the request bounds the pool-side wait; a request whose deadline passed before a worker picked it up is skipped
  503 { "error": "no tools loaded" } until /reload (or FISHTEA_SPEC at start)
POST /embed     { "texts": ["..."] }        → { "embeddings": [[...]], "ms" }
POST /reload    { "tools": [ToolSpec...], "subsets": [[tool names]...] }  → { "ok", "count", "errors", "warming" }   subsets = one per persona; workers pre-build an agent per subset in the background, one worker at a time
POST /warm      { "subsets": [[...]] } → 202; GET /healthz reports "warming" until done
GET  /healthz   → { "ok", "model": "needle3", "workers", "ready", "tools", "dim", "active" }
```

Core-side rules live in `packages/core/src/engine.ts`: hard budget via `AbortController`, floor, strict mode, dev lexical classifier.

## Environment

`NEEDLE_WORKERS` (3; ≥ distinct persona subsets), `NEEDLE_PORT` (8081), `NEEDLE_REQUEST_TIMEOUT` (5 s), `NEEDLE_MODEL_PATH` (offline `.cact`), `NEEDLE_SYSTEM`, `HF_HOME` / `HOME` decide where weights cache (`~/.cache/cactus-needle/v3/<ver>/needle3.cact`). First start downloads ~35 MB from Hugging Face; the Compose `models` volume keeps it.
