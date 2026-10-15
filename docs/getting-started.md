# Getting started

The lab runs on Windows. You need three things, and `setup.bat` checks all of them:

| What | Why |
|---|---|
| **Python 3.10+** | runs the harness. `setup.bat` makes the lab's own Python folder (`.venv`) and installs [`requirements.txt`](../requirements.txt) into it |
| **Claude Code** (`claude`), installed and logged in | the default provider, the *mock*, gets its replies from `claude -p` on your Claude Code plan: no API key needed |
| **Node.js** (optional) | only to change the web page; the built page is already in git |

## Start and stop

| | |
|---|---|
| **`setup.bat`** | Run once first, or whenever something doesn't work: gets the lab ready and checks it (see below) |
| **`start.bat`** | Starts the web page at http://127.0.0.1:8000 and opens it |
| **`stop.bat`** | Stops the lab's servers, and nothing else (add `-List` to only see what it would stop) |

Double-click them, or run them from a terminal in the Harness folder. They work even if PowerShell scripts
are blocked on your computer. The real work is done by the matching scripts in [`scripts/`](../scripts/).

### `setup.bat`

It checks, in order:

1. Python 3.10+ and the lab's own Python folder (`.venv`, made and filled if missing).
2. Claude Code, with one small `claude -p` call made exactly as the mock makes them (a few seconds of your
   plan).
3. The API keys (`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`), each tried with a free call that lists the
   service's models.
4. Node.js, and whether ports 8000 and 8765 are free.

It then says which `start.bat` commands will work. It offers to save each key: what you paste isn't shown,
Enter skips it (the mock needs no key), and it's saved for your Windows user, where `setx` would put it,
never in a file. Only the last 4 characters of a key are ever shown.

| Option | What it does |
|---|---|
| `-Check` | only reports: changes nothing, asks nothing |
| `-Quick` | skips the `claude -p` call and the key tests |

### `start.bat`

| Option | What it does |
|---|---|
| `-Provider anthropic` | the Anthropic API (needs `ANTHROPIC_API_KEY`, paid per use) |
| `-Provider deepseek` | DeepSeek (needs `DEEPSEEK_API_KEY`, paid per use) |
| `-NoBrowser` | don't open the browser |
| `-NoBuild` | don't rebuild the page, even if `ui/` changed (see [Development](development.md#working-on-the-page)) |

Without `-Provider` it uses the mock: real replies from `claude -p` on your Claude Code plan, no API key
needed. You can also switch provider, and for the mock the model (Opus, Sonnet or Haiku), in the page at any
time; the conversation is kept.

### `stop.bat`

`stop.bat` only stops a process if it was started with this folder's own Python (`.venv`) **and** is one of
the lab's servers (the web server, the mock server, the demo MCP server). Other programs, and anything else
using the same ports, are never touched.

## Next

- Follow the [learning path](learning-path.md): the experiments, in order.
- Read the [tour of the page](tour.md) to know where to look.
- Or open [`harness/core/loop.py`](../harness/core/loop.py) and read `agent()`: the whole loop is there.
