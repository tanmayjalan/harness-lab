"""Run code: the model writes a Python script, the harness runs it, and the output (or the error)
goes back to the model. With an error, the model can read it, fix the script and run it again.

THIS IS NOT A SANDBOX. The script runs as you, on this computer: it can read or write any file you
can, and reach the internet. The harness only sets three things:
  - the folder it starts in (the workspace),
  - a time limit (TIME_LIMIT seconds; then the script and anything it started are ended),
  - how much of its output comes back (OUTPUT_LIMIT characters for each of output and errors).
Stop on the page ends it too, the same way. A program the script starts and leaves running after
the script itself has finished normally is not ended.
It also leaves out environment variables whose names look secret (see SECRET_WORDS).
The real guard is "Ask first": you see the code before it runs.
"""
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

TIME_LIMIT = 10           # seconds a script may run
OUTPUT_LIMIT = 10_000     # characters kept from each of its output and its errors
# Variables with one of these in their names are left out (PASS covers PASSWORD and PASSWD). Not PWD:
# on Linux and macOS that's the current folder
SECRET_WORDS = ("KEY", "TOKEN", "SECRET", "PASS", "CREDENTIAL", "AUTH", "COOKIE", "SESSION")


def environment():
    """A copy of this program's environment variables, without the ones that look secret."""
    env = {k: v for k, v in os.environ.items() if not any(w in k.upper() for w in SECRET_WORDS)}
    env["PYTHONIOENCODING"] = "utf-8"  # (for any Python the script starts; the script itself gets -X utf8)
    return env


class Capped:
    """Reads one stream to its end in a thread of its own. Keeps the first OUTPUT_LIMIT characters and
    only counts the rest, so a script that prints forever can't fill the memory."""

    def __init__(self, stream):
        self.kept, self.size, self.more = [], 0, 0
        self.thread = threading.Thread(target=self._read, args=(stream,), daemon=True)
        self.thread.start()

    def _read(self, stream):
        for chunk in iter(lambda: stream.read(4096), ""):
            room = max(OUTPUT_LIMIT - self.size, 0)
            if room:
                self.kept.append(chunk[:room])
                self.size += len(chunk[:room])
            self.more += max(len(chunk) - room, 0)

    def text(self):
        out = "".join(self.kept)
        if self.more:
            out += f"\n…cut: {self.more:,} more characters"
        return out


def kill_tree(proc):
    """End the script and everything it started (a script can start other programs)."""
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    else:
        try:
            os.killpg(proc.pid, signal.SIGKILL)  # its own session (start_new_session), so the whole group
        except ProcessLookupError:
            pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:  # the tree kill didn't work (it shouldn't happen): at least end the script
        proc.kill()
        proc.wait()


def run_python(code=None, path=None, should_stop=None):
    """Run a script and return what it printed. Exactly one of the two:
      `code`: a script the model wrote. It goes in a temporary file outside the workspace, so it never
              adds files there.
      `path`: a script file, relative to the workspace (outside it, the loop asks you first).
    It runs from the workspace folder. A nonzero exit code or the time limit raises RuntimeError with
    the same text, so the model gets it as an error it can fix. `should_stop`: checked while it runs
    (Stop on the page); True ends the script at once, as the time limit does."""
    from harness.core import tools  # here, not at the top: tools.py imports this file
    if (code is None) == (path is None):
        raise ValueError("give either code (a script to run) or path (a .py file in the workspace), not both")
    folder = None
    try:
        if code is not None:
            if not isinstance(code, str) or not code.strip():
                raise ValueError("code is empty")
            folder = tempfile.mkdtemp(prefix="run_python-")
            script = pathlib.Path(folder) / "script.py"
            script.write_text(code, encoding="utf-8")
        else:
            script = tools.resolve(path)
            if not script.is_file():
                raise FileNotFoundError(f"no such script: {path}")
        return _run(script, tools.WORKSPACE, should_stop)
    finally:
        if folder:  # only now: the script and anything it started have ended
            shutil.rmtree(folder, ignore_errors=True)


def _wait(proc, should_stop):
    """Wait for the script to end. Returns None when it ended by itself, or why it was ended: "time"
    (the time limit) or "stop" (should_stop said so; checked every tenth of a second)."""
    if should_stop is None:
        try:
            proc.wait(timeout=TIME_LIMIT)
            return None
        except subprocess.TimeoutExpired:
            return "time"
    until = time.monotonic() + TIME_LIMIT
    while True:
        try:
            proc.wait(timeout=min(0.1, max(0.0, until - time.monotonic())))
            return None
        except subprocess.TimeoutExpired:
            if should_stop():
                return "stop"
            if time.monotonic() >= until:
                return "time"


def _run(script, workspace, should_stop=None):
    # -I: isolated (ignores PYTHON* variables and doesn't import files next to the script); -X utf8: text is UTF-8
    started = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
    proc = subprocess.Popen([sys.executable, "-I", "-X", "utf8", str(script)], cwd=workspace, env=environment(),
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, encoding="utf-8", errors="replace", **started)
    out, err = Capped(proc.stdout), Capped(proc.stderr)
    ended = _wait(proc, should_stop)
    if ended:
        kill_tree(proc)
    for reader, stream in ((out, proc.stdout), (err, proc.stderr)):
        reader.thread.join(timeout=2)  # a program the script left running can keep a stream open: don't wait for it
        if not reader.thread.is_alive():
            stream.close()
    if ended == "time":
        lines = [f"Stopped: the script ran longer than the {TIME_LIMIT}-second time limit, so the harness ended it "
                 "(and anything it started)."]
    elif ended == "stop":
        lines = ["Stopped: the user pressed Stop, so the harness ended the script (and anything it started)."]
    else:
        lines = [f"Exit code: {proc.returncode}"]
    if out.text():
        lines.append("Output:\n" + out.text())
    if err.text():
        lines.append("Errors:\n" + err.text())
    if not (out.text() or err.text()):
        lines.append("(It printed nothing.)")
    text = "\n".join(lines)
    if ended or proc.returncode != 0:
        raise RuntimeError(text)
    return text
