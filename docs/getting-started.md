# Getting started

The lab runs on Windows only, because `setup.bat`, `start.bat` and `stop.bat` are Windows batch files that run
PowerShell scripts, and they use the `.venv\Scripts` folder Python makes on Windows. The Python code isn't
known to fail elsewhere, but it hasn't been tried there.

You need these; `setup.bat` checks all of them except git and internet access:

| What | Why |
|---|---|
| **Python 3.10+** | runs the harness. `setup.bat` makes the lab's own Python folder (`.venv`) and installs [`requirements.txt`](../requirements.txt) into it |
| **git** | to get the code (`git clone`) and to put the sample files back after an experiment. Without it, use **Code → Download ZIP** on GitHub |
| **Claude Code** (`claude`), installed and signed in | the default provider, the *mock*: real Claude replies, sent through Claude Code (`claude -p`) instead of the API. It uses your Claude Code plan, at no extra charge, so no API key is needed |
| **Ollama** or **LM Studio** (optional) | free models on your own computer, instead of the mock or an API key: see [Models on your own computer](#models-on-your-own-computer) |
| **Node.js 26 or newer** (optional) | only to change the web page; the built page is already in git |
| **Internet access** to open-meteo.com | the `get_weather` tool looks the weather up there, and the first experiment uses it |

## Start and stop

| | |
|---|---|
| **`setup.bat`** | Run once first, or whenever something doesn't work: gets the lab ready and checks it (see below) |
| **`start.bat`** | Starts the web page at http://127.0.0.1:8000 and opens it |
| **`stop.bat`** | Stops the lab's servers, and nothing else (add `-List` to only see what it would stop) |

Double-click them, or run them from a terminal in the `harness-lab` folder (the one `git clone` made). In
PowerShell, Windows Terminal's usual shell, type `.\setup.bat`, `.\start.bat` and `.\stop.bat`: a plain
`setup.bat` isn't found there. They work even if PowerShell scripts are blocked on your computer. The real work
is done by the matching scripts in [`scripts/`](../scripts/).

### `setup.bat`

It checks, in order:

1. Python 3.10+ and the lab's own Python folder (`.venv`, made and filled if missing).
2. Claude Code, with one small `claude -p` call made exactly as the mock makes them (a few seconds of your
   plan).
3. The API keys (`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`), each tried with a free call that lists the
   service's models.
4. Ollama and LM Studio (optional): whether each is running on its usual address, and how many models it has.
   Then Node.js, and whether port 8000 is free.

It then says which `start.bat` commands will work. It offers to save each key: what you paste isn't shown,
Enter skips it (the mock needs no key), and it's saved for your Windows user, where `setx` would put it,
never in a file. Only the last 4 characters of a key are ever shown.

| Option | What it does |
|---|---|
| `-Check` | only reports: changes nothing, asks nothing |
| `-Quick` | skips the `claude -p` call and the key tests (so "Ready" then doesn't prove the mock works) |

### `start.bat`

| Option | What it does |
|---|---|
| `-Provider anthropic` | the Anthropic API (needs `ANTHROPIC_API_KEY`, paid per use) |
| `-Provider deepseek` | DeepSeek (needs `DEEPSEEK_API_KEY`, paid per use) |
| `-Provider ollama` | a model in Ollama, free (also `lmstudio`, and `custom` for another server). If it isn't running, the lab starts with the mock and says why |
| `-Real` | the same as `-Provider anthropic` |
| `-NoBrowser` | don't open the browser |
| `-NoBuild` | don't rebuild the page, even if `ui/` changed (see [Development](development.md#working-on-the-page)) |
| `-NoCheck` | don't check `claude -p` before starting (the mock only) |
| `-Fresh` | the same page at the same address, from a throwaway copy: no saved Memory, settings or conversations, and nothing you do reaches `data/`, `config/` or `workspace/`. For workshops and demos: see [Running a workshop](workshop.md) |

Run `setup.bat` before the first `start.bat`: it makes the lab's Python folder (`.venv`) and checks
everything. Without `.venv`, `start.bat` stops and says to run `setup.bat` first.

`start.bat` rebuilds the page only if you're working on it: when `ui\node_modules` exists (you ran
`npm install` in `ui\`) and a file in `ui\` is newer than the built page.

Without `-Provider` it uses the mock: real Claude replies from `claude -p`, on your Claude Code plan at no
extra charge, with no API key. Each model call takes about 5 to 30 s, and the page shows each call as it
happens. It first makes one small `claude -p` call to check that Claude Code is signed in, so a problem shows
there instead of on your first message. If `start.bat` stops with a problem, its window stays open so you can
read why. You can also switch provider, and for the mock the model (Opus, Sonnet or Haiku), in the page at any
time; the conversation is kept.

`-Fresh` copies `workspace/` as it is now, so restore the sample files first if an experiment changed them
([how](workshop.md#reset-between-demos)). Some progress is kept by your browser, not by the lab: the experiment
ticks, which explanations you have seen, and your quiz answers. `-Fresh` doesn't clear them; **Settings →
Display → Start over as a new learner** does, with one Undo.

### `stop.bat`

`stop.bat` only stops a process if it was started with this folder's own Python (`.venv`) **and** is one of
the lab's servers (the web server, the mock server, the demo MCP server). Other programs, and anything else
using the same ports, are never touched.

## Models on your own computer

[Ollama](https://ollama.com) and [LM Studio](https://lmstudio.ai) (0.4.1 or later) run open models on your own
computer. They take the same Anthropic-format requests as the Anthropic API, so the lab needs only their address:
the loop, the tools and the page are unchanged. It's free, and nothing you send leaves your computer.

1. Install one and get a model that can use tools, for example `ollama pull qwen3:4b`. In LM Studio, download a
   model and start the server (Developer tab).
2. Start the lab with `.\start.bat -Provider ollama` (or `lmstudio`), or pick it later in **Settings → Model**.

**Settings → Model → Models on your own server** shows each server's address, its models and, if it can't be
used, why. Change an address there if yours is different, or enter one for **Other server**: any server that takes
Anthropic-format requests at `/v1/messages`, on this computer or another (then your messages go to that
computer). The addresses are saved in `data/local_servers.json`. If your server asks for a key, set
`LOCAL_API_KEY` (`setx LOCAL_API_KEY "<key>"`); it is never saved in a file.

**Give Ollama a bigger window first.** On a computer without a graphics card of its own, Ollama gives each model a
window of only 4,096 tokens (the most it reads at once). The lab's instructions and tool list alone are about
2,000, so a conversation soon outgrows it, and Ollama then cuts the prompt to fit, with no error: it keeps the end
and drops the start, where the instructions and the tools are. The page marks such a call "prompt cut by the
server". To give every model a 32,768-token window, run this once, then quit Ollama and start it again:

```
setx OLLAMA_CONTEXT_LENGTH 32768
```

A bigger window uses more memory (about 2 GB in all for `gemma4:e4b` at 32,768). `ollama ps` shows each loaded
model's window (CONTEXT) and whether it runs on the graphics card or the processor (PROCESSOR).

What to expect: small models are slower, make more mistakes with tools, and many can't use tools at all (Settings
marks the ones Ollama says can't). On the processor alone, a call can take 20 seconds to a minute or more, and the
first call to a model waits for it to load. Ollama reuses the start of the last request by itself (it ignores the
lab's caching switch), and its token counts are approximate. With thinking off, the lab tells the model so
(`thinking: {type: "disabled"}`): some models, such as gemma4, otherwise think anyway, which is slower and keeps
the answer from streaming until the thinking is done. With thinking on, you can read the model's whole reasoning
under each call (**Show details**).

## If something goes wrong

| What you see | What to do |
|---|---|
| "Claude Code isn't signed in (or its sign-in has expired)", or the first message fails with an error about authenticating | Open a terminal, run `claude`, type `/login` and sign in. Then run `setup.bat` (without `-Quick`) to check, and start the lab again. |
| "The mock could not start claude -p" | Install Claude Code, run `claude` once in a terminal to sign in, then start the lab again. |
| "Port 8000 is already in use" | The lab is probably already running: use that window, or run `stop.bat` first. |
| "the web server did not start" | Scroll up in the same window: the Python error above that line says why. To see it on its own, run `.venv\Scripts\python -m harness.web.server` in the `harness-lab` folder. If it isn't clear what to fix, [open an issue](https://github.com/tanmayjalan/harness-lab/issues/new/choose) with that error. |
| "The provider rejected the API key" | Check `ANTHROPIC_API_KEY` or `DEEPSEEK_API_KEY`: run `setup.bat` to test and save it. |
| "Nothing answered at http://127.0.0.1:11434" (Ollama) or ":1234" (LM Studio) | Start Ollama (open the app, or run `ollama serve`), or in LM Studio start the server (Developer tab). Then press **Check again** in Settings → Model. |
| "…is running but has no models" | Get one: `ollama pull qwen3:4b`, or download one in LM Studio. |
| A call marked "prompt cut by the server", or a local model that forgets its tools or instructions in a long conversation | The server's window is too small. For Ollama, run `setx OLLAMA_CONTEXT_LENGTH 32768`, quit Ollama and start it again ([why](#models-on-your-own-computer)). In LM Studio, raise the model's context length when you load it. |
| "This model can't use tools" | The harness offers tools with every message, so pick a model that can use them (on ollama.com/search, filter by Tools). Settings → Model marks the ones Ollama says can't. |
| "The server doesn't take Anthropic-format requests" | Check the address. Update Ollama, or LM Studio to 0.4.1 or later. |
| The first experiment's weather lookup fails | `get_weather` needs the internet (open-meteo.com). Try another experiment, or another network. |
| Anything else | Run `setup.bat` again: it checks everything in order and says what to fix. |

## Next

- Follow the [learning path](learning-path.md): the experiments, in order.
- Read the [tour of the page](tour.md) to know where to look.
- Or open [`harness/core/loop.py`](../harness/core/loop.py) and read `agent()`: the whole loop is there.
