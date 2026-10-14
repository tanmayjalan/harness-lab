"""Skills: instructions the model loads only when it needs them.

A skill is a short Markdown file in config/skills/: a name, one line on what it's for, and the full
instructions. With skills on, the system prompt gets only the one-line list ("on demand"), plus a
tool, load_skill, that returns a skill's full instructions when the model decides it needs them. So
a long set of instructions costs nothing until a task needs it. Claude Code's skills work this way.

The other mode, "all in the prompt", puts every skill's full text in the system prompt, to compare.

A skill file looks like this:

    ---
    name: expenses
    description: Filing an expense with submit_expense
    ---
    The instructions, as long as they need to be.
"""
from harness import paths

DIR = paths.CONFIG / "skills"
MODES = ("on_demand", "all_in_prompt")

SKILL_TOOL = {
    "name": "load_skill",
    "description": (
        "Load the full instructions of one of the skills listed in the system prompt. Call it before you do a "
        "task a skill covers, then follow what it says. It only reads instructions: it changes nothing."
    ),
    "input_schema": {
        "type": "object",
        "properties": {"name": {"type": "string", "description": "The skill's name, as listed in the system prompt"}},
        "required": ["name"],
    },
}


def parse(text):
    """(name, description, instructions) from a skill file, or None if it has no name."""
    lines = text.strip().splitlines()
    if not lines or lines[0].strip() != "---" or "---" not in [ln.strip() for ln in lines[1:]]:
        return None
    end = 1 + [ln.strip() for ln in lines[1:]].index("---")
    head = dict(ln.split(":", 1) for ln in lines[1:end] if ":" in ln)
    name = head.get("name", "").strip()
    if not name:
        return None
    return name, head.get("description", "").strip(), "\n".join(lines[end + 1:]).strip()


def load_all(folder=None):
    """Every skill in the folder, sorted by name: [{"name", "description", "body", "file"}]."""
    folder = folder or DIR
    found = []
    for f in sorted(folder.glob("*.md")) if folder.exists() else []:
        skill = parse(f.read_text(encoding="utf-8"))
        if skill:
            found.append({"name": skill[0], "description": skill[1], "body": skill[2], "file": f.name})
    return sorted(found, key=lambda s: s["name"])


def addition(setting, found):
    """Exactly what's added to the system prompt ("" with skills off, or none found)."""
    if not (setting or {}).get("enabled") or not found:
        return ""
    if setting.get("mode") == "all_in_prompt":
        return "Skills (instructions for some tasks; follow the one that fits):\n\n" + "\n\n".join(
            f"## {s['name']}\n{s['body']}" for s in found)
    return ("Skills: instructions for some tasks, loaded only when needed. Before doing one of these tasks, "
            "call load_skill with its name and follow what it says:\n"
            + "\n".join(f"- {s['name']}: {s['description']}" for s in found))


def system_prompt(base, setting, found):
    extra = addition(setting, found)
    return f"{base}\n\n{extra}" if extra else base


def offers_tool(setting, found):
    """The load_skill tool is offered only on demand, and only if there's something to load."""
    return bool((setting or {}).get("enabled")) and setting.get("mode", "on_demand") == "on_demand" and bool(found)


def load(args, folder=None):
    """The full instructions of one skill. A wrong name raises ValueError listing the right ones."""
    found = load_all(folder)
    name = str(args.get("name", "")).strip()
    for s in found:
        if s["name"].lower() == name.lower():
            return f"Skill {s['name']}:\n{s['body']}"
    names = ", ".join(s["name"] for s in found) or "none"
    raise ValueError(f"no skill called {name!r}; the skills are: {names}")
