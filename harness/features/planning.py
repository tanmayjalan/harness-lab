"""A plan the model keeps for bigger tasks: a checklist it writes first and updates as it works.

Long tasks drift: the model forgets a step or stops halfway. Writing the steps down,
and seeing the list again in every tool result, keeps it on track, and lets you watch
its progress. Claude Code does the same with its to-do list.

The model sends the whole list each time; nothing is stored here. The web page
shows the latest list.
"""

PLAN_TOOL = {
    "name": "update_plan",
    "description": (
        "Write or update your step-by-step plan for a task that needs 3 or more steps. Send the WHOLE list "
        "every time, each step with a status: pending, in_progress (only one at a time) or done. Make the plan "
        "before you start, and update it as you finish each step. The user sees it live. Skip it for simple questions."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string", "description": "The step, in a few words"},
                        "status": {"type": "string", "enum": ["pending", "in_progress", "done"]},
                    },
                    "required": ["text", "status"],
                },
            },
        },
        "required": ["steps"],
    },
}

MARKS = {"done": "[x]", "in_progress": "[>]", "pending": "[ ]"}


def update(args):
    """Check the list and give it back as a checklist, so the model sees where it is."""
    steps = args.get("steps")
    if not isinstance(steps, list) or not steps:
        raise ValueError("send the whole plan as a non-empty list of steps")
    if len(steps) > 20:
        raise ValueError("keep the plan to at most 20 steps")
    for s in steps:
        if not isinstance(s, dict) or not str(s.get("text", "")).strip() or s.get("status") not in MARKS:
            raise ValueError("each step needs text and a status of pending, in_progress or done")
    if sum(s["status"] == "in_progress" for s in steps) > 1:
        raise ValueError("only one step can be in_progress at a time")
    done = sum(s["status"] == "done" for s in steps)
    lines = [f"{MARKS[s['status']]} {s['text'].strip()}" for s in steps]
    nxt = next((s["text"] for s in steps if s["status"] != "done"), None)
    tail = f" Next: {nxt}." if nxt else " All steps done."
    return f"Plan saved: {done} of {len(steps)} done.{tail}\n" + "\n".join(lines)
