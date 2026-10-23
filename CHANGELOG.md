# Changelog

What changed in the Harness lab, newest first.

## Unreleased

- The page's code is checked with ESLint (`npm run lint`, also in CI): mistakes, and that each React effect
  lists what it uses. TypeScript 7 has no API ESLint can call yet, so ESLint reads the code with Microsoft's
  TypeScript 6 package; `tsc` is still TypeScript 7.
- Fixed a page test that could never fail: its pattern held invisible characters instead of `\b`.

## 0.1.0 (23 October 2026)

The first tagged release: everything a full review of the lab found, fixed.

### Safety

- `search_files` no longer follows folder shortcuts (links and junctions) out of `workspace/`, so it can't
  search files outside it without asking.
- A network path (one starting with `\\` or `//`, which names another computer) is never looked up before you
  are asked. Looking one up makes Windows contact that computer at once, which could carry data out.
- A tool path that isn't text no longer breaks the conversation: the tool fails and the model gets the error.
- A tool path with a `:` anywhere but right after the drive letter is refused: `notes.md:x` names a hidden
  extra part of a file (an "alternate data stream") that Rewind can't see or put back.
- `run_python` runs a file by its path only if it is a `.py` script, since the approval card shows only those.
- Two saves at the same moment (settings, Memory, conversations, comparisons and other saved files) no
  longer lose one of them or fail.
- The page can't be shown inside another website's page, where a hidden frame could trick you into clicking
  Allow.
- `write_file` keeps the line endings the model gave (on Windows, `\r\n` used to become `\r\r\n`).

### When something goes wrong

- A saved settings or Memory file that can't be read is moved aside (kept, named `….damaged-<time>.json`) and
  the defaults are used, with a note above the message box and in Settings. Before, every message failed.
  The note goes once the file is saved again.
- A Memory file edited by hand to more than 30 facts is read whole instead of failing.
- A malformed request to the lab's server gets a plain "400" answer instead of a dropped connection.
- Deleting the conversation that is still running is refused, so Undo can't later bring back an older copy.
- A conversation that fails to save no longer stays "busy" until the server is restarted.

### Starting the lab

- `start.bat` stops and says to run `setup.bat` first if the lab's Python folder (`.venv`) is missing.
- `start.bat` rebuilds the page only if you're working on it (`ui\node_modules` exists). A fresh clone no
  longer runs `npm install` and a rebuild on its first start.
- The Python packages have version ranges (`anthropic` 1.11 up to 2, `mcp` 2.3 up to 3), so a new major
  release can't break a fresh setup.

### The page

- The loop that keeps the page up to date can no longer run twice at once.
- Requests from the page to the lab's server now give up after a while instead of waiting for ever.
- The page no longer calls the mock "free": it uses your Claude Code plan, at no extra charge.
- The terminal version (`harness.cli`) now keeps a conversation's start when your edits apply from the next
  conversation, as the page does.

### Behind the scenes

- One message's setup (prompt, tools, rules, thinking, caching, limits) is now built in one place,
  [`message_setup.py`](harness/features/message_setup.py), for the page, the terminal version and Compare,
  so the three can't drift apart again. Calls, tokens and cost are added up in one place too
  ([`tally.py`](harness/web/tally.py)).
- `agent()` in `loop.py` is shorter (about eighty lines): the retry waiting and the cut-off-reply handling are
  small functions of their own. The server's requests are one small function each.
- A saved run now counts a tool that failed, or wasn't run because nobody could be asked, the same way
  Compare does.
- `read_file` sends at most the first 100,000 characters of a file, with a note saying how much was left out.
- A missing API key is an ordinary error: the terminal version, evals and the web server say what to set
  instead of stopping with a traceback, and evals skip a provider without its key.
- The page's two largest screens (Compare and the Inspector) are split into one file per part.

### For contributors

- CI checks the code for mistakes (`ruff`), and that the built page in git matches `ui/`. Its actions are
  pinned to exact versions, and Dependabot proposes updates.
- New `pyproject.toml` lists the same packages as `requirements.txt` (a test checks they match) and holds
  ruff's settings.
- More tests: the server's approve, stop, reset, delete and restore requests, sent the way the page sends them.
- The README's picture shows a real run with the Inspector open; the start page moved to the tour.

### Docs

- The Quick start says what you need: a Claude Code plan (the default, at no extra charge), an API key, or
  Ollama / LM Studio (free, on your computer). It says why the lab is Windows only, and that each call on the
  mock takes about 5 to 30 s.
- Commands are written `.\setup.bat`, which works in PowerShell too.
- Fixed: the handbook has 25 policies, not 26; a clone makes a `harness-lab` folder; the file map in
  [How it's built](docs/architecture.md) now names every Python file (a test checks it).
- New: a troubleshooting row for "the web server did not start", `start.bat -Real`, the Node.js version
  (26 or newer), a code of conduct, a Question issue form, and this changelog.
- The safety page and SECURITY.md say the web page's server has no password, so another program or Windows
  user on the same computer could send it requests.

## Earlier

Changes before this file was started are in the
[merged pull requests](https://github.com/tanmayjalan/harness-lab/pulls?q=is%3Apr+is%3Amerged) on GitHub,
for example #6 (models on your own computer) and #7 (fixes to it).
