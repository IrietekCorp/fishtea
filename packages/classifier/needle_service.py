#!/usr/bin/env python3
"""
Fishtea classifier service: a pool of needle3 workers behind one HTTP port (BLUEPRINT §9).

  POST /classify  {text, context: [..], tools: [names]}  → {function_calls, reasoning, confidence, embedding, ms, worker}
  POST /embed     {texts: [..]}                           → {embeddings: [[..]]}
  POST /reload    {tools: [ToolSpec..]}                   → {ok, count}
  GET  /healthz                                           → {ok, model, workers, tools, dim}

Design notes (measured in Phase 0, see contract.md):
  * needle keeps conversation state between complete() calls → every request resets the agent first and
    context is folded into the request text, never carried implicitly.
  * needle_init is global per process and switching tool subsets costs ~3 s with twenty doc-rich tools, so
    each worker is bound to one persona's subset and the dispatcher routes requests to the worker on it.
  * one completion already uses every core, so workers compute one at a time (NEEDLE_CONCURRENCY): side
    by side they only slow each other down.
  * embeddings come from the same model (3072 floats).
Stdlib only besides cactus-needle. Python ≥ 3.9.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import time
import uuid
import multiprocessing as mp
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("NEEDLE_PORT", "8081"))
WORKERS = max(1, int(os.environ.get("NEEDLE_WORKERS", "2")))
TIMEOUT = float(os.environ.get("NEEDLE_REQUEST_TIMEOUT", "5"))
# How many workers may compute at once. The engine already spreads one completion across every core, so
# workers side by side only fight: measured on 16 cores, a classify alone took 200 ms, two at once 1.6 s
# each, and three at once ran past 4 s. One at a time, the third of three waits ~600 ms instead. The
# workers still matter, as somewhere to keep each persona's subset bound, so nobody pays a switch.
CONCURRENCY = max(1, int(os.environ.get("NEEDLE_CONCURRENCY", "1")))
# A classify costs a fixed prefill plus one token at a time, and nothing else: measured per query on 16
# cores, "what's trending" (no arguments) is 127 ms ± 1, "where is my order" (one) 146, "i love these"
# (two) 188, and "compare x and y" — which emits the call *twice* — 613. Latency is decode length, so the
# cap is the tail. The library's default is 512 tokens, far past anything a routing decision needs: at 64
# the median is unchanged (189 vs 192 ms) while p90 falls 625 → 316 and the worst case 2163 → 413, with
# the same accuracy over a 24-case set. Deriving it from the widest tool in the subset was tried and was
# worse than the measured constant (136 → p90 476), because the model does not emit every argument it
# could. What a cap costs is a long compare, which blew the budget anyway, and a free-text checkout whose
# uncapped answer was already nonsense. rules.classify.maxTokens overrides per request.
MAX_NEW_TOKENS = max(16, int(os.environ.get("NEEDLE_MAX_NEW_TOKENS", "64")))
# Classification is a pure function of (subset, text, cap): verified by asking the same question five
# times, interleaved with others, and getting a byte-identical answer and confidence every time. So a
# repeat need not take a turn on the one permit — and in a conversation driven by chips and stock phrases
# ("what's trending", "show my cart") repeats are the common case, at 127 ms each.
CACHE_SIZE = max(0, int(os.environ.get("NEEDLE_CACHE", "512")))
SYSTEM = os.environ.get("NEEDLE_SYSTEM", "You route what a visitor says to one of the store's tools. Prior turns may be listed; the last line is what the visitor said now.")
MODEL_PATH = os.environ.get("NEEDLE_MODEL_PATH")  # offline copy of needle3.cact (optional)


# ── worker process ──────────────────────────────────────────────────────────

def _fold(text: str, context: list[str]) -> str:
    if not context:
        return text
    lines = [f"- {c}" for c in context[-8:]]
    return "Earlier:\n" + "\n".join(lines) + "\nNow: " + text


def worker_main(idx: int, requests: mp.Queue, results: mp.Queue, tools_json: str):
    os.environ.setdefault("NEEDLE_TELEMETRY", "0")
    import needle  # noqa: WPS433
    tools = json.loads(tools_json)
    by_name = {t["name"]: t for t in tools}
    agents: dict[tuple, "needle.Needle"] = {}
    active_key: tuple | None = None

    def agent_for(names: list[str] | None):
        nonlocal active_key
        key = tuple(sorted(names)) if names is not None else tuple(sorted(by_name))
        a = agents.get(key)
        if a is None:
            subset = [by_name[n] for n in key if n in by_name]
            kwargs = {"weights": MODEL_PATH} if MODEL_PATH else {}
            a = needle.Needle(tools=subset, system=SYSTEM, **kwargs)
            agents[key] = a
        active_key = key
        return a

    # warm up: load weights and the full toolset
    try:
        agent_for(None).complete("hello")
        dim = len(agent_for(None).embed("hello"))
    except Exception as exc:  # pragma: no cover
        results.put((f"init-{idx}", {"error": f"worker {idx} failed to load: {exc}"}))
        return
    results.put((f"init-{idx}", {"ok": True, "dim": dim}))

    while True:
        item = requests.get()
        if item is None:
            break
        req_id, op, payload = item
        t0 = time.time()
        deadline = payload.get("deadline")
        if deadline and t0 > deadline:
            results.put((req_id, {"error": "stale", "skipped": True}))
            continue
        try:
            if op == "warm":
                for names in payload.get("subsets") or []:
                    agent_for(names).complete("hello")
                out = {"ok": True, "subsets": len(payload.get("subsets") or []), "ms": round((time.time() - t0) * 1000, 1)}
            elif op == "classify":
                t_a = time.time()
                a = agent_for(payload.get("tools"))
                a.reset()
                t_b = time.time()
                text = _fold(payload["text"], payload.get("context") or [])
                r = a.complete(text, max_new_tokens=int(payload.get("maxTokens") or MAX_NEW_TOKENS))
                t_c = time.time()
                emb = a.embed(payload["text"]) if payload.get("embed", True) else None
                out = {
                    "timings": {"bind": round((t_b - t_a) * 1000, 1), "complete": round((t_c - t_b) * 1000, 1), "embed": round((time.time() - t_c) * 1000, 1)},
                    "function_calls": [{"name": c.get("name"), "arguments": c.get("arguments") or {}} for c in (r.get("function_calls") or []) if c.get("name") in by_name],
                    "reasoning": r.get("reasoning"),
                    "confidence": r.get("confidence"),
                    "embedding": emb,
                    "ms": round((time.time() - t0) * 1000, 1),
                    "worker": idx,
                    "active": list(active_key or ()),
                }
            elif op == "embed":
                a = agent_for(None)
                out = {"embeddings": [a.embed(t) for t in payload["texts"]], "ms": round((time.time() - t0) * 1000, 1)}
            elif op == "reload":
                tools = payload["tools"]
                by_name = {t["name"]: t for t in tools}
                agents.clear()
                agent_for(None).complete("hello")
                out = {"ok": True, "count": len(by_name)}
            else:
                out = {"error": f"unknown op {op}"}
        except Exception as exc:
            out = {"error": str(exc)}
        results.put((req_id, out))


# ── dispatcher ──────────────────────────────────────────────────────────────

class Pool:
    def __init__(self, n: int, tools: list[dict]):
        self.n = n
        self.tools = tools
        self.results: mp.Queue = mp.Queue()
        self.queues: list[mp.Queue] = []
        self.procs: list[mp.Process] = []
        self.active: list[tuple | None] = [None] * n
        self.inflight: list[int] = [0] * n
        self.last_used: list[float] = [0.0] * n
        self.pending: dict[str, tuple[threading.Event, dict]] = {}
        self.lock = threading.Lock()
        # a permit per op computing; it is given back when the worker answers, not when the caller stops
        # waiting, so a classify the caller abandoned still counts until it is really done
        self.running = threading.BoundedSemaphore(CONCURRENCY)
        self.permits: set[str] = set()
        self.dim = 0
        self.ready = 0
        self.warming = False
        # (subset, text, context, cap) → the answer. Classification is deterministic, so a hit is the
        # answer the engine would have computed; the point is that it does not take a turn on the permit.
        self.cache: "OrderedDict[tuple, dict]" = OrderedDict()
        self.hits = 0
        self.misses = 0
        for i in range(n):
            q: mp.Queue = mp.Queue()
            p = mp.Process(target=worker_main, args=(i, q, self.results, json.dumps(tools)), daemon=True)
            p.start()
            self.queues.append(q)
            self.procs.append(p)
        threading.Thread(target=self._collect, daemon=True).start()

    def _collect(self):
        while True:
            req_id, out = self.results.get()
            if req_id.startswith("init-"):
                if out.get("ok"):
                    self.ready += 1
                    self.dim = out.get("dim", self.dim)
                else:
                    print(out.get("error"), file=sys.stderr)
                continue
            with self.lock:
                slot = self.pending.pop(req_id, None)
                held = req_id in self.permits
                self.permits.discard(req_id)
            if held:
                self.running.release()
            if slot:
                slot[1].update(out)
                slot[0].set()

    def _pick(self, key: tuple | None) -> int:
        with self.lock:
            # affinity first: switching a worker to another tool subset costs a needle_init (~300 ms), so wait
            # briefly for the worker that already holds this subset unless it is clearly backed up
            # A worker holding another subset pays a needle_init (0.7–1.2 s with rich tool docs) to switch, so:
            # idle worker already on this subset → idle worker never assigned → least-recently-used idle worker
            # → busy worker on this subset (short wait) → least loaded. Size NEEDLE_WORKERS ≥ distinct persona subsets.
            # Workers compute one at a time (CONCURRENCY), so an idle worker on another subset is no faster
            # than the busy one already bound: the bound one costs a short wait, the other a switch (~3 s
            # with this many tools). So: a worker on this subset → one never assigned → least recently used.
            same = [i for i in range(self.n) if self.active[i] == key]
            idle_free = [i for i in range(self.n) if self.active[i] is None and self.inflight[i] == 0]
            idle = [i for i in range(self.n) if self.inflight[i] == 0]
            if same:
                i = min(same, key=lambda j: (self.inflight[j], self.last_used[j]))
            elif idle_free:
                i = idle_free[0]
            elif idle:
                i = min(idle, key=lambda j: self.last_used[j])
            else:
                i = min(range(self.n), key=lambda j: self.inflight[j])
            self.active[i] = key
            self.inflight[i] += 1
            self.last_used[i] = time.time()
            return i

    def _admit(self, req_id: str, timeout: float) -> bool:
        """Wait for a permit to compute; the answer to whether one came in time."""
        if not self.running.acquire(timeout=max(0.0, timeout)):
            return False
        with self.lock:
            self.permits.add(req_id)
        return True

    def _cache_key(self, payload: dict, key: tuple | None) -> tuple:
        return (key, payload["text"], tuple(payload.get("context") or []),
                int(payload.get("maxTokens") or MAX_NEW_TOKENS), bool(payload.get("embed", True)))

    def request(self, op: str, payload: dict, timeout: float = TIMEOUT) -> dict:
        key = tuple(sorted(payload.get("tools") or [])) if op == "classify" else None
        start = time.time()
        if op == "classify" and CACHE_SIZE:
            ck = self._cache_key(payload, key)
            with self.lock:
                hit = self.cache.get(ck)
                if hit is not None:
                    self.cache.move_to_end(ck)
                    self.hits += 1
            if hit is not None:
                # A hit must not look like a 0 ms classify in the operator's timings, so say what it was.
                return dict(hit, ms=round((time.time() - start) * 1000, 1), cached=True)
            with self.lock:
                self.misses += 1
        if op == "classify":
            payload = dict(payload, deadline=start + timeout)
        req_id = uuid.uuid4().hex
        if not self._admit(req_id, timeout):
            return {"error": "timeout", "queued": True}
        i = self._pick(key)
        ev, out = threading.Event(), {}
        with self.lock:
            self.pending[req_id] = (ev, out)
        self.queues[i].put((req_id, op, payload))
        try:
            if not ev.wait(max(0.0, timeout - (time.time() - start))):
                with self.lock:
                    self.pending.pop(req_id, None)
                return {"error": "timeout", "worker": i}
            if op == "classify" and CACHE_SIZE and not out.get("error") and not out.get("skipped"):
                with self.lock:
                    self.cache[self._cache_key(payload, key)] = out
                    while len(self.cache) > CACHE_SIZE:
                        self.cache.popitem(last=False)
            return out
        finally:
            with self.lock:
                self.inflight[i] -= 1

    def _send_to(self, i: int, op: str, payload: dict, timeout: float) -> dict:
        """Send one op to one specific worker and wait (reload/warm must reach every worker, not the least loaded)."""
        req_id = uuid.uuid4().hex
        if not self._admit(req_id, timeout):
            return {"error": f"worker {i} {op} never got a turn"}
        ev, out = threading.Event(), {}
        with self.lock:
            self.pending[req_id] = (ev, out)
            self.inflight[i] += 1
        self.queues[i].put((req_id, op, payload))
        try:
            if not ev.wait(timeout):
                out["error"] = f"worker {i} {op} timeout"
            return out
        finally:
            with self.lock:
                self.inflight[i] -= 1

    def _all(self, op: str, payload: dict, timeout: float) -> list[dict]:
        # sequential on purpose: the engine uses every core for a needle_init, and three inits in parallel
        # took 48 s where three in a row take ~12 s
        return [self._send_to(i, op, payload, timeout) for i in range(self.n)]

    def reload(self, tools: list[dict], subsets: list[list[str]] | None = None) -> dict:
        self.tools = tools
        outs = self._all("reload", {"tools": tools}, 300)
        with self.lock:
            self.active = [None] * self.n
            self.cache.clear()      # the answers were about a different tool list
        if subsets:
            threading.Thread(target=self.warm, args=(subsets,), daemon=True).start()
        errs = [o for o in outs if o.get("error")]
        return {"ok": not errs, "count": len(tools), "errors": errs, "warming": bool(subsets)}

    def warm(self, subsets: list[list[str]]) -> dict:
        """Bind each worker to a persona's subset, round robin, so every subset has a worker already on it
        and no visitor's first question pays the switch. A worker can hold only one bound at a time, so
        binding it to more would only leave it on the last. Each bind takes its turn like a classify, so
        live requests interleave with warming rather than fighting it. Runs in the background after /reload."""
        self.warming = True
        outs = []
        try:
            if subsets:
                for i in range(self.n):
                    names = subsets[i % len(subsets)]
                    out = self._send_to(i, "warm", {"subsets": [names]}, 300)
                    if not out.get("error"):
                        with self.lock:
                            self.active[i] = tuple(sorted(names))
                    outs.append(out)
        finally:
            self.warming = False
        return {"workers": len(outs), "subsets": len(subsets), "errors": [o for o in outs if o.get("error")]}

    def healthy(self) -> bool:
        return self.ready >= 1 and all(p.is_alive() for p in self.procs)


# ── tools from a spec (standalone use; core normally POSTs /reload) ─────────

def _json_type(t: str) -> dict:
    t = t.strip()
    default = None
    if "=" in t:
        t, d = t.split("=", 1)
        default = d
    optional = t.endswith("?")
    t = t.rstrip("?")
    array = t.endswith("[]")
    t = t[:-2] if array else t
    if t.startswith("enum:"):
        inner = {"type": "string", "enum": t[5:].split("|")}
    else:
        inner = {"int": {"type": "integer"}, "number": {"type": "number"}, "money": {"type": "number"}, "boolean": {"type": "boolean"}, "json": {}}.get(t, {"type": "string"})
    if default is not None:
        inner = dict(inner, default=default)
    return ({"type": "array", "items": inner} if array else inner), (optional or default is not None)


def tools_from_spec(path: str) -> list[dict]:
    spec = json.load(open(path))
    out = []
    for name, shape in spec.get("shapes", {}).items():
        if name in ("version", "doc") or not isinstance(shape, dict):
            continue
        if shape.get("classify") is False:   # a composite part or chip-only shape: never a tool (deriveTools)
            continue
        props, required = {}, []
        for k, t in (shape.get("input") or {}).items():
            if isinstance(t, dict) and "type" not in t:
                props[k] = {"type": "object"}
                required.append(k)
                continue
            ts = t if isinstance(t, str) else t.get("type", "string")
            schema, opt = _json_type(ts)
            if isinstance(t, dict) and t.get("doc"):
                schema["description"] = t["doc"]
            props[k] = schema
            if not opt and not (isinstance(t, dict) and t.get("optional")):
                required.append(k)
        tool = {"name": name, "description": shape.get("asks", name), "parameters": {"type": "object", "properties": props, **({"required": required} if required else {})}}
        if shape.get("triggers"):
            tool["triggers"] = shape["triggers"]
        out.append(tool)
    return out


# ── HTTP ────────────────────────────────────────────────────────────────────

class Handler(BaseHTTPRequestHandler):
    pool: Pool

    def log_message(self, fmt, *args):  # quiet
        if os.environ.get("NEEDLE_LOG"):
            super().log_message(fmt, *args)

    def _json(self, code: int, body: dict):
        data = json.dumps(body).encode()
        try:
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (ConnectionResetError, BrokenPipeError):
            # The caller gave up before we answered, which is normal rather than exceptional: the core
            # aborts a classify the moment its budget expires, and past that budget the pour is `ask`.
            # Without this, every ordinary timeout printed a socketserver traceback that read like a
            # crash — the same noise for "working as designed" as for a real fault.
            self.close_connection = True

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionResetError, BrokenPipeError):
            self.close_connection = True

    def do_GET(self):
        if self.path.startswith("/healthz"):
            p = self.pool
            return self._json(200 if p.healthy() else 503, {"ok": p.healthy(), "model": "needle3", "workers": p.n, "ready": p.ready, "tools": len(p.tools), "dim": p.dim, "warming": p.warming, "active": [list(a) if a else None for a in p.active], "maxNewTokens": MAX_NEW_TOKENS, "cache": {"size": len(p.cache), "limit": CACHE_SIZE, "hits": p.hits, "misses": p.misses}})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            return self._json(400, {"error": "bad json"})
        p = self.pool
        if self.path == "/classify":
            if not body.get("text"):
                return self._json(400, {"error": "text required"})
            if not p.tools:
                return self._json(503, {"error": "no tools loaded; POST /reload"})
            # Answer *inside* the caller's budget, not at it. The core starts its abort timer before the
            # request leaves, so a pool given the whole budget is always cut off mid-reply and its answer
            # — including a useful "timed out" — is thrown away. Reserving a margin means a slow classify
            # comes back as a result the core can log rather than as a dropped connection.
            asked = float(body.get("budgetMs") or 0) / 1000 or TIMEOUT
            budget = max(0.2, asked - min(0.05, asked * 0.1))
            out = p.request("classify", {"text": str(body["text"])[:1000], "context": [str(c)[:200] for c in (body.get("context") or [])][:8], "tools": body.get("tools"), "embed": body.get("embed", True), "maxTokens": body.get("maxTokens")}, timeout=budget)
            return self._json(503 if out.get("error") else 200, out)
        if self.path == "/embed":
            out = p.request("embed", {"texts": [str(t)[:1000] for t in (body.get("texts") or [])][:32]})
            return self._json(503 if out.get("error") else 200, out)
        if self.path == "/reload":
            tools = body.get("tools")
            if not isinstance(tools, list):
                return self._json(400, {"error": "tools[] required"})
            return self._json(200, p.reload(tools, body.get("subsets")))
        if self.path == "/warm":
            threading.Thread(target=p.warm, args=(body.get("subsets") or [],), daemon=True).start()
            return self._json(202, {"ok": True, "warming": True})
        self._json(404, {"error": "not found"})


def main():
    mp.set_start_method("spawn", force=True)
    tools: list[dict] = []
    spec = os.environ.get("FISHTEA_SPEC") or (sys.argv[1] if len(sys.argv) > 1 else None)
    if spec and os.path.exists(spec):
        tools = tools_from_spec(spec)
        print(f"loaded {len(tools)} tools from {spec}", file=sys.stderr)
    pool = Pool(WORKERS, tools)
    Handler.pool = pool
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"needle3 pool: {WORKERS} workers on :{PORT}", file=sys.stderr)
    srv.serve_forever()


if __name__ == "__main__":
    main()
