r"""A stand-in for the Anthropic API that gets its replies from `claude -p`.

The harness talks to this server exactly as it would talk to the real API.
For each request, the server writes the conversation and tool list into a
prompt, asks headless Claude Code (`claude -p`) for the next turn as JSON,
and sends that back shaped like a real Messages API reply, tool calls included.

Real replies, no API key: it runs on your Claude Code login instead.

Run:   .venv\Scripts\python -m harness.core.mock_server   (listens on http://127.0.0.1:8765 and prints its key)
Then:  set ANTHROPIC_BASE_URL=http://127.0.0.1:8765 and ANTHROPIC_API_KEY=<the key it printed>
       in the window where you run your own Anthropic-SDK code. (Set MOCK_KEY first to choose the key.)
       (The web page, terminal version and evals start their own copy, so you rarely need this.)
Check: .venv\Scripts\python -m harness.core.mock_server --check   (one small `claude -p` call; setup.bat runs it)

Only the harness may use it: a request must be addressed to this computer (127.0.0.1), be JSON and carry
the key. Each run spends your Claude Code plan, and any web page you visit can send requests to this computer.
"""
import hmac
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from harness.core import local_only

PORT =int(os.environ.get("MOCK_PORT", "8765"))
MAX_BODY = 64 * 1024 * 1024  # the largest request accepted (a 1M-token history is a few MB of text)
CLAUDE_TIMEOUT = 300  # seconds to wait for one `claude -p` reply

# The shape we ask `claude -p` to answer in
def reply_schema(tool_names):
    name = {"type": "string"}
    if tool_names:
        name["enum"] = tool_names
    return {
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "What the assistant says. May be empty when calling tools."},
            "tool_calls": {
                "type": "array",
                "description": "Tools to call now. Empty when giving a final answer.",
                "items": {
                    "type": "object",
                    "properties": {"name": name, "input": {"type": "object"}},
                    "required": ["name", "input"],
                },
            },
        },
        "required": ["text", "tool_calls"],
    }


INSTRUCTIONS = """\
You are the AI assistant inside a program (a "harness") that someone is testing.
The harness owns the tools listed below; you cannot run them yourself.
To use a tool, put it in `tool_calls`. The harness runs it and the result
appears in the conversation on your next turn. Never invent tool results.

Write ONLY the assistant's next turn:
- To answer, put the answer in `text` and leave `tool_calls` empty.
- To use tools, list them in `tool_calls` (a short `text` is optional) and stop.
Follow the harness's own instructions below as if they were your system prompt."""


def block_to_text(block):
    kind = block.get("type")
    if kind == "text":
        return block["text"]
    if kind == "tool_use":
        return f"[tool call {block['id']}: {block['name']}({json.dumps(block['input'])})]"
    if kind == "tool_result":
        content = block.get("content", "")
        if isinstance(content, list):
            content = "\n".join(c.get("text", "") for c in content if c.get("type") == "text")
        label = " (ERROR)" if block.get("is_error") else ""
        return f"[tool result for {block['tool_use_id']}{label}]\n{content}"
    if kind in ("thinking", "redacted_thinking"):
        return ""  # another model's private reasoning (e.g. DeepSeek's); not part of the conversation
    return f"[{kind} block omitted]"


def content_to_text(content):
    if isinstance(content, str):
        return content
    return "\n".join(block_to_text(b) for b in content)


def system_to_text(system):
    if not system:
        return "(none)"
    if isinstance(system, str):
        return system
    return "\n".join(b.get("text", "") for b in system)


def build_prompt(request):
    tools = [
        {"name": t["name"], "description": t.get("description", ""), "input_schema": t.get("input_schema", {})}
        for t in request.get("tools", [])
    ]
    turns = "\n\n".join(
        f"### {m['role']}\n{content_to_text(m['content'])}" for m in request["messages"]
    )
    return (
        f"{INSTRUCTIONS}\n\n"
        f"## Harness system prompt\n{system_to_text(request.get('system'))}\n\n"
        f"## Tools you may call\n{json.dumps(tools, indent=2) if tools else '(none)'}\n\n"
        f"## Conversation so far\n{turns}"
    )


def to_api_message(answer, model):
    """Turn {"text", "tool_calls"} into a Messages API reply."""
    content = list(answer.get("thinking") or [])  # thinking comes first, as from the real API
    if answer.get("text", "").strip():
        content.append({"type": "text", "text": answer["text"]})
    for call in answer.get("tool_calls", []):
        content.append({
            "type": "tool_use",
            "id": f"toolu_mock_{uuid.uuid4().hex[:20]}",
            "name": call["name"],
            "input": call.get("input", {}),
        })
    if not content:
        content.append({"type": "text", "text": ""})
    return {
        "id": f"msg_mock_{uuid.uuid4().hex[:20]}",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": "tool_use" if answer.get("tool_calls") else "end_turn",
        "stop_sequence": None,
        "usage": {"input_tokens": 0, "output_tokens": 0},
    }


def ask_claude(request):
    """Run `claude -p` once and return {"text", "tool_calls"}."""
    claude = shutil.which("claude")
    if not claude:
        raise RuntimeError("`claude` was not found on PATH")
    tool_names = [t["name"] for t in request.get("tools", [])]
    args = [
        claude, "-p",
        "--output-format", "stream-json", "--verbose",  # every step, so tool attempts can be seen
        "--json-schema", json.dumps(reply_schema(tool_names)),
        "--tools", "",                    # Claude Code's own tools off: only the harness's tools count
        "--strict-mcp-config",            # no MCP servers
        "--setting-sources", "project",   # skip your user settings, hooks and plugins
        "--no-session-persistence",
        "--system-prompt", "You produce the next assistant turn for a program under test.",
    ]
    if request.get("model"):
        args += ["--model", request["model"]]

    # The harness window has ANTHROPIC_BASE_URL pointing here and a fake key.
    # If `claude -p` inherited them it would call this server, or fail to log in.
    env = {k: v for k, v in os.environ.items() if k not in ("ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY")}
    # Thinking: claude -p reads its budget from MAX_THINKING_TOKENS (0 = don't think)
    thinking = request.get("thinking") or {}
    env["MAX_THINKING_TOKENS"] = str(thinking.get("budget_tokens", 0) if thinking.get("type") == "enabled" else 0)

    with tempfile.TemporaryDirectory() as empty_dir:  # no project files for it to pick up
        done = subprocess.run(
            args, input=build_prompt(request), capture_output=True, text=True,
            encoding="utf-8", env=env, cwd=empty_dir, timeout=CLAUDE_TIMEOUT,
        )
    if done.returncode != 0:
        raise RuntimeError(f"claude -p exited {done.returncode}: {failure_reason(done.stdout, done.stderr)}")
    return read_reply(done.stdout, tool_names)


def failure_reason(stdout, stderr):
    """Why `claude -p` failed, in its own words. Its output starts with a long setup line (folders, tool and
    command names), and the reason ("Failed to authenticate: …") is near the end, so look there first."""
    for line in reversed((stdout or "").splitlines()):
        try:
            step = json.loads(line)
        except ValueError:
            continue
        if not isinstance(step, dict):
            continue
        if step.get("type") == "result" and isinstance(step.get("result"), str) and step["result"].strip():
            return step["result"].strip()[:500]
        if step.get("type") == "assistant":
            said = " ".join(b.get("text", "") for b in (step.get("message") or {}).get("content") or []
                            if isinstance(b, dict) and b.get("type") == "text").strip()
            if said:
                return said[:500]
    return ((stderr or "").strip() or (stdout or "").strip())[:500] or "no reason given"


def read_reply(stream, tool_names):
    """Work out the reply from `claude -p`'s step-by-step output (one JSON object per line).

    Normally the answer is the structured reply at the end. But some models (Haiku, often) try
    to call a harness tool directly instead of listing it in tool_calls; Claude Code refuses
    ("No such tool") and the model then gives up on the tool. That first attempt is exactly the
    tool request the harness wants, so it's used as the reply.
    """
    steps = [json.loads(line) for line in stream.splitlines() if line.strip().startswith("{")]
    attempts, said, thought = [], [], []
    for step in steps:
        if step.get("type") == "user" and attempts:
            break  # Claude Code has answered the attempt: anything after is the model giving up
        if step.get("type") != "assistant":
            continue
        for block in (step.get("message") or {}).get("content") or []:
            if block.get("type") == "thinking":  # (claude -p leaves the text out; the block shows it thought)
                thought.append({"type": "thinking", "thinking": block.get("thinking") or "",
                                "signature": block.get("signature") or "mock"})
            elif block.get("type") == "text" and block.get("text", "").strip():
                said.append(block["text"].strip())
            elif block.get("type") == "tool_use" and block.get("name") in tool_names:
                attempts.append({"name": block["name"], "input": block.get("input") or {}})
    result = next((x for x in reversed(steps) if x.get("type") == "result"), None)
    if result is None:
        raise RuntimeError("claude -p gave no result")
    if result.get("is_error"):
        raise RuntimeError(f"claude -p reported an error: {result.get('result')}")
    # claude -p's own time minus the model's: the cost of starting it, which a real API doesn't have
    overhead = max(0, (result.get("duration_ms") or 0) - (result.get("duration_api_ms") or 0)) or None
    if attempts:
        return {"text": "\n\n".join(said), "tool_calls": attempts, "thinking": thought, "overhead_ms": overhead}
    answer = result.get("structured_output")
    if not isinstance(answer, dict):  # no structured reply: treat the plain text as the answer
        answer = {"text": str(result.get("result", "")), "tool_calls": []}
    return {**answer, "thinking": thought, "overhead_ms": overhead}


class Handler(BaseHTTPRequestHandler):
    key = None  # the key a request must carry (set by serve()); with none set, every request is refused

    def do_POST(self):
        if self.path.split("?")[0] != "/v1/messages":
            return self.send_json(404, error("not_found_error", f"mock server only serves /v1/messages, not {self.path}"))
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = -1
        if not 0 <= length <= MAX_BODY:  # refuse before reading: a page could send gigabytes
            self.close_connection = True
            return self.send_json(413 if length > MAX_BODY else 400,
                                  error("invalid_request_error", f"Content-Length must be 0 to {MAX_BODY} bytes"))
        body = self.rfile.read(length)  # read before refusing: unread bytes reset the connection
        refused = self.refusal()
        if refused:
            return self.send_json(*refused)
        request = json.loads(body)
        if request.get("stream"):
            return self.send_json(400, error("invalid_request_error", "mock server does not support streaming"))

        started = time.time()
        try:
            answer, cut = apply_limit(fit_inputs(ask_claude(request), request.get("tools")), request.get("max_tokens"))
            reply = to_api_message(answer, request.get("model", "mock"))
            if cut:
                reply["stop_reason"] = "max_tokens"
        except Exception as e:
            print(f"  mock: claude -p failed, so the harness gets an error: {type(e).__name__}: {e}", file=sys.stderr)
            if "overloaded" in str(e).lower():  # the real service behind claude -p is busy: say so, as the API does
                return self.send_json(529, error("overloaded_error", str(e)), headers={"retry-after": "1"})
            # anything else: trying again straight away won't help, and each try is slow
            return self.send_json(500, error("api_error", str(e)), headers={"x-should-retry": "false"})

        reply["usage"] = estimate_usage(request, reply)
        if answer.get("overhead_ms"):
            reply["usage"]["mock_overhead_ms"] = answer["overhead_ms"]
        calls = [b["name"] for b in reply["content"] if b["type"] == "tool_use"]
        n = len(request["messages"])
        what = (f"it asked for {'a tool' if len(calls) == 1 else 'tools'}: {', '.join(calls)}" if calls
                else "the reply was cut off at the longest-reply limit" if reply["stop_reason"] == "max_tokens"
                else "it answered")
        print(f"  mock: {n} message{'' if n == 1 else 's'} in; {what} ({time.time() - started:.1f}s)")
        self.send_json(200, reply)

    def refusal(self):
        """Why this request may not use the mock, or None. Each run spends your Claude Code plan, so only the
        harness may ask: any web page you visit can send a request to 127.0.0.1, but it can't set the right
        Host, send JSON without the browser asking this server first, or know the key."""
        if not local_only.addressed_here(self.headers):
            return 403, error("permission_error", "use http://127.0.0.1")
        if (self.headers.get("Content-Type") or "").split(";")[0].strip().lower() != "application/json":
            return 415, error("invalid_request_error", "send JSON (Content-Type: application/json)")
        sent = (self.headers.get("x-api-key") or "").encode("utf-8", "surrogateescape")  # bytes: any characters
        if not self.key or not hmac.compare_digest(sent, self.key.encode("utf-8")):
            return 401, error("authentication_error", "wrong or missing key for this mock server")
        return None

    def send_json(self, status, body, headers=None):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):  # silence the default per-request log line
        pass


def fit_inputs(answer, tools):
    """Give each tool call's input the types its tool asks for ("2" -> 2 where it wants a number).

    The real API returns inputs that follow the tool's input shape. When Haiku calls a tool directly
    (see read_reply), Claude Code doesn't know that tool's shape, so numbers can arrive as text; a
    tool like roll_dice then fails on every try and the model keeps asking again.
    """
    shapes = {t["name"]: (t.get("input_schema") or {}).get("properties") or {} for t in tools or []}

    def fit(value, kind):
        if not isinstance(value, str):
            return value
        text = value.strip()
        try:
            if kind == "integer" and text.lstrip("-").isdigit():
                return int(text)
            if kind == "number":
                number = float(text)
                return int(number) if number.is_integer() and "." not in text else number
        except ValueError:
            return value
        if kind == "boolean" and text.lower() in ("true", "false"):
            return text.lower() == "true"
        return value

    for call in answer.get("tool_calls") or []:
        shape = shapes.get(call.get("name"), {})
        if isinstance(call.get("input"), dict):
            call["input"] = {k: fit(v, (shape.get(k) or {}).get("type")) for k, v in call["input"].items()}
    return answer


def apply_limit(answer, max_tokens):
    """claude -p has no reply-length limit, so imitate one at about 4 characters a token. Like the
    real API, the reply stops where the limit falls: text is cut there; a tool request being written
    at that point is kept with its input unfinished (empty here), and later ones never happen.
    Returns (answer, whether it was cut)."""
    if not max_tokens:
        return answer, False
    room = max_tokens * 4
    text = answer.get("text", "")
    if len(text) > room:
        return {**answer, "text": text[:room], "tool_calls": []}, True
    room -= len(text)
    kept = []
    for call in answer.get("tool_calls") or []:
        size = len(json.dumps(call))
        if size > room:
            return {**answer, "tool_calls": kept + [{**call, "input": {}}]}, True
        room -= size
        kept.append(call)
    return answer, False


def estimate_usage(request, reply):
    """claude -p's own token counts don't match what the harness sent (the mock wraps the request in
    its own prompt), so estimate from the request itself: about 4 characters per token. Marked as an
    estimate; no cache reads are claimed (the mock can't cache)."""
    sent = len(json.dumps([request.get("system"), request.get("tools"), request.get("messages")], ensure_ascii=False))
    out = len(json.dumps([b for b in reply["content"] if b["type"] != "thinking"], ensure_ascii=False))
    return {"input_tokens": max(1, sent // 4), "output_tokens": max(1, out // 4), "estimated": True}


def error(kind, message):
    return {"type": "error", "error": {"type": kind, "message": message}}


def serve(port=0, key=None):
    """Start the mock on 127.0.0.1 (port 0: any free port) in a background thread. Returns the server and
    the key a client must send as its API key (a new random one unless you give one)."""
    key = key or secrets.token_urlsafe(24)
    handler = type("KeyedHandler", (Handler,), {"key": key})
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, key


def check(model="claude-haiku-4-5-20251001"):
    """One small `claude -p` call made exactly as the mock makes them (setup.bat runs this).
    Haiku, as the quickest. Returns an exit code: 0 if it worked."""
    started = time.time()
    try:
        answer = ask_claude({"model": model, "messages": [{"role": "user", "content": "Reply with the one word: ready"}]})
    except Exception as e:  # not installed, not logged in, too old for these options, too slow ...
        print(f"claude -p did not work: {e}")
        return 1
    print(f"claude -p works ({model}, {time.time() - started:.0f}s). It said: {answer.get('text', '').strip()[:80]}")
    return 0


if __name__ == "__main__":
    if sys.argv[1:] == ["--check"]:
        sys.exit(check())
    server, key = serve(PORT, os.environ.get("MOCK_KEY"))
    print(f"Mock Anthropic API on http://127.0.0.1:{PORT}  (replies come from `claude -p`; Ctrl+C to stop)")
    print(f"Its key (send it as the API key): {key}")
    try:
        while True:  # the server runs in its own thread; short sleeps so Ctrl+C gets through on Windows too
            time.sleep(0.5)
    except KeyboardInterrupt:
        server.shutdown()
