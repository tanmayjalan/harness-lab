"""Too many tools: send a tool's details only when the model needs them.

Every tool description goes with every model call. With the 40 office tools (core/office_tools.py) on
top of the usual ones, each call carries some 50 descriptions: more tokens on every call, and a harder
choice for the model. Claude Code meets the same problem with its many MCP tools.

The fix here is one more tool, find_tool. The model describes what it wants to do; the harness scores
the office tools against those words (as search_files scores files), loads the best few, and from the
next call on sends their full descriptions too. So:

    "all"   every office tool is sent on every call (to compare)
    "find"  only the usual tools and find_tool are sent; the tools found are added as they're found

A Toolbox holds one conversation's state: which office tools are loaded so far. They stay loaded for the
whole conversation, because the history holds their calls. Loading one changes the tool list, so the
start of the next request differs from the last one: the cache stops matching from the tools onward.
"""
import re

from harness.core import office_tools

MODES = ("all", "find")
FIND_TOP = 5  # tools loaded by one find_tool call, at most

FIND_TOOL = {
    "name": "find_tool",
    "description": "Find tools by what they do. The ones found can be used from your next step.",
    "input_schema": {
        "type": "object",
        "properties": {"query": {"type": "string", "description": "What you want to do, e.g. 'book a meeting room'"}},
        "required": ["query"],
    },
}

_BY_NAME = {t["name"]: t for t in office_tools.TOOLS}


class Toolbox:
    """The tool list for one conversation, with the office tools sent all at once or found on demand.

    `base`: the tools every call sends anyway (your usual tools, already edited by your settings).
    `mode`: "all" or "find". `used`: office tool names already loaded (read from a history with used_in)."""

    def __init__(self, base, mode, used=()):
        if mode not in MODES:
            raise ValueError(f"mode must be one of {', '.join(MODES)}")
        self.base, self.mode = list(base), mode
        self.loaded = []  # office tool names, in the order they were found (never re-sorted: see now())
        self._load(used)

    def _load(self, names):
        for name in names:
            if name in _BY_NAME and name not in self.loaded:
                self.loaded.append(name)

    def now(self):
        """The tools to send on this call: a fresh list. The base comes first and found tools are added at the
        end, in the order found, so the start of the list stays the same from call to call (a kept conversation
        start may already hold find_tool or the office tools: each name goes once)."""
        extra = office_tools.TOOLS if self.mode == "all" else [FIND_TOOL, *(_BY_NAME[n] for n in self.loaded)]
        names = {t["name"] for t in self.base}
        return [*self.base, *(t for t in extra if t["name"] not in names)]

    def find(self, query):
        """Score the office tools' names and descriptions against the query's words, load the best few, and
        return them as [{"name", "description"}], best first (empty when nothing matches)."""
        query = str(query or "").lower()
        words = [w for w in re.findall(r"[a-z0-9]+", query) if len(w) > 2] or query.split()
        hits = []
        for t in office_tools.TOOLS:
            name = t["name"].replace("_", " ")
            text = f"{name} {t['description']}".lower()
            score = sum(text.count(w) for w in words) + 3 * sum(w in name for w in words)
            if score:
                hits.append((score, t["name"]))
        hits.sort(key=lambda h: (-h[0], h[1]))
        top = [name for _, name in hits[:FIND_TOP]]
        self._load(top)
        return [{"name": n, "description": _BY_NAME[n]["description"]} for n in top]

    def run(self, run):
        """Wrap a run_tool function: find_tool goes to this Toolbox, office tools to their handlers, and
        everything else to `run`."""
        def wrapped(name, args):
            if name == "find_tool":
                return found_text(args.get("query", ""), self.find(args.get("query", "")))
            if name in office_tools.HANDLERS:
                if self.mode == "find" and name not in self.loaded:
                    raise ValueError(f"{name} isn't loaded. Use find_tool first, with words for what you want to "
                                     "do; the tools it finds can be used from your next step.")
                self._load([name])  # (used with all sent: still loaded if you switch to "find" later)
                return office_tools.HANDLERS[name](**args)
            return run(name, args)
        return wrapped


def found_text(query, found):
    """What the model gets back from find_tool: one "- name: description" line per tool found."""
    if not found:
        return f"No tools match {query!r}. Try other words for what you want to do."
    lines = "\n".join(f"- {t['name']}: {t['description']}" for t in found)
    return f"Found {len(found)} tool{'s' if len(found) != 1 else ''}. You can use them from your next step:\n{lines}"


def start(base, mode):
    """What every call sends with this mode, before anything is found: the base plus all 40 office tools, or
    plus find_tool. A conversation that keeps its start ("From your next conversation") keeps this list."""
    return Toolbox(base, mode).now()


def _get(block, key):
    return block.get(key) if isinstance(block, dict) else getattr(block, key, None)


def used_in(messages):
    """The office tools a history already loaded: those it called, and those find_tool returned. A Compare side,
    a re-run, an eval question, the terminal and a reopened conversation start their Toolbox from these."""
    names, finds = [], set()
    for m in messages or []:
        content = m.get("content") if isinstance(m, dict) else None
        if isinstance(content, str) or not content:
            continue
        for b in content:
            kind = _get(b, "type")
            if kind == "tool_use" and _get(b, "name") == "find_tool":
                finds.add(_get(b, "id"))
            elif kind == "tool_use" and _get(b, "name") in _BY_NAME:
                names.append(_get(b, "name"))
            elif kind == "tool_result" and _get(b, "tool_use_id") in finds and not _get(b, "is_error"):
                text = _get(b, "content")
                if isinstance(text, list):
                    text = "\n".join(_get(c, "text") or "" for c in text)
                names += re.findall(r"^- ([a-z_]+):", str(text or ""), re.MULTILINE)
    return [n for i, n in enumerate(names) if n in _BY_NAME and n not in names[:i]]
