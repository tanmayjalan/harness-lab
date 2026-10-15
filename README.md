<div align="center">

# Harness lab

**A small AI agent harness you can watch, built to learn how one works.**

[![Tests](https://github.com/tanmayjalan/harness-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/tanmayjalan/harness-lab/actions/workflows/ci.yml)
![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue)
![Windows](https://img.shields.io/badge/platform-Windows-lightgrey)
[![MIT License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[Getting started](docs/getting-started.md) · [Learning path](docs/learning-path.md) · [Tour](docs/tour.md) · [How it's built](docs/architecture.md) · [Safety](docs/safety.md)

![The Harness lab's start page: a short explanation of a harness, the loop diagram and the first experiments](docs/images/chat-start.png)

</div>

## What is a harness?

A model on its own only reads text and writes text. The **harness** is the ordinary program around it: it
sends the model the conversation and a list of tools, runs the tools the model asks for, sends back the
results, and repeats until the model answers. Claude Code, coding assistants and "AI agents" are all
harnesses.

That repeat is **the loop**, and here it is about a hundred lines of Python: `agent()` in
[`harness/core/loop.py`](harness/core/loop.py). This lab wraps it in a web page that shows every model call,
every tool run and every token, so you can see what a harness does instead of reading about it.

## Quick start

You need Windows, Python 3.10+ and [Claude Code](https://claude.com/claude-code) installed and logged in. No
API key is needed.

1. Get the code:
   ```
   git clone https://github.com/tanmayjalan/harness-lab.git
   cd harness-lab
   ```
2. Run **`setup.bat`**. It makes the lab's Python folder, installs the packages and checks everything.
3. Run **`start.bat`**. The page opens at http://127.0.0.1:8000. **`stop.bat`** stops it.

By default replies come from `claude -p` on your Claude Code plan (the *mock*). With an API key you can use
the Anthropic API or DeepSeek instead: `start.bat -Provider anthropic`. Or run a free model on your own
computer with [Ollama](https://ollama.com) or [LM Studio](https://lmstudio.ai): `start.bat -Provider ollama`. See
[Getting started](docs/getting-started.md) for every option, and
[If something goes wrong](docs/getting-started.md#if-something-goes-wrong) if a step fails.

## What you can try

27 guided experiments in five tiers, each building on the one before ([learning path](docs/learning-path.md)):

| Tier | You'll see |
|---|---|
| **The loop** | call, run tools, call again; errors sent back as answers; retries; replies cut off; runaway tasks stopped |
| **Control and safety** | asking before acting, hooks that block a tool, a file that tries to give orders, Rewind |
| **Size and cost** | the history growing, trimming, prompt caching, several tools at once, fifty tools, finding a tool first |
| **Shaping the model** | thinking, a strict input form, memory, editing a tool's description, switching model mid-chat |
| **Bigger jobs** | helper agents, a chain of agents, write-run-fix, plans, search then read, skills, MCP tools |

Then measure what a change does:

- **Inspector:** open any model call and see exactly what was sent and received, how big it was, what it
  cost, and what your hooks decided.
- **Compare:** one question, up to three setups side by side, each run several times.
- **Re-run:** send a past message again with today's settings.
- **Evals:** fixed questions scored PASS / MIXED / FAIL, with a pass-rate chart over time.
- **Quiz:** check what stuck.

## How it's organised

```
harness/core/       the loop, the tools and the providers: read these first
harness/features/   add-ons to the loop, one idea per file (memory, skills, helpers, hooks, trimming, ...)
harness/web/        the small server behind the page
config/             files you're meant to edit: hooks, skills, MCP servers, eval questions
workspace/          the model's folder, with sample files to experiment on
ui/                 the page's source (React + TypeScript + Tailwind)
tests/              offline tests: no model calls
docs/               the documentation
scripts/            the PowerShell behind setup.bat, start.bat and stop.bat
```

The full map, with one line per file, is in [How it's built](docs/architecture.md#whats-where).

## Documentation

| | |
|---|---|
| [Getting started](docs/getting-started.md) | install, start, stop, providers |
| [A learning path](docs/learning-path.md) | the experiments, in order |
| [Running a workshop](docs/workshop.md) | a two-hour path, the day-before checklist, resetting between demos |
| [A tour of the page](docs/tour.md) | what each part of the page shows |
| [How it's built](docs/architecture.md) | the code, file by file; the workflow's two loops |
| [Safety rules](docs/safety.md) | the workspace, approvals, running code, hooks, Rewind |
| [What the mock can't show](docs/limitations.md) | estimates and what hasn't been tried live |
| [Development](docs/development.md) | terminal version, evals, tests, working on the page |

## Safety, in short

The model's file tools work only in `workspace/` without asking. Writing files, saving facts, running code
and MCP tools ask first. Running code is **not** a sandbox: a script runs as you, so read it before you click
Allow. Everything the model reads is sent to the provider you chose. Details in [Safety rules](docs/safety.md).

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). To report a security problem,
see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
