# Running a workshop

How to run the lab for a room: a two-hour path, what to check the day before, and how to get back to a clean
start between demos. For the experiments themselves, see the [learning path](learning-path.md).

## Before the day

Each attendee needs:

- **Windows** and **Python 3.10+**.
- **Claude Code**, installed and signed in on **their own** Claude plan. The default provider, the mock, sends
  every message through `claude -p` on that sign-in, so it uses a little of their plan's usage limits. Nobody
  should share a sign-in.
- **The lab itself**: `git clone`, or **Code → Download ZIP** on GitHub for anyone without git (a ZIP copy
  can't use `git checkout` to restore the sample files; they unzip it again instead).
- **`setup.bat` run the day before**, not in the room. It checks Python, Claude Code (with one small
  `claude -p` call) and port 8000, and says what to fix. See [Getting started](getting-started.md).
- **Internet access to open-meteo.com**: `get_weather` looks the weather up there. It is used by the first
  experiment, so check the venue's network allows it. If it doesn't, start with "Errors are answers too" or
  "Ask before acting" instead.

Attendees without a Claude plan: pair them with someone who has one, one screen between two. Pairs also talk
through their guesses, which helps.

No API key is needed, except for one experiment (below). If you have an Anthropic API key, you can show that
one yourself.

## A two-hour path

On the mock each model call takes about 5 to 30 s, and most experiments make 1 to 5 calls, so a run takes from
a few seconds to a couple of minutes. *A chain of agents* (the workflow) makes more calls and takes a minute or
more. The minutes below are rough planning figures for running, reading and
talking about each experiment, not measurements.

**Core** experiments are the ones to do with everyone; **optional** ones are for fast attendees or another
day. The tiers are in the order the page shows them.

| Minutes | Part | Core | Optional |
|---|---|---|---|
| 10 | Start | everyone runs `start.bat` and opens the page; the loop diagram on the start page | |
| 20 | **1. The loop** | Watch the loop · Errors are answers too · Runaway task | A busy service · Cut off mid-sentence |
| 25 | **2. Control and safety** | Ask before acting · Stopped by a hook · A file that gives orders · Take it back | |
| 10 | Break | | |
| 20 | **3. Size and cost** | Watch the history grow · Fifty tools · Find a tool first | Long reading, short memory · Three cities at once · Second call is cheaper (needs the Anthropic API) |
| 15 | **4. Shaping the model** | Remember me · Change what a tool says it does | Think first · Answer as a form · Same chat, new model |
| 15 | **5. Bigger jobs** | Write, run, fix · Hand off to a helper | A chain of agents · Plan, then do · Find the refund policy · Instructions on demand · Tools from another program |
| 5 | End | **?** → **Quiz me** | |

### Which experiments need something extra

| Experiment | Needs |
|---|---|
| Second call is cheaper | the Anthropic API (paid per use): the mock can't cache, and DeepSeek caches on its own, so there is nothing to see there |
| Long reading, short memory | the mock or DeepSeek: the Anthropic API skips trimming |
| Watch the loop · Change what a tool says it does · Three cities at once · Remember me's "try next" | internet access to open-meteo.com (`get_weather`) |

### Which experiments change files or Memory

These leave something behind, so a second run (or the next attendee) doesn't start the same way:

| Experiment | What it leaves |
|---|---|
| Write, run, fix | fixes the bug in `workspace/scripts/totals.py`, so next time there is no bug to find |
| Ask before acting | a new `workspace/todo.txt`, which the model then finds next time |
| Take it back | a line added to `workspace/notes.md`, if you don't press "Rewind to here" |
| Remember me | a fact in Memory, sent with every later conversation |
| Experiments that change a setting (they say so, with Undo above the message box) | the setting, until you press Undo |

## Reset between demos

Pick the one that fits.

**A clean page for the next demo or attendee:** stop the lab (Ctrl+C, or `stop.bat`), then start it with
`start.bat -Fresh`. It runs the same page at the same address from a throwaway copy, with no saved Memory,
settings or conversations, and nothing done there reaches your real `data/`, `config/` or `workspace/`.
(Each copy stays in your temporary folder, which it names on start, so you can look at what changed.)
It copies `workspace/` as it is now, though, so restore the sample files first if they changed (next step);
`-Fresh` warns you when it sees changed files.

**Restore the sample files** (in a terminal, in the `harness-lab` folder):

```
git status workspace
git checkout -- workspace
```

`git status` lists what changed; `git checkout` puts the changed sample files back. It doesn't remove files
the model created, such as `todo.txt`: delete those by hand (they are the ones `git status` lists as
"untracked"). With a ZIP copy, unzip it again.

**Clear Memory:** Settings → Memory, and remove the facts there. **Reset all** in Settings doesn't touch
Memory. (Memory is saved in `data/profile.json`; deleting that file while the lab is stopped clears it too.)

**Clear what the browser keeps:** the experiment ticks, which explanations have been seen, and quiz answers
are kept by the browser for this address, so `-Fresh` doesn't clear them. **Settings → Display → Start over as
a new learner** clears them all at once, with one Undo. It also puts back a setting an experiment changed, if
its Undo is still waiting.

Not here yet: a printable handout of the experiments and quiz, and numbers on the experiment cards to point
the room at one.
