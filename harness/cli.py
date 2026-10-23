"""The terminal version: chat with the harness in a terminal window.

Run from the Harness folder:
    .venv\\Scripts\\python -m harness.cli                        the mock: real replies from `claude -p` (as the page)
    .venv\\Scripts\\python -m harness.cli --provider deepseek    DeepSeek (needs DEEPSEEK_API_KEY)
    .venv\\Scripts\\python -m harness.cli --provider anthropic   the Anthropic API (needs ANTHROPIC_API_KEY, paid)
    .venv\\Scripts\\python -m harness.cli --provider ollama      a model in Ollama (also lmstudio, custom)

It follows the same settings as the web page (Settings, saved in data/lab_settings.json), read again
for every message: the prompt, tool descriptions, permissions, limits, thinking, caching, trimming,
summarising, skills, the workflow, run code, the 40 office tools, your hooks and the facts about you.
It offers the same tools too, those from the MCP servers in config/mcp_servers.json included, and says
how many at the start.

Where it still differs from the page:
- the model is always the provider's default one (the page lets you pick another);
- it prints each tool once, after its result is in, with what your hooks did to it, but not the requests.
"""
import argparse
import re

from harness.core import loop, providers, tools
from harness.features import context, lab_settings, mcp_client, memory, message_setup, skills, subagents, workflow
from harness.features import tool_search
from harness.words import plural

# What happened to a tool call, in the words the page uses
OUTCOME = {"ran": "ran", "error": "failed", "declined": "you declined", "blocked": "blocked by your settings",
           "hook_blocked": "blocked by your hook", "unattended": "not run: nobody to ask", "not_run": "not run"}
# Why a reply ended early, in plain words (the loop marks it "[stopped early: <stop_reason>]")
STOPPED = {"max_tokens": "cut off: the reply reached the longest-reply limit (max_tokens)",
           "refusal": "the model declined to answer", "pause_turn": "paused by the service"}


def make_client(provider):
    if provider == "mock":
        from harness.web import server  # it can start its own mock server, so nothing else needs to be running
        return server.start_mock()
    return providers.make_client(provider)


def hook_note(data):
    """What one of your hooks did, in plain words (a "hook" event), or None when it changed nothing."""
    if data.get("verdict") == "blocked":
        return f"your before_tool hook said: {data.get('reason')}"  # (the outcome already says "blocked by your hook")
    if data.get("verdict") == "replaced":
        return "your after_tool hook rewrote the result"
    if data.get("verdict") == "failed":
        return f"your {data.get('hook')} hook crashed: {data.get('error')}"
    return None


def show_tools(say):
    """An on_event for the loop: each tool is said once, when its result is in, with what happened
    and what your hooks did to it."""
    asked = {}
    notes = {}  # tool call id -> what your hooks did, said on the tool's own line

    def on_event(kind, **data):
        if kind == "tool_call":
            asked[data["id"]] = (data["name"], {k: v for k, v in data["input"].items() if k != "content"})
        elif kind == "hook":
            note = hook_note(data)
            if note:
                notes.setdefault(data.get("id"), []).append(note)
        elif kind == "tool_result":
            call_id = data["result"]["tool_use_id"]
            name, args = asked.pop(call_id, ("?", {}))
            said = "".join(f" ({n})" for n in notes.pop(call_id, []))
            say(f"  -> {name}({args}): {OUTCOME.get(data.get('outcome'), data.get('outcome'))}{said}")
        elif kind == "step":  # a workflow step starts: its own loop, with what the code passed it
            say(f"  [step {data['n']}: {data['label']}{' ' + str(data['attempt']) if data.get('attempt') else ''}]")
        elif kind == "step_done" and data.get("verdict"):
            say(f"  [check: {data['verdict']}]")
        elif kind == "compacted":
            say("  [older messages summarised]" if not data.get("failed") else f"  [summarising failed: {data['failed']}]")
    return on_event


def plain(answer):
    """The loop's "[stopped early: max_tokens]" marker (the page reads it) in plain words."""
    return re.sub(r"\[stopped early: (\w+)\]", lambda m: f"[{STOPPED.get(m.group(1), 'stopped early: ' + m.group(1))}]",
                  answer)


def base_tools(mcp=None):
    """Every tool the lab knows: the built-in ones and those from MCP servers (the page's base_tools)."""
    return list(tools.TOOLS) + (list(mcp.tools) if mcp else [])


def first_call_tools(settings, base, found=None):
    """What a message's first call offers: your tools as your settings describe them, plus the 40 office tools
    or find_tool if they're on."""
    described = message_setup.offered_tools(settings, base, skills.load_all() if found is None else found)
    extra = lab_settings.extra_tools(settings)
    if extra and not lab_settings.workflow(settings):
        return tool_search.start(described, extra)
    return described


def one_message(messages, client, provider, model, settings, facts, confirm=input, say=print, mcp=None, start=None):
    """Answer the last message in `messages`, with these settings, the way the web page does. Returns
    the answer, or the error in plain words. `mcp`: tools from MCP servers (features/mcp_client.py), or None.
    `start`: a dict kept for the whole conversation, where a kept start is held when your edits apply from
    the next conversation (Settings → "Apply edits")."""
    is_mcp = mcp.handles if mcp else (lambda name: False)
    # Tools from MCP servers are someone else's code, so they ask first unless you change it (as in the page)
    setup = message_setup.build(settings, provider, base_tools(mcp), facts, is_mcp=is_mcp,
                                default_permission=lambda name: "ask" if is_mcp(name) else loop.default_permission(name))
    if start is not None and lab_settings.per_conversation(settings):
        # The conversation keeps the prompt and tools it began with; edits apply from the next one
        if not start:
            start.update(system=setup["system"], tools=setup["described"])
        message_setup.use_kept_start(setup, start, settings)
    elif start is not None:
        start.clear()  # edits apply per message again: drop any start kept earlier
    if setup["hooks"].problem:
        say(f"[my_hooks.py has a problem, so no hooks this time: {setup['hooks'].problem}]")

    def run_tool(name, args):
        return mcp.call(name, args) if is_mcp(name) else tools.run_tool(name, args)
    on_event = show_tools(say)
    context.maybe_compact(messages, settings, client, model, provider, on_event)
    shared = dict(
        message_setup.loop_args(setup), confirm=confirm, on_event=on_event, model=model,
        prepare=context.preparer(settings, provider),
        # helpers follow your rules too (a tool you set to Block is blocked for them)
        run=subagents.with_delegate(run_tool, client, model, setup["tools"], hooks=setup["hooks"],
                                    permission=setup["permission"], thinking=setup["thinking"],
                                    cache=setup["cache"], busy=setup["busy"]))
    if setup["extra_tools"] and not setup["workflow"]:  # the 40 office tools (features/tool_search.py)
        # (starting from what earlier messages loaded)
        box = tool_search.Toolbox(setup["tools"], setup["extra_tools"], tool_search.used_in(messages))
        shared.update(tools=lambda: providers.tools_for(provider, box.now()), run=box.run(shared["run"]))
    try:
        if setup["workflow"]:  # a fixed chain of agents (features/workflow.py)
            return plain(workflow.run(messages, client, max_turns=setup["max_turns"], **shared))
        return plain(loop.agent(messages, client, setup["max_turns"], system=setup["system"], **shared))
    except Exception as e:
        return f"[{providers.error_event(e)['message']}]"


def main():
    parser = argparse.ArgumentParser(description="The harness lab, in the terminal")
    # The mock by default, as the page: no extra charge on your Claude Code plan (the API needs --provider anthropic)
    parser.add_argument("--provider", choices=providers.PROVIDERS, default="mock")
    provider = parser.parse_args().provider
    problem = providers.is_local(provider) and providers.unavailable(provider)  # not running, no models, no address
    if problem:
        parser.exit(1, f"{providers.PROVIDERS[provider]['label']}: {problem}\n")
    try:
        client = make_client(provider)
    except providers.MissingKey as e:
        parser.exit(1, f"{e}\n")
    model = providers.default_model(provider)
    messages, start = [], {}
    sharing = len(memory.shared(memory.load()))
    mcp = mcp_client.load()  # tools from the servers in config/mcp_servers.json, as the page loads them
    for trouble in mcp.problems:
        print(f"MCP: skipped {trouble}")
    try:
        offered = first_call_tools(lab_settings.load(), base_tools(mcp))
        from_mcp = sum(1 for t in offered if mcp.handles(t["name"]))
        print(f"Harness lab, terminal version: {providers.PROVIDERS[provider]['label']} ({model}), "
              f"offering {plural(len(offered), 'tool')}{f' ({from_mcp} from MCP servers)' if from_mcp else ''}, "
              f"sharing {plural(sharing, 'fact')} about you. Your page settings apply. Type 'exit' to quit.")
        try:
            while True:
                task = input("\nYou: ").strip()
                if task.lower() in {"exit", "quit"}:
                    break
                if not task:
                    continue
                messages.append({"role": "user", "content": task})
                # Re-read every time, so edits made in the web page (or to my_hooks.py) apply straight away
                print("\nAssistant:", one_message(messages, client, provider, model, lab_settings.load(),
                                                  memory.load(), mcp=mcp, start=start))
        except (KeyboardInterrupt, EOFError):  # Ctrl+C, or Ctrl+Z / Ctrl+D (end of input), even at a question
            pass
        print("\nBye.")
    finally:
        mcp.close()  # stop the MCP servers it started


if __name__ == "__main__":
    main()
