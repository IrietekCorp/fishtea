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


if __name__ == "__main__":
    unittest.main(verbosity=2)
