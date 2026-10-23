# Security

The Harness lab is a learning tool that runs on your own computer. It lets a model read files, call tools and,
if you allow it, run code as you. What it protects against, and what it doesn't, is described in
[Safety rules](docs/safety.md). Please read that page before reporting.

## Reporting a problem

If you find a way around one of those rules (for example, a file tool reaching outside `workspace/` without
asking, a tool running without approval when it should ask, or a secret leaking into a saved file), please
report it privately through GitHub:
**[Report a vulnerability](https://github.com/tanmayjalan/harness-lab/security/advisories/new)**.

Please don't open a public issue for it. Include the steps to reproduce it and which provider you used.

I aim to reply within 7 days. Only the latest `main` is supported.

Known limits listed on the safety page (for example, that `run_python` is not a sandbox, or that the example
hook's text check is easy to get around) are by design and don't need a report. One of them: the web page's
server has no password. It listens only on this computer (127.0.0.1) and refuses requests from other websites,
but another program, or another Windows user on the same computer, could send it requests. Don't run the lab
on a computer you share with people you don't trust.
