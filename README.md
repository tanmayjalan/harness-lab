# Harness lab

A small AI **harness**, built to learn how one works. A harness is the program around a model:
the model can only write text, so the harness sends it the conversation and a list of tools,
runs the tools it asks for, sends back the results, and repeats until the model answers.
That repeat is **the loop**: `agent()` in [`harness/core/loop.py`](harness/core/loop.py). Start reading there.

## Start and stop

| | |
|---|---|
| **`setup.bat`** | Run once first, or whenever something doesn't work: gets the lab ready and checks it (see below) |
| **`start.bat`** | Starts the web page at http://127.0.0.1:8000 and opens it |
| **`stop.bat`** | Stops the lab's servers, and nothing else (add `-List` to only see what it would stop) |

`start.bat` options: `-Provider deepseek` or `-Provider anthropic` (default: the mock, real replies from
`claude -p` on your Claude Code plan, no API key needed), `-NoBrowser`, and `-NoBuild` (see *Working on the
page*). You can also switch provider, and for the mock the model (Opus, Sonnet or Haiku), in the page at any
time; the conversation is kept.

`stop.bat` only stops a process if it was started with this folder's own Python (`.venv`) **and** is one of
the lab's servers (the web server, the mock server, the demo MCP server). Other programs, and anything else
using the same ports, are never touched.

`setup.bat` checks, in order: Python 3.10+ and the lab's own Python folder (`.venv`, made and filled if
missing); Claude Code, with one small `claude -p` call made exactly as the mock makes them (a few seconds of
your plan); the API keys (`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`), each tried with a free call that lists the
service's models; Node.js; and whether ports 8000 and 8765 are free. It then says which `start.bat` commands
will work. It offers to save each key: what you paste isn't shown, Enter skips it (the mock needs no key),
and it's saved for your Windows user, where `setx` would put it, never in a file. Only the last 4
characters of a key are ever shown. Options: `-Check` only reports (changes nothing, asks nothing), and
`-Quick` skips the `claude -p` call and the key tests.

## What's where

```
Harness/
├── setup.bat                get ready and check: Python, claude -p, API keys (setup.ps1 does the work)
├── start.bat, stop.bat      start / stop the web page (the .ps1 files do the work)
├── README.md                this file
├── requirements.txt         Python packages (start.bat installs them on first run)
│
├── harness/                 ALL THE CODE
│   ├── core/                the essentials: read these first
│   │   ├── loop.py          THE LOOP, the system prompt, permissions (allow / ask / block), stopping
│   │   ├── tools.py         what the model is told about each tool, the code behind them, the workspace rule,
│   │   │                    and search_files (find the right file before reading it: retrieval)
│   │   ├── run_code.py      run_python: the model runs a Python script it wrote (a time limit, not a sandbox)
│   │   ├── toy_tools.py     practice tools: live weather (Open-Meteo), temperature, calculator, time, dice,
│   │   │                    and submit_expense (a strict input form: structured output)
│   │   ├── office_tools.py  40 pretend office tools (book_room, request_leave, ...): a long tool list to try
│   │   ├── providers.py     one loop, several AI services: only the address, key, model and prices change
│   │   └── mock_server.py   a stand-in for the Anthropic API that gets its replies from `claude -p`
│   ├── features/            add-ons to the loop, one idea per file
│   │   ├── memory.py        "About you": facts the harness adds to every conversation; the remember_fact tool
│   │   ├── lab_settings.py  your edits to the prompt, tool descriptions and permissions (Settings)
│   │   ├── planning.py      the model keeps a step-by-step plan for bigger tasks
│   │   ├── skills.py        instructions the model loads only when it needs them (config/skills/)
│   │   ├── tool_search.py   too many tools: find_tool sends a tool's details only once the model needs it
│   │   ├── subagents.py     helper agents: a fresh loop for a job; only a short report comes back
│   │   ├── workflow.py      a chain of agents your code runs in order: gather facts, write, check, fix
│   │   ├── hooks.py         loads your hooks (config/my_hooks.py) to run around every tool call
│   │   ├── checkpoints.py   a copy of the workspace's files before each message, so Rewind can put them back
│   │   ├── mcp_client.py    tools from separate MCP programs (config/mcp_servers.json)
│   │   ├── trimming.py      send a smaller copy of a long history (old tool results replaced by a note)
│   │   ├── compaction.py    replace old history with a summary written by the model
│   │   └── context.py       when to trim or summarise, as your settings say (the page and the terminal share it)
│   ├── web/                 the server behind the web page
│   │   ├── server.py        the small server: the page's data, approvals, settings, Compare, Re-run
│   │   ├── static/          the built page (made from ui/ by `npm run build`; kept in git)
│   │   ├── conversations.py saving and reopening conversations, and the setup each message used
│   │   ├── compare.py       one question with two or three setups side by side, run 1, 3 or 5 times each
│   │   └── jsonify.py       turns the API's reply objects into plain JSON for the page
│   ├── cli.py               the terminal version (it follows your page settings too)
│   ├── evals.py             scores a setup on fixed questions (config/evals.json); used by the Evals tab too
│   ├── words.py             small wording helpers ("1 fact", "2 facts")
│   └── paths.py             where every folder is
│
├── config/                  FILES YOU'RE MEANT TO EDIT
│   ├── my_hooks.py          your hooks (example: block secret-looking files, log every tool call)
│   ├── mcp_servers.json     which MCP servers to start
│   ├── skills/              one Markdown file per skill: expenses, meeting-notes, trip-check
│   └── evals.json           the eval questions
│
├── ui/                      THE WEB PAGE'S SOURCE (React + TypeScript + Tailwind; see Working on the page)
├── workspace/               THE MODEL'S FOLDER: its file tools work here without asking (sample files inside,
│                            and handbook/: 26 short policies of a made-up company, to search)
├── data/                    WHAT THE LAB SAVES: your profile, settings, conversations, eval results, tool log
│                            (not in git; deleted conversations wait in conversations/.deleted/ for 7 days;
│                            checkpoints/ holds the copies of files Rewind puts back, each version once,
│                            private/.env included: they stay on this computer)
├── examples/                demo_mcp_server.py, a tiny MCP server with text tools
└── tests/                   offline tests (no model calls)
```

## A learning path

The experiments (top bar → **Experiments**, or the empty conversation) follow this order; each tier builds on
the one before. Some set things up for you (a setting or a model) and say so, with **Undo** above the message box until you use it; some ask
you to guess first ("how many model calls?") and show the real answer after the run.

1. **The loop**: Watch the loop · Errors are answers too · A busy service (the harness waits and tries again) ·
   Cut off mid-sentence (the longest reply set to 300 tokens) · Runaway task (at most 2 calls per message).
2. **Control and safety**: Ask before acting · Stopped by a hook · A file that gives orders (and the hook that
   marks file and web text as untrusted) · Take it back (Rewind: going back undoes the files too).
3. **Size and cost**: Watch the history grow · Long reading, short memory (trimming) · Second call is cheaper
   (prompt caching; needs the Anthropic API: the mock can't cache and DeepSeek caches on its own) · Three cities at once (several tools at the same time) ·
   Fifty tools (every tool description on every call) · Find a tool first (find_tool loads a tool only when it's needed).
4. **Shaping the model**: Think first · Answer as a form (a strict tool input) · Remember me · Change what a tool
   says it does · Same chat, new model.
5. **Bigger jobs**: Hand off to a helper · A chain of agents (a workflow) · Write, run, fix (the model runs a
   script, reads the error and fixes it) · Plan, then do · Find the refund policy (search, then read) ·
   Instructions on demand (skills) · Tools from another program (MCP).

Then use **Compare** (ready-made comparisons) and **Re-run** to see what one change does, **Evals** to measure
whether a change made things better or worse, and **?** → **Quiz me** to check what stuck.

## A tour of the page

Three columns: your conversations on the left, the conversation in the middle, and a look inside one model call
on the right.

- **Conversations (left):** every saved conversation, newest first, with small tags for the setup it last used
  (model, "prompt edited", "trimming on" and so on). **New conversation** starts a fresh one. The bin deletes one
  (click twice; **Undo** brings it back). Eval runs are saved too, but opened from the Evals screen.
- **Chat, the conversation (middle):** your message, then each **model call** as a thin line (`Call 2 · asked for
  1 tool · 1.8s`), with the tools it asked for underneath: what the model asked for, whether the harness ran it,
  and why not if it didn't (your settings, your hook, you declined, outside the workspace). Click a tool to see
  its input and result, and what each of your hooks decided for it. A row is marked when a hook rewrote its
  result (both versions are shown) or crashed. A helper agent shows as a card with what it read and the short report it sent back; a
  plan shows as a checklist. With the workflow on, a Workflow card shows the chain as a diagram, each step's
  calls sit under its name, and each step shows the text your code sent it and what it returned. Each idea is explained in full the first time it appears, then shrinks to an ⓘ
  (its popover leads to the glossary).
  - An empty conversation offers the **experiments** (also under **Experiments** at the top): each says where
    to look while it runs (with your guess, just above the message box), then what it showed and what to try
    next, right under the answer.
  - When a tool needs your OK, the message box is replaced by one **approval** panel: Allow or Decline (keys
    **A** / **D**), and "Always allow" to stop being asked for that tool.
  - Above the message box: the provider and model in use (click to switch) and the tokens used so far.
    **Esc** stops a message after the current step (a `run_python` script that is running is ended at once).
  - Hover a past message for **Re-run with current settings** (send it again after the same history, and see the
    saved run and the new one side by side) or **Compare this question**.
  - **Rewind to here**, also under a past message, goes back to before it. A dialog first lists what happens:
    the messages that go, the files put back as they were and the files deleted (added since), any file changed
    since the conversation's last reply by something else (you, another conversation, Compare or Re-run:
    rewinding overwrites it), and what can't be undone. Rewind puts the message back in the message box; if you
    had typed something there, it asks before replacing it. There is no Undo: the dialog is the check.
    Conversations saved before Rewind existed don't offer it.
- **Inspector (right):** the call you clicked, or the newest one. A small loop diagram shows where it ended up.
  **Summary** starts with **This conversation** (calls, tool runs, time spent on the model, the tools and waiting
  for you, tokens, cost, and how big the next call will be at least; **Export every call as CSV** gives one row per call).
  Then the call itself: where its time went (on the mock, part of it is starting `claude -p`), how much of the
  model's context window (the most it can read at once) it used, whether the start of the request changed since
  the previous call (if it did, nothing could come from the cache), tokens, what was sent and what came back,
  and a chart of every call's size (it grows as the history grows, and drops where trimming or summarising cut
  it; arrow keys move between bars). **Sent** shows the exact system prompt
  (facts about you highlighted), the tools offered and every message, with the ones new since the previous call
  in green. **Received** is the model's reply; **Tools** starts with **Your hooks in this call** (which hook
  functions were loaded from `config/my_hooks.py`, and one line per hook call: let it through, blocked, left the
  result alone, rewrote it, or crashed) and then follows each tool's round trip (asked for, run here, sent
  back); **Raw** is the JSON. **[** and **]** (or **Alt+←** / **Alt+→**) step through calls.
- **Settings (gear, or Ctrl+,):** **Model** (provider and model, **thinking** on/off, **prompt caching** to make
  repeated input cheaper, **limits** on the longest reply and the most calls per message, a practice switch that makes the service look
  busy (to watch the harness retry; helpers and Compare sides follow it too), **how each message is answered**
  (one agent, or a workflow: a chain of agents, with its diagram), and **when changes
  apply**: from your next message, or only from your next conversation, which keeps the prompt, tool descriptions
  and facts about you a conversation began with, so the start of every request stays the same and can be cached), **Prompt** (and **Skills**: on demand, a line per skill and a load_skill tool, or all in the prompt), **Memory** (facts about you; only ticked ones are sent, and you see the
  exact text added), **Tools** (running several tools at once, **Run code**: the run_python tool, off until you turn it on, **40 extra office tools**: off, all sent on every call, or found on demand with find_tool, Allow / Ask first / Block per tool, editable descriptions, and
  each tool's input shape), **Context** (trimming and summarising; the summarising point can be set as a % of
  the model's context window) and **Display** (text size, the Inspector's width without dragging, Learning mode to keep every explanation open). A dot
  marks anything you changed from the default.
- **Compare (top):** one question with up to three setups at once, each with its own provider, model, prompt and
  permissions. You see what differs between the setups, then each side's answer, tools, time and tokens. Run
  each side 3 or 5 times to see the middle value and the range, and how often the answers agree (models vary
  from run to run); a running comparison shows each side's progress and can be stopped. **Inspect this side**
  opens a side as a normal conversation, with every call in the Inspector, and **Back to Compare** returns.
  Every comparison is kept under **Past comparisons**.
- **Evals (top):** the fixed questions in `config/evals.json`, each checked for the right tools and answer. Pick
  the provider and model, 1, 3 or 5 runs per question, your settings or the defaults; you get PASS / MIXED /
  FAIL per question with the reasons, what was checked, every run's answer (with a link to its conversation),
  and a pass-rate chart of every past run (click a point to see it). A run can be stopped; what finished is kept.
- **?** opens the page at a glance, the keyboard shortcuts, a quiz, what the mock can and can't show, and a
  glossary you can search.

## Two loops: a workflow

With **Settings → Model → How each message is answered** on (or the experiment *A chain of agents*), a message
doesn't go to one agent. It goes through fixed steps written as ordinary Python in
[`harness/features/workflow.py`](harness/features/workflow.py). That gives two loops, one inside the other:

```
 OUTER CHAIN: your code runs the steps in this order and reads each result
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                  │
 │  │ Gather facts │ ──▶ │ Write        │ ──▶ │ Check        │ ── PASS ─▶ Answer │
 │  │  model ⇄     │     │  model       │     │  model       │                  │
 │  │  tools       │     │  (no tools)  │     │  (no tools)  │                  │
 │  └──────────────┘     └──────────────┘     └──┬───────▲───┘                  │
 │                                       problems│       │check again           │
 │                                            ┌──▼───────┴───┐                  │
 │                                            │ Fix          │ at most 2 fixes, │
 │                                            │  model       │ then the last    │
 │                                            └──────────────┘ draft            │
 └──────────────────────────────────────────────────────────────────────────────┘
 INNER LOOP (inside each box, a fresh conversation): the model calls tools until it decides it's done
```

- **The outer chain is code.** It runs step 1, builds step 2's message from step 1's text, and so on. After a
  check it reads the reply: PASS goes to the answer, PROBLEMS goes back to be fixed. The model never chooses
  the next step. With a helper (`delegate`) it's the other way round: the model decides when to hand work off.
- **The inner loop is `loop.agent`**, the same loop as always, with the step's own instructions and tools and an
  empty history. Each step sees only what the code passes it: the writer gets the notes, never the files.
- **Only the final answer joins the conversation**, so a follow-up carries the question and the answer (the
  steps get the earlier ones as plain text). The most calls per message (Limits) counts every step's calls.

## Working on the page

The page's source is in `ui/` (React, TypeScript and Tailwind, built with Vite). The built result is in
`harness/web/static/` and kept in git, so you only need Node.js to change the page.

```
cd ui
npm install            once
npm run dev            a live-reloading copy at http://localhost:5173 (start the lab first: it talks to port 8000)
npm test               the page's tests
npm run build          rebuild harness/web/static
```

`start.bat` rebuilds the page by itself when a file in `ui/` is newer than the build (and npm is installed);
`-NoBuild` skips that. The previous page (one HTML file) is in git history:
`git show 334591d:harness/web/page.html > old-page.html`.

## Safety rules built in

- **Workspace:** the file tools work in `workspace/`. Reading, listing or writing anywhere else needs your OK,
  so the model can't see the code, your saved conversations or your profile without asking.
- **Approvals:** `write_file`, `remember_fact`, `run_python` and MCP tools ask first by default (change it in Settings → Tools).
- **Running code is not a sandbox.** `run_python` is off until you turn on Settings → Tools → Run code, and it
  asks first, showing you the code. A script runs as you: it can read or change any of your files and reach the
  internet. The harness only starts it in `workspace/`, stops it after 10 seconds or when you press Stop (and
  anything it started, if it is still running then), keeps the first 10,000 characters of what it prints, and
  leaves out environment variables whose names look secret (with KEY, TOKEN, SECRET, PASS, CREDENTIAL, AUTH,
  COOKIE or SESSION in them). A program the script starts and leaves running after it has finished normally
  keeps running. Read the code before you click Allow.
- **Hooks:** the example `config/my_hooks.py` blocks paths that look like secrets (try `Read private/.env`),
  blocks code that mentions `shutil.rmtree`, `os.remove` or `subprocess` (a text check, easy to get around),
  logs every call to `data/tool_log.txt`, and puts an "untrusted content" line in front of what `read_file`,
  `get_weather` and `run_python` return, so the model treats instructions inside files and web data as text, not orders.
  It helps; it isn't a guarantee.
- **Helpers, Compare, Re-run and evals** can't ask you anything, so tools that need approval are refused there.
- **Rewind undoes files only inside `workspace/`.** Before each message the harness saves a copy of the
  workspace's files (a checkpoint), and Rewind puts them back. It can't undo a web request already sent, a fact
  saved in Memory, what an MCP tool did, a write outside the workspace, or anything a `run_python` script did
  outside the workspace; the dialog lists those. A workspace over 5,000 files or 50 MB isn't copied: Rewind
  then cuts only the conversation. Compare, Re-run and evals keep no checkpoints, and the terminal has no Rewind.
  The copies are every workspace file, `private/.env` included. They stay in `data/checkpoints/` on this
  computer only (`data/` is never in git).
- **Everything the model reads is sent to the provider.** With DeepSeek, that means DeepSeek's servers.
- **`get_weather` uses the internet:** it sends the city name to open-meteo.com (free, no key) and shows
  the exact web requests in its result. No other built-in tool goes online (a script `run_python` runs can).

## Other ways to run it

Run these from the Harness folder:

```
.venv\Scripts\python -m harness.cli --provider mock                 terminal version
.venv\Scripts\python -m harness.evals --provider mock               the 16 eval questions, judged by the mock
.venv\Scripts\python -m harness.evals --provider mock --only weather    just some of them
.venv\Scripts\python -m harness.evals --provider mock --repeat 3        each question 3 times: pass rates
.venv\Scripts\python -m harness.web.sandbox                           the page on a throwaway copy of your data (port 8100)
.venv\Scripts\python -m unittest discover -s tests                  offline tests
```

Tests never touch your real profile, settings, conversations, hooks or workspace (see `tests/isolate.py`).

## What the mock can't show, and what hasn't been tried live

The mock gets real replies from `claude -p`, but it isn't the API, so some things are imitated:

- **Token counts** are estimates (about 4 characters per token), marked ≈ in the page.
- **The longest-reply limit** is applied by the mock cutting the reply text; the real API stops the model
  itself. The lesson (stop reason `max_tokens`, half-finished tool requests) is the same.
- **Prompt caching** doesn't happen on the mock.

Written for the Anthropic API but **not tried live** (no API key was available): strict tool inputs
(`"strict": true`, sent only to Anthropic), summarising on Anthropic, adaptive thinking with an effort
level, and prompt caching marks. They're covered by offline tests of the request the harness builds.
The DeepSeek context window (1M tokens) comes from third-party listings; the Claude ones from Claude's docs.

## Requirements

Python 3.10+ with the packages in `requirements.txt`. The mock needs Claude Code (`claude`) installed and logged in.
Node.js is only needed to change the page (the built page is in git). `setup.bat` checks all of these.
