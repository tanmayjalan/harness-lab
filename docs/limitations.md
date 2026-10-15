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

## Models on your own server

Ollama and LM Studio answer the same requests, but a small open model isn't Claude:

- **Tools:** many models can't use them, and the call fails with the reason. Small ones that can still pick the
  wrong tool or skip it. Settings → Model marks the models Ollama says can't use tools; LM Studio doesn't say.
- **Prompt caching:** Ollama ignores the cache marks but reuses the start of the last request by itself, and
  reports that as read from cache, so you see cache hits with caching on or off (as with DeepSeek).
- **Thinking:** sent as a budget, but Ollama doesn't hold the model to it, and a model that can't think may
  refuse the call.
- **Token counts** come from the server: Ollama's are approximate. There's no cost: it runs on your machine.
- **The context window** is whatever the server gives the model, often much smaller than Claude's, and some
  servers cut a long conversation without saying so.
- Tried live with Ollama only; LM Studio and other servers are covered by offline tests with a stand-in server.

## Not tried live

Written for the Anthropic API but **not tried live** (no API key was available):

- strict tool inputs (`"strict": true`, sent only to Anthropic);
- summarising on Anthropic;
- adaptive thinking with an effort level;
- prompt caching marks.

They're covered by offline tests of the request the harness builds. The DeepSeek context window (1M tokens)
comes from third-party listings; the Claude ones from Claude's docs.
