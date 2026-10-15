# A learning path

The experiments (top bar → **Experiments**, or the empty conversation) follow this order; each tier builds on
the one before. Some set things up for you (a setting or a model) and say so, with **Undo** above the message
box until you use it; some ask you to guess first ("how many model calls?") and show the real answer after
the run.

| Tier | Experiments |
|---|---|
| **1. The loop** | Watch the loop · Errors are answers too · A busy service (the harness waits and tries again) · Cut off mid-sentence (the longest reply set to 300 tokens) · Runaway task (at most 2 calls per message) |
| **2. Control and safety** | Ask before acting · Stopped by a hook · A file that gives orders (and the hook that marks file and web text as untrusted) · Take it back (Rewind: going back undoes the files too) |
| **3. Size and cost** | Watch the history grow · Long reading, short memory (trimming) · Second call is cheaper (prompt caching; needs the Anthropic API: the mock can't cache and DeepSeek caches on its own) · Three cities at once (several tools at the same time) · Fifty tools (every tool description on every call) · Find a tool first (find_tool loads a tool only when it's needed) |
| **4. Shaping the model** | Think first · Answer as a form (a strict tool input) · Remember me · Change what a tool says it does · Same chat, new model |
| **5. Bigger jobs** | Hand off to a helper · A chain of agents (a [workflow](architecture.md#two-loops-a-workflow)) · Write, run, fix (the model runs a script, reads the error and fixes it) · Plan, then do · Find the refund policy (search, then read) · Instructions on demand (skills) · Tools from another program (MCP) |

Then use **Compare** (ready-made comparisons) and **Re-run** to see what one change does, **Evals** to measure
whether a change made things better or worse, and **?** → **Quiz me** to check what stuck. The
[tour of the page](tour.md) explains each of these.

A few experiments leave something behind, so they don't start the same way a second time: **Write, run, fix**
fixes the bug in `scripts/totals.py`, **Ask before acting** leaves a new `todo.txt`, **Take it back** adds a
line to `notes.md` unless you rewind, and **Remember me** saves a fact in Memory. [Running a
workshop](workshop.md#reset-between-demos) says how to put them back, and has a two-hour path through these
tiers.

## Things to try in the workspace

The model's folder, [`workspace/`](../workspace/), has sample files made for these experiments (see its
[README.txt](../workspace/README.txt)):

| File | Try |
|---|---|
| `budget.csv` | "What's the total?" |
| `scripts/totals.py` | it has a bug: with Run code on, ask the model to run it and fix it |
| `private/.env` | **fake** secrets: the example hook blocks reading them |
| `handbook/` | 26 short policies of a made-up company: "What's our refund policy?" |
| `inbox/supplier_email.txt` | an ordinary email with an order hidden in it for the AI (prompt injection): "Summarise inbox/supplier_email.txt" |
