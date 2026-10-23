"""Which AI service the harness talks to.

All of these accept Anthropic's message format, so the same `anthropic`
package and the same loop work with each; only the address, the key
and the model name change.
"""
import os
import re

import anthropic

from harness.core import local_models

PROVIDERS = {
    "anthropic": {
        "label": "Anthropic API",
        "base_url": None,  # the SDK's default (or ANTHROPIC_BASE_URL if set)
        "key_env": "ANTHROPIC_API_KEY",
        "model": "claude-opus-5-5",
        # Opus 5.5 always thinks; you choose the effort (low ... max) and see a summary of its reasoning
        "thinking": "adaptive",
        # US dollars per million tokens. Writing to the cache costs 1.25 x input; reading from it 0.05 x.
        "price": {"input": 4.00, "cached": 0.20, "cache_write": 5.00, "output": 20.00,
                  "note": "Claude Opus 5.5 list price"},
        # Where the prices and context windows above come from, and when they were last checked (shown on the page)
        "source": {"prices": "Anthropic's price list (as of 2026-10-06), platform.claude.com/docs/en/about-claude/pricing",
                   "windows": "Anthropic's model list, platform.claude.com/docs/en/models/overview", "checked": "2026-10-15"},
        # The most a model can take in on one call, in tokens (platform.claude.com/docs/en/models/overview,
        # checked 2026-10-15). Below 512 tokens (4,096 on Haiku 4.5) a prompt isn't cached at all.
        "context_windows": {"claude-opus-5-5": 1_000_000},
    },
    "deepseek": {
        "label": "DeepSeek",
        "base_url": "https://api.deepseek.com/anthropic",  # DeepSeek's Anthropic-format endpoint
        "key_env": "DEEPSEEK_API_KEY",
        "model": "deepseek-flash",  # the faster, cheaper one; "deepseek-v4-pro" is the larger model
        "thinking": "budget",  # a token budget (thinking: {type: "enabled", budget_tokens: N})
        # (1M tokens as listed by third-party model directories, 2026-10-04; check api-docs.deepseek.com)
        "context_windows": {"deepseek-flash": 1_000_000},
        "price": {"input": 0.30, "cached": 0.006, "output": 1.20,
                  "note": "DeepSeek peak price, checked 2026-10-03; off-peak is half"},
        "source": {"prices": "DeepSeek's price list, api-docs.deepseek.com: the peak price; off-peak is half",
                   "windows": "third-party model directories, not DeepSeek itself", "checked": "2026-10-03"},
    },
    "mock": {
        "label": "Mock: replies from claude -p",
        "base_url": "http://127.0.0.1:8765",  # mock_server.py
        "key_env": None,
        "model": "claude-opus-5-5",
        # `claude -p --model` takes any of these; pick one on the page (Settings → Model, or Compare)
        "models": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5-20251001"],
        "thinking": "budget",  # claude -p takes a budget (MAX_THINKING_TOKENS)
        "context_windows": {"claude-opus-5-5": 1_000_000, "claude-sonnet-5-5": 1_000_000,
                            "claude-haiku-4-5-20251001": 200_000},  # the models it imitates (see above)
        "price": None,
        # The mock only estimates tokens (characters / 4), priced as if the real model had answered.
        # List prices from Anthropic's model list; writing to the cache is 1.25 x input (worked out, not listed)
        "model_prices": {
            "claude-opus-5-5": {"input": 4.00, "cached": 0.20, "cache_write": 5.00, "output": 20.00},
            "claude-sonnet-5-5": {"input": 2.00, "cached": 0.20, "cache_write": 2.50, "output": 10.00},
            "claude-haiku-4-5-20251001": {"input": 1.00, "cached": 0.10, "cache_write": 1.25, "output": 5.00},
        },
        "source": {"prices": "Anthropic's price list (as of 2026-10-06), platform.claude.com/docs/en/about-claude/pricing, "
                             "as if the real model had answered",
                   "windows": "Anthropic's model list, platform.claude.com/docs/en/models/overview", "checked": "2026-10-15"},
    },
    # Models on a server you run (local_models.py). Each takes Anthropic-format requests at /v1/messages
    # (Ollama: docs.ollama.com/api/anthropic-compatibility; LM Studio 0.4.1 and later:
    # lmstudio.ai/docs/developer/anthropic-compat). The models are whatever the server has; you change the
    # address in Settings → Model (saved in data/local_servers.json). LOCAL_API_KEY, if set, is sent as the key.
    "ollama": {
        "label": "Ollama",
        "local": True,
        "base_url": "http://127.0.0.1:11434",
        "key_env": None,
        "model": None,  # the first model the server lists (providers.default_model)
        "thinking": "budget",  # accepted, but Ollama doesn't hold the model to the budget
        "price": None,
        "start_hint": "Start Ollama (open the app, or run ollama serve in a terminal).",
        "models_hint": "Get one with ollama pull, for example ollama pull qwen3:4b.",
        "source": {"prices": "none: the model runs on a machine you control",
                   "windows": "the server's own settings for each model", "checked": "2026-10-15"},
    },
    "lmstudio": {
        "label": "LM Studio",
        "local": True,
        "base_url": "http://127.0.0.1:1234",
        "key_env": None,
        "model": None,
        "thinking": "budget",
        "price": None,
        "start_hint": "In LM Studio, open the Developer tab and start the server.",
        "models_hint": "Download one in LM Studio (the Discover tab).",
        "source": {"prices": "none: the model runs on a machine you control",
                   "windows": "the server's own settings for each model", "checked": "2026-10-15"},
    },
    "custom": {
        "label": "Other server",
        "local": True,
        "base_url": None,  # you enter it
        "key_env": None,
        "model": None,
        "thinking": "budget",
        "price": None,
        "start_hint": "Is the server running?",
        "models_hint": "",
        "source": {"prices": "none: the model runs on a machine you control",
                   "windows": "the server's own settings for each model", "checked": "2026-10-15"},
    },
}

LOCAL_KEY = "LOCAL_API_KEY"  # optional: for a local server that asks for a key (Ollama ignores it)


def is_local(name):
    """True for a server you run yourself (Ollama, LM Studio, another)."""
    return bool(PROVIDERS.get(name, {}).get("local"))


def address_of(name):
    """The address the provider is reached at: the one you saved (local servers), else its own."""
    p = PROVIDERS[name]
    if is_local(name):
        return local_models.load().get(name) or p["base_url"]
    return p["base_url"]


def local_status(name):
    """What a local server has: {"models", "no_tools", "problem"} (see local_models.discover)."""
    p = PROVIDERS[name]
    return local_models.discover(address_of(name), key=get_key(LOCAL_KEY), ollama=name == "ollama",
                                 start_hint=p.get("start_hint", ""), models_hint=p.get("models_hint", ""))


def default_model(name):
    """The model used when none is picked: the provider's own, or the first one a local server lists."""
    p = PROVIDERS[name]
    if p.get("model"):
        return p["model"]
    found = models(name)
    return found[0] if found else None


def unavailable(name):
    """None if the provider can be used now, otherwise why not, in plain words."""
    if is_local(name):
        return local_status(name)["problem"]
    key = missing_key(name)
    return f"{PROVIDERS[name]['label']} needs {key} set." if key else None


def models(name):
    """The models you can pick for a provider: its own list, or just its one model, or (a local server)
    the models it has now."""
    p = PROVIDERS[name]
    if is_local(name):
        return list(local_status(name)["models"])
    return list(p.get("models") or [p["model"]])


def tools_for(name, tools):
    """The tool list as this provider should get it: "strict" (a guaranteed input shape) is an
    Anthropic API option, so it's left out for the others."""
    if name == "anthropic":
        return tools
    return [{k: v for k, v in t.items() if k != "strict"} for t in tools]


def thinking_style(name):
    """How a provider takes thinking: "adaptive" (an effort level) or "budget" (a token budget)."""
    return PROVIDERS.get(name, {}).get("thinking", "budget")


def price(name, model=None):
    p = PROVIDERS.get(name, {})
    return (p.get("model_prices") or {}).get(model) or p.get("price")


def cost(name, usage, model=None):
    """Estimated dollars for one call, from the token counts the provider reported. None if unknown."""
    rates = price(name, model)
    if not rates or not usage:
        return None
    fresh = usage.get("input_tokens") or 0
    written = usage.get("cache_creation_input_tokens") or 0  # writing to the cache costs a little more
    cached = usage.get("cache_read_input_tokens") or 0       # reading from it costs much less
    out = usage.get("output_tokens") or 0
    return (fresh * rates["input"] + written * rates.get("cache_write", rates["input"])
            + cached * rates["cached"] + out * rates["output"]) / 1_000_000


class MissingKey(Exception):
    """The provider can't be used yet (its key isn't set, or a local server has no address).
    An ordinary error, so `except Exception` catches it; the command-line start-ups (cli.py, evals.py and
    the web server's) turn it into a plain message instead of a traceback."""


def get_key(env_name):
    """The key from this process's environment, or else one saved with `setx`.

    `setx` only reaches programs started after it, so also read the saved
    value directly (Windows keeps it in the registry under HKCU\\Environment).
    """
    return os.environ.get(env_name) or saved_key(env_name)


def saved_key(env_name):
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
            return winreg.QueryValueEx(k, env_name)[0] or None
    except (ImportError, OSError):  # not Windows, or not saved
        return None


def missing_key(name):
    """None if the provider can be used, otherwise the name of the key it needs."""
    p = PROVIDERS[name]
    if p["key_env"] and not get_key(p["key_env"]):
        return p["key_env"]
    return None  # mock needs no key


def make_client(name, base_url=None, api_key=None):
    """An SDK client for the named provider. Raises MissingKey with instructions if its key is missing.
    `api_key` overrides the key (the mock's own random key, from mock_server.serve)."""
    p = PROVIDERS[name]
    if is_local(name):
        # No network here (the server is asked for its models elsewhere): only the address and the key
        address = base_url or address_of(name)
        if not address:  # without one the SDK would quietly use Anthropic's own address
            raise MissingKey(f"{p['label']} has no address yet. Enter it in Settings → Model.")
        key = api_key or get_key(LOCAL_KEY) or "local"  # Ollama and LM Studio accept any key unless told not to
        return anthropic.Anthropic(api_key=key, base_url=address, max_retries=0)
    if missing_key(name):
        raise MissingKey(
            f"{p['label']} needs {p['key_env']} set. In PowerShell run:\n"
            f'  setx {p["key_env"]} "<your key>"'
        )
    # The mock checks a key too: the one mock_server.serve made (api_key), or MOCK_KEY for a mock you
    # started yourself with that variable set
    key = api_key or (get_key(p["key_env"]) if p["key_env"] else os.environ.get("MOCK_KEY") or "no-key-given")
    # No quiet retries in the SDK: the loop tries again itself, so you see each retry (loop.retry_reason).
    # (Summarising and the eval judge ask for quiet retries for their own calls: with_quiet_retries.)
    return anthropic.Anthropic(api_key=key, base_url=base_url or p["base_url"], max_retries=0)


def with_quiet_retries(client):
    """The same client, trying a failed call again by itself (up to 2 times): for calls that aren't the
    lesson, such as summarising and the eval judge. Test stand-ins without with_options are used as they are."""
    return client.with_options(max_retries=2) if hasattr(client, "with_options") else client


# Plain words for the provider errors a learner is likely to meet, with what to do about them.
# None for anything else: then the page shows the error's own text.
def plain_error(text):
    t = text.lower()
    if "claude was not found" in t or "claude: command not found" in t:
        return ("The mock could not start claude -p. Install Claude Code and sign in "
                "(run claude once in a terminal), then try again.")
    # claude -p's own sign-in failing (checked before the API-key rule: the mock needs no API key)
    if "failed to authenticate" in t or "oauth" in t or "session expired" in t or "please run /login" in t:
        return ("Claude Code isn't signed in (or its sign-in has expired), so the mock can't get a reply. "
                "Run claude once in a terminal, sign in, then try again.")
    if "for this mock server" in t:  # the mock refused the request itself: its key didn't match (MOCK_KEY)
        return ("The mock refused the request: the key didn't match. If you started the mock yourself, set "
                "MOCK_KEY to the key it printed; the lab's own mock needs nothing.")
    # A model on your own server (Ollama, LM Studio) that can't do what the harness asks
    if "does not support tools" in t or "does not support tool" in t:
        return ("This model can't use tools, and the harness offers tools with every message. "
                "Pick another model, or get one that can (on ollama.com/search, filter by Tools).")
    if "does not support thinking" in t:
        return "This model can't think step by step. Turn thinking off (Settings → Model), or pick another model."
    if "try pulling it first" in t:
        return "The server doesn't have that model. Get it first (ollama pull <name>), then try again."
    if "404 page not found" in t or "unexpected endpoint" in t:
        return ("The server doesn't take Anthropic-format requests at /v1/messages. Check the address; "
                "if it's Ollama or LM Studio, update it (LM Studio needs 0.4.1 or later).")
    if "authentication" in t or "invalid api key" in t or "invalid x-api-key" in t or "error code: 401" in t:
        return ("The provider rejected the API key. Check ANTHROPIC_API_KEY or DEEPSEEK_API_KEY "
                "(or LOCAL_API_KEY for your own server; setx NAME \"key\" in PowerShell), then try again.")
    if "error code: 429" in t or "rate limit" in t:
        return "The provider says there were too many requests. Wait a minute and try again."
    limit = re.search(r"hit max_turns \((\d+)\)", text)
    if limit:  # the loop's own limit (Settings → Model → limits), not a provider problem
        return f"Stopped after {limit.group(1)} model calls: the most allowed for one message."
    if "error code: 529" in t or "overloaded" in t:
        return "The provider is overloaded right now. The harness tried again; wait a minute and send it again."
    if "error code: 503" in t or "service unavailable" in t:
        return "The provider is unavailable right now. Wait a minute and try again."
    if "apitimeouterror" in t or "timed out" in t:
        return "The provider took too long to answer. Try again; a shorter message may help."
    if "connection refused" in t or "connecterror" in t or "apiconnectionerror" in t:
        return ("Could not reach the provider. With the mock, restart start.bat; with Ollama or LM Studio, "
                "check that it is running; otherwise check your internet.")
    return None


def error_event(e):
    """The fields of an "error" event: plain words when the cause is known, the raw text as detail."""
    raw = f"{type(e).__name__}: {e}"
    plain = plain_error(raw)
    return {"message": plain, "detail": raw} if plain else {"message": raw}
