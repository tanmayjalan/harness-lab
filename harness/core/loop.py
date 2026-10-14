"""THE LOOP: send the conversation and the tools to the model, run the tools it asks for,
send the results back, and repeat until it answers. Start reading here.

Also here: the default system prompt, which tools need your OK (permissions), and stopping.
The tools themselves are in tools.py.
"""
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import anthropic

from harness.core import tools

MODEL = "claude-opus-5-5"  # default when no model is passed to agent()
MAX_TOKENS = 16000  # the longest reply the model may write in one call (thinking included)
CACHE = {"type": "ephemeral"}  # "keep everything up to here for a few minutes"
SYSTEM = (
    "You help the user with the files in their workspace folder and with small everyday tasks. "
    "Look at files with your tools before answering questions about them, "
    "and use a tool instead of guessing whenever one fits (for example, calculate for arithmetic). "
    "If the user tells you a lasting fact or preference about themselves, offer to remember it with remember_fact. "
    "For jobs that need a lot of reading or many lookups, use delegate so the details don't fill this conversation. "
    "For tasks with 3 or more steps, first write a plan with update_plan, then keep it updated as you go."
)

# Which tools need your OK before they run:
#   "allow" runs straight away, "ask" asks you first, "block" refuses (and tells the model).
# Tools not listed here are allowed. A file path outside the workspace turns "allow" into "ask" (see
# effective_rule); "block" stays "block".
DEFAULT_PERMISSIONS = {"write_file": "ask", "remember_fact": "ask", "run_python": "ask"}


def default_permission(name):
    return DEFAULT_PERMISSIONS.get(name, "allow")


def ask_text(name, args, outside=False):
    """The yes/no question shown before a tool that needs approval."""
    where = f" That is OUTSIDE the workspace ({tools.WORKSPACE})." if outside else ""
    if name == "write_file":
        return f"\n  The model wants to write {len(args['content'])} characters to {tools.resolve(args['path'])}.{where} Allow? [y/N] "
    if name in tools.FILE_TOOLS:
        verb = "list the folder" if name == "list_files" else "read the file"
        return f"\n  The model wants to {verb} {tools.resolve(args['path'])}.{where} Allow? [y/N] "
    if name == "remember_fact":
        return f"\n  The model wants to remember about you: {args.get('label')}: {args.get('value')}. Allow? [y/N] "
    if name == "run_python":  # show the code itself: it runs as you, with your files (not a sandbox)
        if "path" in args:
            return f"\n  The model wants to run the Python script {tools.resolve(args['path'])}.{where} Allow? [y/N] "
        code = "\n".join("    " + line for line in str(args.get("code", "")).splitlines())
        return f"\n  The model wants to run this Python code (as you, from the workspace folder):\n{code}\n  Allow? [y/N] "
    return f"\n  The model wants to run {name}({args}). Allow? [y/N] "


# ---- Trying a failed call again (visible retries) ----
# A busy or briefly failing service is normal. The SDK could quietly try again for us (it does by default);
# here the loop does it, so each retry is an event you can see. At most RETRIES more tries per call.
RETRIES = 2
REASONS = {408: "the request took too long", 409: "the service reported a conflict", 429: "too many requests",
           500: "the service had an error", 502: "the service had an error", 503: "the service is unavailable",
           504: "the request took too long", 529: "the service is overloaded"}


def retry_reason(e):
    """Why a failed call is worth trying again, as (status, reason), or None if it isn't: the same rules
    as the Anthropic SDK (408, 409, 429, 500 and up, timeouts and lost connections, or what the service
    says in an x-should-retry header)."""
    if isinstance(e, anthropic.APIStatusError):
        should = e.response.headers.get("x-should-retry")
        status = e.status_code
        if should == "false" or (should != "true" and status not in (408, 409, 429) and status < 500):
            return None
        return status, REASONS.get(status, "the service had an error" if status >= 500 else f"error {status}")
    if isinstance(e, anthropic.APITimeoutError):
        return None, "the request took too long"
    if isinstance(e, anthropic.APIConnectionError):
        return None, "could not reach the service"
    return None


def retry_wait(e, attempt):
    """Seconds to wait before retry number `attempt` (1, 2...): what the service asks for (retry-after-ms or
    retry-after, up to a minute), otherwise half a second, doubling each time, at most 8."""
    headers = getattr(getattr(e, "response", None), "headers", None) or {}
    for name, scale in (("retry-after-ms", 1000), ("retry-after", 1)):
        try:
            asked = float(headers.get(name)) / scale
        except (TypeError, ValueError):
            continue
        if 0 < asked <= 60:
            return round(asked, 3)
    return min(0.5 * 2 ** (attempt - 1), 8.0)


def simulated_busy():
    """What the practice switch raises on a call's first try: the error a busy service gives (529)."""
    import httpx2  # the HTTP library this version of the anthropic SDK uses
    response = httpx2.Response(529, request=httpx2.Request("POST", "https://simulated.invalid/v1/messages"),
                               headers={"retry-after": "1"})
    return anthropic.OverloadedError("Error code: 529 - simulated by the practice switch (Settings → Model)",
                                     response=response, body=None)


class Stopped(Exception):
    """The user asked the harness to stop. The history is left valid: every tool request has a result."""


def ignore_event(kind, **data):
    pass


def _result(block, content, is_error=False):
    result = {"type": "tool_result", "tool_use_id": block.id, "content": content}
    if is_error:
        result["is_error"] = True
    return result


def effective_rule(permission, name, args):
    """The rule that will actually apply: your setting, upgraded from allow to ask outside the workspace.
    Returns (rule, outside)."""
    rule = permission(name)
    outside = tools.outside_workspace(name, args)
    if rule == "allow" and outside:
        rule = "ask"  # normally allowed, but not outside the workspace
    return rule, outside


def _cached(system, tools, messages):
    """Mark the end of the system prompt, the tool list and the conversation so far with
    cache_control. The provider keeps everything up to each mark for a few minutes, and the
    next call that starts the same way reads it from the cache at a fraction of the price."""
    def mark_last(content):
        blocks = [{"type": "text", "text": content}] if isinstance(content, str) else [
            b.model_dump(exclude_none=True) if hasattr(b, "model_dump") else dict(b) for b in content]
        if blocks:
            blocks[-1] = {**blocks[-1], "cache_control": CACHE}
        return blocks
    if messages:
        messages = [*messages[:-1], {**messages[-1], "content": mark_last(messages[-1]["content"])}]
    tools = [*tools[:-1], {**tools[-1], "cache_control": CACHE}] if tools else tools
    return [{"type": "text", "text": system, "cache_control": CACHE}], tools, messages


def _call_hook(on_event, block, which, fn, *args):
    """Call one of your hooks and time it. Returns (what it returned, milliseconds).
    If it crashes, say so ("failed") and pass the error on: the tool call then fails as before."""
    start = time.perf_counter()
    try:
        out = fn(*args)
    except Exception as e:
        on_event("hook", id=block.id, hook=which, verdict="failed", error=f"{type(e).__name__}: {e}",
                 ms=round((time.perf_counter() - start) * 1000, 1))
        raise
    return out, round((time.perf_counter() - start) * 1000, 1)


def not_offered(block, offered):
    """The refusal for a tool that wasn't in this call's tool list, or None if it was (or there's no list to check).
    The model can still ask for one: a name it saw earlier in the conversation, or one a file told it to try."""
    if offered is None or block.name in offered:
        return None
    hint = (" Use find_tool first to look for another tool; the ones it finds can be used from your next step."
            if "find_tool" in offered else "")
    return _result(block, f"Not run: {block.name} wasn't offered to you on this call, so the harness didn't run it. "
                          f"Use only the tools you were given.{hint}", is_error=True), "not_run"


def _before(block, permission, confirm, hooks, on_event, offered=None):
    """Everything before a tool runs: is it one this call offered, then your before_tool hook, then the
    workspace check and your rule (and your answer, if it asks). Returns (result for the model, outcome)
    when the call stops here, or None when it may run. `offered`: the names this call sent (None: don't check)."""
    refused = not_offered(block, offered)
    if refused:  # a tool the model wasn't given never runs, whatever your rule for it says
        return refused
    if hooks and hooks.before:  # your hook gets the first say, before any approval question
        reason, ms = _call_hook(on_event, block, "before_tool", hooks.before, block.name, block.input)
        on_event("hook", id=block.id, hook="before_tool", verdict="blocked" if reason else "allowed",
                 reason=str(reason) if reason else None, ms=ms)
        if reason:
            return _result(block, f"Blocked by the user's hook: {reason}. Don't try it again.", is_error=True), "hook_blocked"
    rule, outside = effective_rule(permission, block.name, block.input)
    if rule == "block":
        return _result(block, "The user's settings block this tool. Don't try it again.", is_error=True), "blocked"
    if rule == "ask" and confirm is None:  # nobody here to ask: not run, and the model is told why
        return _result(block, "Not run: this tool needs the user's OK, and nobody can be asked here. "
                              "Don't try it again.", is_error=True), "unattended"
    if rule == "ask" and confirm(ask_text(block.name, block.input, outside)).strip().lower() != "y":
        return _result(block, f"The user declined this {block.name} call. Do not retry it unless they ask."), "declined"
    return None


def _after(block, output, hooks, on_event):
    """Your after_tool hook, once the tool has run: what the model gets (its output, or your rewrite)."""
    if hooks and hooks.after:
        replaced, ms = _call_hook(on_event, block, "after_tool", hooks.after, block.name, block.input, output)
        changed = isinstance(replaced, str) and replaced != output
        # A rewrite keeps the tool's own output too, so you can compare it with what the model got
        on_event("hook", id=block.id, hook="after_tool", verdict="replaced" if changed else "kept",
                 original=output if changed else None, ms=ms)
        if isinstance(replaced, str):
            output = replaced
    return output


def _run_one(block, permission, confirm, run, hooks=None, on_event=ignore_event, offered=None):
    """Run one tool call. Returns (result for the model, outcome for whoever is watching).
    outcome: "ran", "error", "declined", "blocked" (your settings), "hook_blocked", "unattended":
    it needed your OK and nobody could be asked (`confirm` is None: Compare, Re-run, evals, helpers),
    or "not_run": this call didn't offer that tool (`offered`, the names it sent).
    Each hook call is also reported as a "hook" event: what it decided and how long it took."""
    try:
        stopped = _before(block, permission, confirm, hooks, on_event, offered)
        if stopped:
            return stopped
        return _result(block, _after(block, run(block.name, block.input), hooks, on_event)), "ran"
    except Exception as e:
        # Report failures to the model instead of crashing; it can try something else
        return _result(block, f"Error: {e}", is_error=True), "error"


# ---- Several tools at once ----
# A reply can ask for several tools. One after another, three weather lookups take three times as long
# as one. When they're independent, the harness can run them at the same time. It only does so when
# nothing can need you: every one of them is allowed, inside the workspace, and may run alongside
# others (not a write, a fact to remember, a helper, a skill to load, or someone else's MCP program).
# Your hooks still run one at a time, and the model gets the results in the order it asked.

def why_one_by_one(blocks, permission, may_run_together):
    """Why these tool calls can't run at the same time, in words, or None if they can."""
    for b in blocks:
        rule, outside = effective_rule(permission, b.name, b.input)
        if outside:
            return f"{b.name} reaches outside the workspace, so it asks first"
        if rule != "allow":
            return f"{b.name} is set to {'Ask first' if rule == 'ask' else 'Block'}"
        if not may_run_together(b.name):
            return f"{b.name} can't run alongside other tools (it writes, asks you, starts a helper or is another program's)"
    return None


def _run_together(blocks, permission, run, hooks, on_event, offered=None):
    """Run tool calls at the same time. Each result is reported as soon as it's ready; the list returned
    is in the reply's order, which is the order the model gets them in."""
    done = {}
    go = []
    for b in blocks:  # your before_tool hooks, one at a time
        try:
            stopped = _before(b, permission, None, hooks, on_event, offered)  # (all allowed: nothing asks)
        except Exception as e:
            stopped = _result(b, f"Error: {e}", is_error=True), "error"
        if stopped:
            done[b.id] = stopped
            on_event("tool_result", result=stopped[0], outcome=stopped[1])
        else:
            go.append(b)
    if go:
        with ThreadPoolExecutor(max_workers=len(go)) as pool:
            running = {pool.submit(run, b.name, b.input): b for b in go}
            for finished in as_completed(running):  # back here, one at a time: hooks and events stay in order
                b = running[finished]
                try:
                    done[b.id] = _result(b, _after(b, finished.result(), hooks, on_event)), "ran"
                except Exception as e:
                    done[b.id] = _result(b, f"Error: {e}", is_error=True), "error"
                on_event("tool_result", result=done[b.id][0], outcome=done[b.id][1])
    return [done[b.id][0] for b in blocks]


# The loop. `messages` is the whole conversation; we only ever append to it.
# Every keyword below has a default, so the simplest call is agent(messages, client).
#   on_event     lets a UI watch each step (the command line ignores it)
#   tools        the tool descriptions offered to the model (or a function returning them, read before each call).
#                A tool the model asks for that this call didn't offer is never run: it gets "Not run"
#   permission   name -> "allow" / "ask" / "block"
#   run          (name, input) -> result text; the code behind the tools
#   should_stop  checked between steps; True ends the loop cleanly
#   prepare      makes the copy of the history that is sent (e.g. trimmed); the history itself is never changed
#   stream       pass the reply's text on in pieces as it arrives
#   hooks        your before_tool / after_tool functions (see features/hooks.py); each call is
#                reported to on_event as "hook": which one, for which tool, what it decided
#   max_tokens   the longest reply the model may write in one call (it stops with "max_tokens" there)
#   thinking     {"style": "budget", "budget": N} or {"style": "adaptive", "effort": "medium"}: the model
#                reasons step by step before it answers (None = don't ask for it)
#   cache        mark the request so the provider can reuse it on the next call (cheaper input)
#   busy         practice: the first try of every call fails as if the service were busy (nothing is sent)
#   at_once      name -> True if that tool may run alongside others: with it, the tools of one reply run at
#                the same time when every one is allowed (see why_one_by_one). None = always one by one
#
# A call that fails because the service is busy or briefly down is tried again (see retry_reason), each
# time with a "retry" event between the call's "request" and "response".
def agent(messages, client, max_turns=20, confirm=input, on_event=ignore_event, model=MODEL, system=SYSTEM,
          tools=tools.TOOLS, permission=default_permission, run=tools.run_tool,
          should_stop=lambda: False, prepare=lambda msgs: msgs, stream=False, hooks=None, thinking=None,
          cache=False, max_tokens=MAX_TOKENS, busy=False, at_once=None):
    if thinking and thinking.get("style") == "budget" and thinking["budget"] >= max_tokens:
        # The thinking budget comes out of max_tokens and must be smaller: shrink it, or drop it if tiny
        thinking = {**thinking, "budget": max_tokens - 256} if max_tokens - 256 >= 1024 else None
    for turn in range(1, max_turns + 1):  # a hard stop so it can't loop forever
        if should_stop():
            raise Stopped("Stopped by the user")
        to_send = prepare(messages)
        # `tools` may be a function, read again before every call: that is how the tool list can change
        # between calls (find_tool loads more tools, features/tool_search.py)
        send_system, send_tools = system, tools() if callable(tools) else tools
        offered = {t.get("name") for t in send_tools or []}  # only these may run after this call
        if cache:
            send_system, send_tools, to_send = _cached(system, send_tools, to_send)
        request = dict(model=model, max_tokens=max_tokens, system=send_system, tools=send_tools, messages=to_send)
        if not send_tools:
            del request["tools"]  # no tools at all (a workflow's writing step): leave the list out
        if thinking and thinking.get("style") == "adaptive":
            # Newer models (e.g. Opus 5.5) decide how much to think; you set the effort and ask for a summary
            request["thinking"] = {"type": "adaptive", "display": "summarized"}
            request["output_config"] = {"effort": thinking.get("effort", "medium")}
        elif thinking:
            request["thinking"] = {"type": "enabled", "budget_tokens": thinking["budget"]}
        on_event("request", turn=turn, max_turns=max_turns, messages=to_send, system=system, max_tokens=max_tokens,
                 thinking=request.get("thinking"), output_config=request.get("output_config"), cache=bool(cache))
        for attempt in range(RETRIES + 1):
            started_text = False
            try:
                if busy and attempt == 0:
                    raise simulated_busy()  # the practice switch: fails before anything is sent
                if stream and hasattr(client.messages, "stream"):  # (simple test stand-ins can't stream)
                    # The reply arrives in small pieces; pass each piece of text on as it comes,
                    # then use the complete reply exactly as if it had arrived all at once
                    with client.messages.stream(**request) as s:
                        for piece in s.text_stream:
                            started_text = True
                            on_event("text", text=piece)
                        response = s.get_final_message()
                else:
                    response = client.messages.create(**request)
                break
            except Exception as e:
                why = retry_reason(e)
                # (a reply that already started arriving isn't sent again: you've seen part of it)
                if why is None or attempt == RETRIES or started_text:
                    raise
                wait = retry_wait(e, attempt + 1)
                on_event("retry", turn=turn, attempt=attempt + 1, status=why[0], reason=why[1], wait=wait,
                         simulated=bool(busy and attempt == 0))
                until = time.time() + wait
                while time.time() < until:  # Stop works while waiting too
                    if should_stop():
                        raise Stopped("Stopped by the user")
                    time.sleep(min(0.1, max(0.0, until - time.time())))
        # Keep the model's full reply (including its tool requests) in the history
        messages.append({"role": "assistant", "content": response.content})
        on_event("response", turn=turn, stop_reason=response.stop_reason, content=response.content,
                 usage=getattr(response, "usage", None))

        if response.stop_reason != "tool_use":
            # "end_turn" is the normal finish; "max_tokens" or "refusal" means it stopped early.
            # A reply cut off while writing a tool request still needs an answer for that request,
            # or the next message would be refused: say it wasn't run.
            unfinished = [b for b in response.content if b.type == "tool_use"]
            if unfinished:
                cut = [_result(b, f"Not run: the reply was cut off ({response.stop_reason}) before this request "
                                  "was complete.", is_error=True) for b in unfinished]
                messages.append({"role": "user", "content": cut})
                for r in cut:
                    on_event("tool_result", result=r, outcome="not_run")
            text = "".join(b.text for b in response.content if b.type == "text")
            if response.stop_reason != "end_turn":
                text += f"\n[stopped early: {response.stop_reason}]"
            return text

        # Run every tool it asked for, and send all results back in ONE message
        blocks = [b for b in response.content if b.type == "tool_use"]
        if at_once and len(blocks) > 1 and not should_stop():
            why = why_one_by_one(blocks, permission, at_once)
            on_event("tools_at_once", turn=turn, count=len(blocks), together=why is None, reason=why)
            if why is None:
                for b in blocks:  # every request first, then the results as they're ready
                    on_event("tool_call", id=b.id, name=b.name, input=b.input, permission="allow", outside=False,
                             together=True)
                messages.append({"role": "user", "content": _run_together(blocks, permission, run, hooks, on_event,
                                                                          offered)})
                continue
        results = []
        for block in blocks:
            if should_stop():
                # Every tool request still needs a result, or the next call would be rejected
                results.append(_result(block, "Not run: the user stopped the harness.", is_error=True))
                on_event("tool_result", result=results[-1], outcome="not_run")
                continue
            rule, outside = effective_rule(permission, block.name, block.input)
            on_event("tool_call", id=block.id, name=block.name, input=block.input, permission=rule, outside=outside)
            result, outcome = _run_one(block, permission, confirm, run, hooks, on_event, offered)
            results.append(result)
            on_event("tool_result", result=result, outcome=outcome)
        messages.append({"role": "user", "content": results})

    raise RuntimeError(f"Stopped: hit max_turns ({max_turns})")
