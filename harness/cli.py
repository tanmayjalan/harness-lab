"""The terminal version: chat with the harness in a terminal window.

Run from the Harness folder:
    .venv\\Scripts\\python -m harness.cli --provider mock       real replies from `claude -p`
    .venv\\Scripts\\python -m harness.cli --provider deepseek   DeepSeek (needs DEEPSEEK_API_KEY)
    .venv\\Scripts\\python -m harness.cli                       the Anthropic API (needs ANTHROPIC_API_KEY)

It follows the same settings as the web page (Settings, saved in data/lab_settings.json), read again
for every message: the prompt, tool descriptions, permissions, limits, thinking, caching, trimming,
summarising, skills, the workflow, run code, the 40 office tools, your hooks and the facts about you.
"""
import argparse
import re

from harness.core import loop, providers, tools
from harness.features import context, hooks, lab_settings, memory, skills, subagents, workflow
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


def show_tools(say):
    """An on_event for the loop: each tool is said once, when its result is in, with what happened."""
    asked = {}

    def on_event(kind, **data):
        if kind == "tool_call":
            asked[data["id"]] = (data["name"], {k: v for k, v in data["input"].items() if k != "content"})
        elif kind == "tool_result":
            name, args = asked.pop(data["result"]["tool_use_id"], ("?", {}))
            say(f"  -> {name}({args}): {OUTCOME.get(data.get('outcome'), data.get('outcome'))}")
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


def one_message(messages, client, provider, model, settings, facts, confirm=input, say=print):
    """Answer the last message in `messages`, with these settings, the way the web page does. Returns
    the answer, or the error in plain words."""
    system = memory.system_prompt(lab_settings.system_prompt(settings, loop.SYSTEM), facts)
    found = skills.load_all()
    system = skills.system_prompt(system, settings.get("skills"), found)
    described = lab_settings.offered_tools(settings, tools.TOOLS)  # (run_python only with Run code on)
    if skills.offers_tool(settings.get("skills"), found):
        described = [*described, skills.SKILL_TOOL]
    offered = providers.tools_for(provider, described)
    my_hooks = hooks.load()
    if my_hooks.problem:
        say(f"[my_hooks.py has a problem, so no hooks this time: {my_hooks.problem}]")
    permission = lab_settings.permission(settings, loop.default_permission)
    thinking = lab_settings.thinking_spec(settings, providers.thinking_style(provider))
    cache = lab_settings.caching(settings)
    max_tokens, max_turns = lab_settings.limits(settings)
    on_event = show_tools(say)
    context.maybe_compact(messages, settings, client, model, provider, on_event)
    shared = dict(
        max_tokens=max_tokens, confirm=confirm, on_event=on_event, model=model, tools=offered,
        permission=permission, hooks=my_hooks, thinking=thinking, cache=cache, busy=lab_settings.busy(settings),
        at_once=lab_settings.at_once(settings), prepare=context.preparer(settings, provider),
        # helpers follow your rules too (a tool you set to Block is blocked for them)
        run=subagents.with_delegate(tools.run_tool, client, model, offered, hooks=my_hooks,
                                    permission=permission, thinking=thinking, cache=cache,
                                    busy=lab_settings.busy(settings)))
    extra = lab_settings.extra_tools(settings)
    if extra and not lab_settings.workflow(settings):  # the 40 office tools (features/tool_search.py)
        box = tool_search.Toolbox(offered, extra, tool_search.used_in(messages))  # (what earlier messages loaded)
        shared.update(tools=lambda: providers.tools_for(provider, box.now()), run=box.run(shared["run"]))
    try:
        if lab_settings.workflow(settings):  # a fixed chain of agents (features/workflow.py)
            return plain(workflow.run(messages, client, max_turns=max_turns, **shared))
        return plain(loop.agent(messages, client, max_turns, system=system, **shared))
    except Exception as e:
        return f"[{providers.error_event(e)['message']}]"


def main():
    parser = argparse.ArgumentParser(description="The harness lab, in the terminal")
    parser.add_argument("--provider", choices=providers.PROVIDERS, default="anthropic")
    provider = parser.parse_args().provider
    client = make_client(provider)
    model = providers.PROVIDERS[provider]["model"]
    messages = []
    sharing = len(memory.shared(memory.load()))
    print(f"Harness lab, terminal version: {providers.PROVIDERS[provider]['label']} ({model}), "
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
            print("\nAssistant:", one_message(messages, client, provider, model, lab_settings.load(), memory.load()))
    except (KeyboardInterrupt, EOFError):  # Ctrl+C, or Ctrl+Z / Ctrl+D (end of input), even at a question
        pass
    print("\nBye.")


if __name__ == "__main__":
    main()
