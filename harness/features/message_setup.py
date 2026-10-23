"""What one message is sent with, built from your settings: the system prompt, the tools, your rules for
them, thinking, caching, limits and the rest.

The web page (web/server.py), the terminal version (cli.py) and each side of a comparison (web/compare.py,
also used by Re-run and Evals) all build their setup here, so a setting means the same thing everywhere.
What still differs between them is in each caller, on purpose: the page and the terminal can keep a
conversation's start ("From your next conversation"), the page lets you "Always allow" a tool mid-message,
and a comparison side has nobody to ask and its own trimming rule.
"""
from harness.core import loop, providers
from harness.features import hooks, lab_settings, memory, skills


def offered_tools(settings, base_tools, found):
    """The tools offered, with your edits (run_python only with Run code on), plus load_skill when your skills
    setting needs it. `found`: the skill files (skills.load_all)."""
    described = lab_settings.offered_tools(settings, base_tools)
    if skills.offers_tool(settings.get("skills"), found):
        described = [*described, skills.SKILL_TOOL]
    return described


def build(settings, provider, base_tools, facts=(), default_permission=loop.default_permission,
          is_mcp=lambda name: False, use_hooks=True):
    """Everything one message needs from your settings, as a dict.

    `facts`: the facts about you to put in the prompt. `default_permission`: each tool's rule before your
    changes. `is_mcp`: name -> True for a tool from another program (MCP), which never runs alongside others.
    `use_hooks`: load your hooks (config/my_hooks.py), read fresh every time; otherwise "hooks" is None.

    "described" is the tool list as your settings describe it; "tools" is the same list shaped for this
    provider (providers.tools_for), which is what is sent."""
    facts = list(facts)
    found = skills.load_all()
    system = memory.system_prompt(lab_settings.system_prompt(settings, loop.SYSTEM), facts)
    # Skills: a line each in the prompt and a tool to load one, or every skill in full
    system = skills.system_prompt(system, settings.get("skills"), found)
    together = lab_settings.at_once(settings)
    max_tokens, max_turns = lab_settings.limits(settings)
    setup = {
        "provider": provider,
        "system": system,
        "facts_shared": len(memory.shared(facts)),
        "permission": lab_settings.permission(settings, default_permission),
        "hooks": hooks.load() if use_hooks else None,
        "thinking": lab_settings.thinking_spec(settings, providers.thinking_style(provider),
                                               providers.is_local(provider)),
        "cache": lab_settings.caching(settings),
        "busy": lab_settings.busy(settings),  # the practice switch: every call's first try fails as if busy
        # Tools from MCP programs never run at the same time as others
        "at_once": None if together is None else (lambda name: together(name) and not is_mcp(name)),
        "max_tokens": max_tokens,
        "max_turns": max_turns,
        "workflow": lab_settings.workflow(settings),        # a fixed chain of agents (features/workflow.py)
        "extra_tools": lab_settings.extra_tools(settings),  # the 40 office tools: "all", "find" or None
    }
    set_tools(setup, offered_tools(settings, base_tools, found))
    return setup


def set_tools(setup, described):
    """Offer these tools: kept as described, and shaped for the setup's provider (only Anthropic takes "strict")."""
    setup["described"] = described
    setup["tools"] = providers.tools_for(setup["provider"], described)


def use_kept_start(setup, kept, settings):
    """Send the prompt and tools a conversation kept from its first message ("Apply edits: from your next
    conversation") instead of today's. `kept` has the "system" and "tools" it began with.

    Run code switched off is a safety switch, so it applies at once: run_python leaves even a kept start (the
    tool list changes, and the loop refuses a tool it didn't offer). The tools are shaped for the provider in
    use now, so a switch mid-conversation gets the right options."""
    setup["system"] = kept["system"]
    set_tools(setup, [t for t in kept["tools"] if t.get("name") != "run_python" or lab_settings.run_code(settings)])


def loop_args(setup):
    """The arguments for loop.agent (and workflow.run) that come from your settings. The caller adds the rest:
    who answers approvals, where events go, the model, the code that runs the tools, and so on."""
    keys = ("tools", "permission", "hooks", "thinking", "cache", "busy", "at_once", "max_tokens")
    return {k: setup[k] for k in keys}
