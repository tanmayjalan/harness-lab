"""Models on a server you run yourself: Ollama, LM Studio, or any other server that takes
Anthropic-format requests (POST /v1/messages).

The harness talks to them exactly as it talks to Anthropic; only the address changes. What this
file adds is what a cloud service doesn't need: the address you chose (saved in data/local_servers.json),
which models the server has, and a plain reason when it can't be used (not running, no models).
"""
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from harness import paths, saving
from harness.core import local_only

PATH = paths.DATA / "local_servers.json"  # {"ollama": "http://...", ...}: only the addresses you changed
TIMEOUT = 1.5      # seconds to wait for a local server to answer "which models do you have?"
CACHE_SECONDS = 5  # how long that answer is reused (the page asks for it often)

_lock = threading.Lock()
_found = {}  # address -> (when, result)
_tools = {}  # (address, model) -> True / False: can the model use tools (Ollama only; it never changes)


def load():
    """The saved addresses, by provider name."""
    try:
        saved = json.loads(PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {k: v for k, v in saved.items() if isinstance(v, str)} if isinstance(saved, dict) else {}


def save(name, url):
    """Save a provider's address (checked with clean_url first; raises ValueError with the reason)."""
    url = clean_url(url)
    saved = load()
    saved[name] = url
    saving.write_text(PATH, json.dumps(saved, indent=2))
    forget()
    return url


def clean_url(text):
    """An address as the SDK wants it: http(s)://host[:port][/path], without a trailing / or /v1
    (the SDK adds /v1/messages itself). Raises ValueError, in plain words, for anything else."""
    text = (text or "").strip()
    if not text:
        raise ValueError("Enter the server's address, for example http://127.0.0.1:11434.")
    if "://" not in text:
        text = "http://" + text
    parts = urllib.parse.urlsplit(text)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ValueError(f"{text} isn't a web address. It should look like http://127.0.0.1:11434.")
    if parts.query or parts.fragment:
        raise ValueError("Leave out anything after ? or # in the address.")
    try:
        parts.port  # noqa: B018  (raises ValueError for a port that isn't a number)
    except ValueError:
        raise ValueError(f"The port in {text} isn't a number.") from None
    path = parts.path.rstrip("/")
    if path.endswith("/v1"):
        path = path[:-3]
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, path, "", ""))


def is_this_computer(url):
    """True if the address is this computer (so nothing you send leaves it)."""
    host = (urllib.parse.urlsplit(url or "").hostname or "").lower()
    return host in local_only.NAMES or host == "::1"


def forget():
    """Ask the servers again next time (after an address changes, or when you press Check again)."""
    with _lock:
        _found.clear()


def _ask(url, key, body=None):
    headers = {"Accept": "application/json"}
    if key:  # LM Studio and others may require one; both header styles, as the SDK and OpenAI use
        headers.update({"x-api-key": key, "Authorization": f"Bearer {key}"})
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8"))


def discover(address, key=None, ollama=False, start_hint="", models_hint=""):
    """Which models the server at `address` has: {"models": [...], "no_tools": [...], "problem": None or
    the reason, in plain words, that it can't be used}. Asked again after CACHE_SECONDS."""
    if not address:
        return {"models": [], "no_tools": [], "problem": "No address yet: enter the server's address in Settings → Model."}
    with _lock:
        hit = _found.get(address)
        if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
            return hit[1]
    result = _discover(address, key, ollama, start_hint, models_hint)
    with _lock:
        _found[address] = (time.monotonic(), result)
    return result


def _discover(address, key, ollama, start_hint, models_hint):
    def problem(text):
        return {"models": [], "no_tools": [], "problem": text}

    try:
        answer = _ask(address + "/v1/models", key)
    except urllib.error.HTTPError as e:
        e.close()
        if e.code in (401, 403):
            return problem(f"The server at {address} wants a key. Set LOCAL_API_KEY "
                           '(setx LOCAL_API_KEY "<key>" in PowerShell), then restart the lab.')
        return problem(f"The server at {address} answered with error {e.code}. Is this the right address?")
    except (urllib.error.URLError, OSError):  # refused, timed out, no such host
        return problem(f"Nothing answered at {address}. {start_hint or 'Is the server running?'}".strip())
    except ValueError:
        return problem(f"The server at {address} answered, but not with a list of models. Is this the right address?")
    rows = answer.get("data") if isinstance(answer, dict) else None
    if not isinstance(rows, list):
        return problem(f"The server at {address} answered, but not with a list of models. Is this the right address?")
    names = [r["id"] for r in rows if isinstance(r, dict) and isinstance(r.get("id"), str) and r["id"]]
    if not names:
        return problem(f"The server at {address} is running but has no models. {models_hint}".strip())
    no_tools = [n for n in names if ollama and _can_use_tools(address, key, n) is False]
    # Models that can use tools first: the harness sends its tools with every call
    return {"models": [n for n in names if n not in no_tools] + no_tools, "no_tools": no_tools, "problem": None}


def _can_use_tools(address, key, model):
    """Ollama lists what each model can do (/api/show "capabilities"). None if it couldn't say."""
    with _lock:
        if (address, model) in _tools:
            return _tools[(address, model)]
    try:
        caps = _ask(address + "/api/show", key, {"model": model}).get("capabilities")
    except (urllib.error.URLError, OSError, ValueError, AttributeError):
        return None
    if not isinstance(caps, list):
        return None
    with _lock:
        _tools[(address, model)] = "tools" in caps
    return "tools" in caps
