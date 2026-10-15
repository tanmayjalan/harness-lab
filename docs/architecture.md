# How it's built

A harness is the program around a model. The model can only write text, so the harness sends it the
conversation and a list of tools, runs the tools it asks for, sends back the results, and repeats until the
model answers. That repeat is **the loop**: `agent()` in [`harness/core/loop.py`](../harness/core/loop.py).
Start reading there.

```
 You ──▶ Call the model ──▶ Model replies ──▶ Run tools ──┐
         (whole history)    why did it stop?  (your hooks  │
              ▲                  │            run around   │
              │                  │ finished   each one)    │
              │                  ▼                         │
              │             Show answer                    │
              └──────── asked for tools: send the results ─┘
```

Everything else is an add-on to that loop, one idea per file in [`harness/features/`](../harness/features/).

## What's where

```
Harness/
├── setup.bat                get ready and check: Python, claude -p, API keys
├── start.bat, stop.bat      start / stop the web page
├── scripts/                 the PowerShell scripts that do the work for the three .bat files
├── requirements.txt         Python packages (setup.bat installs them)
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
│   │   ├── sandbox.py       the page on a throwaway copy of your data
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
├── ui/                      THE WEB PAGE'S SOURCE (React + TypeScript + Tailwind, built with Vite)
├── workspace/               THE MODEL'S FOLDER: its file tools work here without asking (sample files inside,
│                            and handbook/: 26 short policies of a made-up company, to search)
├── examples/                demo_mcp_server.py, a tiny MCP server with text tools
├── tests/                   offline tests (no model calls)
├── docs/                    these pages
├── .github/                 the test run on every push, and issue and pull request templates
│
└── data/                    WHAT THE LAB SAVES: your profile, settings, conversations, eval results, tool log
                             (made on first run, never in git; deleted conversations wait in
                             conversations/.deleted/ for 7 days; checkpoints/ holds the copies of files Rewind
                             puts back, each version once, private/.env included: they stay on this computer)
```

Every folder the lab uses is worked out in one place, [`harness/paths.py`](../harness/paths.py).

## Providers

[`harness/core/providers.py`](../harness/core/providers.py) keeps the loop the same for every AI service:
only the address, key, model and prices change.

| Provider | Needs | Notes |
|---|---|---|
| **mock** (default) | Claude Code, logged in | [`mock_server.py`](../harness/core/mock_server.py) imitates the Anthropic API and gets its replies from `claude -p`. Free on your plan, but each call takes 20 to 60 s. See [what the mock can't show](limitations.md) |
| **anthropic** | `ANTHROPIC_API_KEY` | the real Anthropic API, paid per use |
| **deepseek** | `DEEPSEEK_API_KEY` | DeepSeek's Anthropic-compatible API, paid per use |

## Two loops: a workflow

With **Settings → Model → How each message is answered** on (or the experiment *A chain of agents*), a message
doesn't go to one agent. It goes through fixed steps written as ordinary Python in
[`harness/features/workflow.py`](../harness/features/workflow.py). That gives two loops, one inside the other:

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
