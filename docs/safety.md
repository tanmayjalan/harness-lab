# Safety rules built in

The lab lets a model read files, run tools and, if you allow it, run code on your computer. These are the
rules the harness applies, and their limits.

## Workspace

The file tools work in [`workspace/`](../workspace/). Reading, listing or writing anywhere else needs your
OK, so the model can't see the code, your saved conversations or your profile without asking.

## Approvals

`write_file`, `remember_fact`, `run_python` and MCP tools ask first by default (change it in
**Settings → Tools**). Helpers, Compare, Re-run and evals can't ask you anything, so tools that need approval
are refused there.

## Running code is not a sandbox

`run_python` is off until you turn on **Settings → Tools → Run code**, and it asks first, showing you the
code: the code the model wrote, or, for a script file in the workspace, what the file says at that moment (it
could still change before it runs). A script runs as you: it can read or change any of your files and reach the
internet. The harness only:

- starts it in `workspace/`;
- stops it after 10 seconds or when you press Stop (and anything it started, if it is still running then);
- keeps the first 10,000 characters of what it prints;
- leaves out environment variables whose names look secret (with KEY, TOKEN, SECRET, PASS, CREDENTIAL, AUTH,
  COOKIE or SESSION in them).

A program the script starts and leaves running after it has finished normally keeps running. **Read the code
before you click Allow.**

## Hooks

The example [`config/my_hooks.py`](../config/my_hooks.py):

- blocks paths that look like secrets (try `Read private/.env`; the values in it are fake);
- blocks code that mentions `shutil.rmtree`, `os.remove` or `subprocess`, in code the model wrote or in a
  script file it asks to run (a text check, easy to get around);
- logs every call to `data/tool_log.txt`;
- puts an "untrusted content" line in front of what `read_file`, `get_weather` and `run_python` return, so the
  model treats instructions inside files and web data as text, not orders.

It helps; it isn't a guarantee.

## Rewind

Rewind undoes files only inside `workspace/`. Before each message the harness saves a copy of the workspace's
files (a checkpoint), and Rewind puts them back. It can't undo:

- a web request already sent;
- a fact saved in Memory;
- what an MCP tool did;
- a write outside the workspace;
- anything a `run_python` script did outside the workspace.

The dialog lists those. A workspace over 5,000 files or 50 MB isn't copied: Rewind then cuts only the
conversation. Compare, Re-run and evals keep no checkpoints, and the terminal has no Rewind. The copies are
every workspace file, `private/.env` included. They stay in `data/checkpoints/` on this computer only
(`data/` is never in git).

## The mock answers only the harness

The mock runs `claude -p` on your Claude Code plan, and any web page you visit can send requests to programs
on your computer. So the mock answers a request only if it is addressed to this computer (127.0.0.1), is sent
as JSON, and carries the mock's key: a random key made each time the lab starts it, which only the harness
knows. The lab's own web server already refuses requests addressed to any other name.

## What leaves your computer

- **Everything the model reads is sent to the provider.** With the mock, that means Anthropic, under your
  Claude Code login; with DeepSeek, DeepSeek's servers.
- **`get_weather` uses the internet:** it sends the city name to open-meteo.com (free, no key) and shows the
  exact web requests in its result. No other built-in tool goes online (a script `run_python` runs can).

To report a security problem in the lab itself, see [SECURITY.md](../SECURITY.md).
