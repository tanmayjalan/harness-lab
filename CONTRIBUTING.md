# Contributing

Thanks for helping. The lab exists to make an AI harness easy to understand, so the best changes keep it
small, readable and honest about what it shows. Everyone taking part is expected to follow the
[code of conduct](CODE_OF_CONDUCT.md).

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the idea.
- Read [How it's built](docs/architecture.md) to find where a change belongs.

## Set up

Follow [Getting started](docs/getting-started.md): `setup.bat` makes the lab's Python folder and checks
everything. Node.js 26 or newer is only needed if you change the page in [`ui/`](ui/).

## Guidelines

- **One idea per file.** A new add-on to the loop goes in its own file in
  [`harness/features/`](harness/features/).
- **Plain words.** The lab is for learning. In code comments, page text and docs, prefer the plain word; when a
  technical term is needed, say what it means beside it.
- **Show, don't hide.** If the harness does something (trims history, blocks a tool, retries), the page should
  let the learner see it.
- **Keep tests offline.** Tests must not call a model or the internet. Import
  [`tests/isolate.py`](tests/isolate.py) first in every test file so tests never touch real saved data.
- **Page changes:** run `npm run build` in `ui/` and commit the rebuilt `harness/web/static/` with your change.
- **Docs:** if you rename a heading, fix the links to it. `tests/test_docs.py` fails on broken links.

## Check your change

```
.venv\Scripts\python -m unittest discover -s tests
cd ui
npm install
npm run typecheck
npm run lint
npm test
```

The same checks run on every pull request ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Pull requests

- Keep each pull request to one change, and say what it does and why.
- Mention which experiment or screen it affects, with a screenshot for page changes.
- Never commit API keys, your `data/` folder, or anything personal. `data/` is ignored by git; keep it that way.
