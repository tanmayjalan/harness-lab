# Development

## Other ways to run it

Run these from the `harness-lab` folder:

| Command | What it does |
|---|---|
| `.venv\Scripts\python -m harness.cli` | the terminal version, on the mock as the page is (`--provider deepseek` or `--provider anthropic` for a paid service). It uses your page settings and the same tools, MCP ones included; it always uses the provider's default model, and "From your next conversation" doesn't apply |
| `.venv\Scripts\python -m harness.evals --provider mock` | the 16 eval questions, judged by the mock |
| `.venv\Scripts\python -m harness.evals --provider mock --only weather` | just some of them |
| `.venv\Scripts\python -m harness.evals --provider mock --repeat 3` | each question 3 times: pass rates |
| `.venv\Scripts\python -m harness.evals --provider ollama --judge mock` | the questions on a model in Ollama (also `lmstudio`, `custom`), judged by the mock |
| `.venv\Scripts\python -m harness.web.sandbox` | the page on a throwaway copy of your data (port 8100) |
| `.venv\Scripts\python -m harness.web.sandbox --empty` | the same, starting with no saved data at all |

## Tests

```
.venv\Scripts\python -m unittest discover -s tests
```

The tests are offline: they make no model calls. They never touch your real profile, settings,
conversations, hooks or workspace (see [`tests/isolate.py`](../tests/isolate.py)).
[`tests/test_docs.py`](../tests/test_docs.py) checks that every link in these Markdown pages leads somewhere.

## Working on the page

The page's source is in [`ui/`](../ui/) (React, TypeScript and Tailwind, built with Vite). The built result is
in [`harness/web/static/`](../harness/web/static/) and kept in git, so you only need Node.js (26 or newer) to
change the page.

```
cd ui
npm install            once
npm run dev            a live-reloading copy at http://localhost:5173 (start the lab first: it talks to port 8000)
npm test               the page's tests
npm run typecheck      check the TypeScript
npm run build          rebuild harness/web/static
```

`start.bat` rebuilds the page by itself when a file in `ui/` is newer than the build (and npm is installed);
`-NoBuild` skips that. If you change the page, commit the rebuilt `harness/web/static/` with it.

## Continuous integration

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs the Python tests and the page's type check and
tests on Windows for every pull request and every push to `main`.

## Adding to the lab

- **A tool:** add what the model is told about it to `TOOLS`, and the code that runs it, in
  [`harness/core/tools.py`](../harness/core/tools.py). Practice tools go in `TOOLS` and `HANDLERS` in
  [`toy_tools.py`](../harness/core/toy_tools.py), which `tools.py` includes. If it should ask first, add it to
  `DEFAULT_PERMISSIONS` in [`loop.py`](../harness/core/loop.py).
- **A feature:** one idea per file in [`harness/features/`](../harness/features/). Look at how an existing
  one is used (for example, `planning.py` is offered and run from `tools.py`) and follow the same pattern.
- **A hook, a skill, an MCP server or an eval question:** edit the files in [`config/`](../config/); no code
  changes needed.

See [CONTRIBUTING.md](../CONTRIBUTING.md) before opening a pull request.
