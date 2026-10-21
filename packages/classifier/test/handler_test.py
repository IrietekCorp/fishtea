"""
The pool's HTTP handler, checked where it actually broke.

A classify that outlives its budget is normal: the core aborts the fetch the moment the budget expires,
and past that budget the pour is `ask`. The pool then finishes its work and writes a reply into a socket
nobody is holding, and `socketserver` printed a full traceback for it — the same noise for "working as
designed" as for a real fault, in the logs of every application under load.

These drive the handler directly with a socket that refuses writes, because provoking a genuine RST from
outside is timing-dependent and the point is the handler's behaviour, not the kernel's.
"""
import io
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

with mock.patch.dict("sys.modules", {"needle": mock.MagicMock()}):
    import needle_service


class Dead(io.RawIOBase):
    """A socket the peer has already reset."""

    def write(self, _b):
        raise ConnectionResetError(104, "Connection reset by peer")

    def writable(self):
        return True


def handler(wfile):
    h = needle_service.Handler.__new__(needle_service.Handler)
    h.wfile = wfile
    h.rfile = io.BytesIO(b"")
    h.request_version = "HTTP/1.1"
    h.requestline = "POST /classify HTTP/1.1"
    h.command = "POST"
    h.path = "/classify"
    h.close_connection = False
    h.headers = {}
    h.log_request = lambda *a, **k: None
    h.log_message = lambda *a, **k: None
    return h


class TestHangUp(unittest.TestCase):
    def test_a_reset_while_replying_is_not_an_exception(self):
        h = handler(Dead())
        h._json(200, {"function_calls": []})          # this is the line in the reported traceback
        self.assertTrue(h.close_connection)

    def test_a_live_socket_still_gets_the_whole_reply(self):
        buf = io.BytesIO()
        h = handler(buf)
        h._json(200, {"confidence": 0.9})
        raw = buf.getvalue()
        self.assertIn(b"200", raw)
        self.assertIn(b"application/json", raw)
        self.assertEqual(json.loads(raw.split(b"\r\n\r\n", 1)[1]), {"confidence": 0.9})


class TestBudgetMargin(unittest.TestCase):
    """The pool must answer *inside* the caller's budget, not at it."""

    def margin(self, asked_ms):
        asked = asked_ms / 1000
        return max(0.2, asked - min(0.05, asked * 0.1))

    def test_the_pool_reserves_time_to_reply(self):
        # The core starts its abort timer before the request leaves, so a pool given the whole budget is
        # cut off mid-reply every time and even its "timed out" answer is thrown away.
        for asked in (400, 1000, 8000):
            self.assertLess(self.margin(asked), asked / 1000, f"{asked}ms leaves no room to reply")

    def test_a_tiny_budget_still_gets_a_usable_floor(self):
        self.assertEqual(self.margin(50), 0.2)


def pool(n, concurrency=1):
    """A dispatcher with no worker processes: the test plays the workers, through its queues."""
    import queue
    import threading
    p = needle_service.Pool.__new__(needle_service.Pool)
    p.n, p.tools, p.dim, p.ready, p.warming = n, [], 0, n, False
    p.results, p.queues, p.procs = queue.Queue(), [queue.Queue() for _ in range(n)], []
    p.active, p.inflight, p.last_used = [None] * n, [0] * n, [0.0] * n
    p.pending, p.lock = {}, threading.Lock()
    p.running, p.permits = threading.BoundedSemaphore(concurrency), set()
    threading.Thread(target=p._collect, daemon=True).start()
    return p


class TestOneAtATime(unittest.TestCase):
    """One completion uses every core, so workers side by side only slow each other: measured, two at once
    took 1.6 s each where one alone took 200 ms. The dispatcher lets one compute at a time."""

    def test_a_second_request_waits_for_the_first_to_finish(self):
        import threading
        p = pool(2)
        first = {}
        t = threading.Thread(target=lambda: first.update(p.request("classify", {"text": "a", "tools": ["x"]}, timeout=2)))
        t.start()
        req_id, _, _ = p.queues[0].get(timeout=1)    # worker 0 has the first; nothing has answered yet
        self.assertEqual(p.request("classify", {"text": "b", "tools": ["y"]}, timeout=0.2), {"error": "timeout", "queued": True})
        self.assertTrue(all(q.empty() for q in p.queues), "the second was sent to a worker while the first computed")
        p.results.put((req_id, {"ok": True}))
        t.join(2)
        self.assertEqual(first, {"ok": True})

    def test_an_abandoned_classify_keeps_its_turn_until_the_worker_answers(self):
        p = pool(2)
        self.assertEqual(p.request("classify", {"text": "a", "tools": ["x"]}, timeout=0.1), {"error": "timeout", "worker": 0})
        req_id, _, _ = p.queues[0].get(timeout=1)
        # the caller gave up, but worker 0 is still computing it: nobody else may start
        self.assertEqual(p.request("classify", {"text": "b", "tools": ["x"]}, timeout=0.1).get("queued"), True)
        p.results.put((req_id, {"ok": True}))       # it finishes; its turn comes back
        import time
        time.sleep(0.05)
        self.assertTrue(p.running.acquire(timeout=0.1))


class TestBinding(unittest.TestCase):
    def test_a_worker_already_on_the_subset_is_preferred_even_busy(self):
        # an idle worker on another subset would pay a switch (~3 s); waiting for the bound one costs a classify
        p = pool(3)
        p.active = [("a",), ("b",), ("c",)]
        p.inflight = [0, 1, 0]
        self.assertEqual(p._pick(("b",)), 1)

    def test_warming_binds_each_worker_to_a_subset_in_turn(self):
        p = pool(3, concurrency=3)
        sent = []
        def send_to(i, op, payload, timeout):
            sent.append((i, payload["subsets"]))
            return {"ok": True}
        p._send_to = send_to
        p.warm([["b", "a"], ["c"]])
        self.assertEqual(sent, [(0, [["b", "a"]]), (1, [["c"]]), (2, [["b", "a"]])])
        self.assertEqual(p.active, [("a", "b"), ("c",), ("a", "b")])
        self.assertFalse(p.warming)

if __name__ == "__main__":
    unittest.main(verbosity=2)
