#!/usr/bin/env python3
"""Drive a TUI inside a pty so keyboard behaviour can be tested.

  pty-drive.py script.json -- cmd args...
  script: [{"wait": ms} | {"keys": "...", "after": ms} | {"snap": "name"}]
  prints JSON: {"snaps": {name: screen}, "final": screen}

Ink repaints the whole frame, so the last frame is the tail of the stream: strip ANSI, then take
from the last top-border line onward.
"""
import os, pty, sys, json, time, select, fcntl, termios, struct, re

argv = sys.argv[1:]
script = json.load(open(argv[0]))
cmd = argv[2:] if len(argv) > 1 and argv[1] == "--" else argv[1:]
debug = bool(os.environ.get("PTY_DEBUG"))

pid, fd = pty.fork()
if pid == 0:
    os.environ["TERM"] = "xterm-256color"
    os.environ["FORCE_COLOR"] = "0"
    os.environ.pop("CI", None)
    os.execvp(cmd[0], cmd)
    os._exit(1)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", int(os.environ.get("PTY_ROWS", 44)), int(os.environ.get("PTY_COLS", 112)), 0, 0))

buf = b""

def pump(ms):
    global buf
    end = time.time() + ms / 1000.0
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.02)
        if r:
            try:
                buf += os.read(fd, 1 << 16)
            except OSError:
                return

def screen():
    text = buf.decode("utf8", "replace")
    text = re.sub(r"\x1b\][^\x07\x1b]*(\x07|\x1b\\)", "", text)
    text = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", text)
    for junk in ("\x1b(B", "\x1b=", "\x1b>", "\x0f", "\r"):
        text = text.replace(junk, "")
    lines = [l.rstrip() for l in text.split("\n")]
    # a frame starts at the header box: the top border just above the "fishtea" title line
    heads = [i for i, l in enumerate(lines) if " fishtea" in l and i > 0 and lines[i - 1].lstrip().startswith("╭─")]
    starts = [i for i, l in enumerate(lines) if l.lstrip().startswith("╭─")]
    if heads:
        lines = lines[heads[-1] - 1:]
    elif starts:
        lines = lines[starts[-1]:]
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines[:44])

snaps = {}
for step in script:
    if "wait" in step:
        pump(step["wait"])
    elif "keys" in step:
        for ch in step["keys"].encode():
            os.write(fd, bytes([ch]))
            time.sleep(0.02)
        pump(step.get("after", 400))
    elif "snap" in step:
        snaps[step["snap"]] = screen()
        if debug:
            print("[snap %s] buf=%d screen=%d" % (step["snap"], len(buf), len(snaps[step["snap"]])), file=sys.stderr)
pump(200)
result = {"snaps": snaps, "final": screen()}
try:
    os.close(fd)
except OSError:
    pass
print(json.dumps(result))
