# What the mock can't show, and what hasn't been tried live

## The mock

The mock gets real replies from `claude -p`, but it isn't the API, so some things are imitated:

- **Token counts** are estimates (about 4 characters per token), marked ≈ in the page. Tokens out leave out
  thinking (`claude -p` doesn't return its text), so tokens out and cost are a lower bound; the page shows
  `claude -p`'s own count, thinking included, beside them when it has one.
- **The request the model receives** isn't the one in the Raw tab. The mock writes the system prompt, the tool
  definitions and the conversation into one text prompt for `claude -p`, asks for the reply in a fixed JSON
  shape, and makes up the ids of tool requests. The Raw tab shows what the harness sent to the mock, which is
  what it would send to the real API.
- **The longest-reply limit** is applied by the mock cutting the reply text; the real API stops the model
  itself. The lesson (stop reason `max_tokens`, half-finished tool requests) is the same.
- **Prompt caching** doesn't happen on the mock.

## Not tried live

Written for the Anthropic API but **not tried live** (no API key was available):

- strict tool inputs (`"strict": true`, sent only to Anthropic);
- summarising on Anthropic;
- adaptive thinking with an effort level;
- prompt caching marks.

They're covered by offline tests of the request the harness builds. The DeepSeek context window (1M tokens)
comes from third-party listings; the Claude ones from Claude's docs.
