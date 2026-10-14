"""Facts about you that the harness adds to every conversation.

The model remembers nothing between calls, or between conversations. What
feels like "memory" is the harness keeping facts in a file (profile.json) and
putting the ones you've ticked into the system prompt of every request.
"""
import json
import pathlib

from harness import paths

PATH = paths.DATA / "profile.json"
MAX_FACTS = 30

# What a new profile starts with. Nothing is shared until you tick it.
STARTER = [
    {"label": "Name", "value": "", "share": False},
    {"label": "Preferred temperature unit", "value": "Celsius", "share": False},
    {"label": "Time zone", "value": "", "share": False},
    {"label": "Answer style", "value": "Short answers in plain words", "share": False},
]


def load(path=None):
    path = path or PATH
    try:
        return clean(json.loads(pathlib.Path(path).read_text(encoding="utf-8"))["facts"])
    except FileNotFoundError:
        return [dict(f) for f in STARTER]


def clean(facts):
    """Check the shape and limits; rows without a label are dropped. Raises ValueError if it's not a list of facts."""
    if not isinstance(facts, list):
        raise ValueError("facts must be a list")
    out = []
    for f in facts:
        if not isinstance(f, dict):
            raise ValueError("each fact must be an object with label, value and share")
        label = str(f.get("label", "")).strip()[:60]
        if label:
            out.append({"label": label, "value": str(f.get("value", "")).strip()[:500], "share": bool(f.get("share"))})
    if len(out) > MAX_FACTS:
        raise ValueError(f"at most {MAX_FACTS} facts")
    return out


def save(facts, path=None):
    path = path or PATH
    facts = clean(facts)
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)  # data/ may not exist yet
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"facts": facts}, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)  # write-then-rename, so a crash can't leave a half-written file
    return facts


def shared(facts):
    """The facts that will actually be sent: ticked and filled in."""
    return [f for f in facts if f["share"] and f["value"]]


HEADER = "About the user (the harness adds these facts to every conversation; use them when they're relevant):"


def addition(facts):
    """The exact text added to the system prompt ("" if nothing is shared)."""
    lines = [f"- {f['label']}: {f['value']}" for f in shared(facts)]
    if not lines:
        return ""
    return HEADER + "\n" + "\n".join(lines)


def count_in(system):
    """How many facts a system prompt carries: the "- label: value" lines under the header."""
    if HEADER not in system:
        return 0
    n = 0
    for line in system.split(HEADER, 1)[1].splitlines()[1:]:
        if not line.startswith("- "):
            break
        n += 1
    return n


# A tool so the model can suggest a new fact. It asks you first by default (see DEFAULT_PERMISSIONS in core/loop.py).
REMEMBER_TOOL = {
    "name": "remember_fact",
    "description": (
        "Save a lasting fact or preference about the user (for example their name, preferred units or how they "
        "like answers) so it is shared in every future conversation. Use it when the user tells you something "
        "about themselves that will still be true later, not for one-off details. Depending on the user's "
        "settings, they may be asked to approve the save first."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "label": {"type": "string", "description": "What the fact is about, e.g. 'Preferred temperature unit'"},
            "value": {"type": "string", "description": "The fact itself, e.g. 'Fahrenheit'"},
        },
        "required": ["label", "value"],
    },
}


def find(facts, label):
    """The fact with this label, whatever its case (labels are matched that way), or None."""
    label = str(label).strip().lower()
    return next((f for f in facts if f["label"].lower() == label), None)


def remember(label, value, path=None):
    """Add a fact (or update the one with the same label) and share it."""
    facts = load(path)
    label, value = str(label).strip(), str(value).strip()
    if not label or not value:
        raise ValueError("both label and value are needed")
    old = find(facts, label)
    if old:
        old["value"], old["share"] = value, True
    else:
        facts.append({"label": label, "value": value, "share": True})
    save(facts, path)
    return f"Saved to the user's profile: {label}: {value}. It will be shared in their future conversations."


def system_prompt(base, facts):
    extra = addition(facts)
    return f"{base}\n\n{extra}" if extra else base
