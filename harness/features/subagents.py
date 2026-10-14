"""Sub-agents: hand a self-contained job to a helper with its own, fresh history.

Reading ten files fills the conversation with ten files' worth of text, and every
later call sends all of it again. A helper agent does that reading in its own,
separate loop and sends back only a short report, so the main conversation stays
small. This is how Claude Code keeps long tasks manageable.

The helper gets read-only tools, can't delegate again, and can't ask you
anything: tools that would need your OK are refused. Your rules apply: a tool you
set to Block (or Ask first) is refused to the helper too, and so are your hooks.
"""

DELEGATE_TOOL = {
    "name": "delegate",
    "description": (
        "Hand a self-contained job to a helper agent. The helper starts a fresh conversation of its own, "
        "with read-only tools (list and read files, calculator, weather, time, dice), does the work, and "
        "returns only a short report, so the details don't fill up this conversation. Use it for jobs that "
        "need a lot of reading or many lookups, e.g. 'read these 5 files and summarise what each does'. "
        "Give a clear task and say what the report should contain."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "task": {"type": "string", "description": "The job, with everything the helper needs to know"},
            "report": {"type": "string", "description": "What to send back, e.g. 'one line per file'"},
        },
        "required": ["task"],
    },
}

HELPER_SYSTEM = (
    "You are a helper agent. Another AI agent gave you a task. Use your tools to do it, then reply with a "
    "short, factual report (at most about 150 words) containing exactly what was asked for, and nothing else. "
    "You can't ask questions: if something is unclear, make a sensible choice and say so in the report."
)

READ_ONLY = {"list_files", "read_file", "search_files", "get_weather", "convert_temperature", "calculate",
             "get_current_time", "roll_dice"}  # (no update_plan: the plan on screen belongs to the main agent)


def helper_tools(all_tools):
    return [t for t in all_tools if t["name"] in READ_ONLY]


def helper_rule(permission):
    """The helper may run a read-only tool if your rule for it is Allow. Ask first stays "ask", and the loop
    refuses it because nobody can be asked; tools that write are never the helper's."""
    if permission is None:
        return lambda name: "allow" if name in READ_ONLY else "block"
    return lambda name: permission(name) if name in READ_ONLY and permission(name) in ("allow", "ask") else "block"


def run_helper(args, client, model, tools, run_tool, on_event, should_stop, max_turns=12, hooks=None,
               permission=None, thinking=None, cache=False, busy=False):
    """Do one delegated job in a fresh loop and return the helper's report. `busy`: the practice switch
    (the first try of each of the helper's calls fails as if the service were busy, as yours do)."""
    from harness.core import loop  # imported here: tools.py imports this file for DELEGATE_TOOL
    task = str(args.get("task", "")).strip()
    if not task:
        raise ValueError("the task is empty")
    if args.get("report"):
        task += f"\n\nReport back: {args['report']}"
    return loop.agent(
        [{"role": "user", "content": task}], client, max_turns=max_turns, model=model, system=HELPER_SYSTEM,
        tools=helper_tools(tools),
        permission=helper_rule(permission), thinking=thinking, cache=cache,
        confirm=None,  # nobody to ask: anything needing approval isn't run, and the helper is told why
        run=run_tool, on_event=on_event, should_stop=should_stop, hooks=hooks,  # your hooks apply here too
        busy=busy)


def with_delegate(run_tool, client, model, tools, on_event=lambda kind, **data: None, should_stop=lambda: False,
                  hooks=None, permission=None, thinking=None, cache=False, busy=False):
    """Wrap a run_tool function so it also handles "delegate" by starting a helper."""
    def run(name, args):
        if name == "delegate":
            return run_helper(args, client, model, tools, run_tool, on_event, should_stop, hooks=hooks,
                              permission=permission, thinking=thinking, cache=cache, busy=busy)
        return run_tool(name, args)
    return run
