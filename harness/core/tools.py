"""The tools: what the model is told about each one (TOOLS) and the code that runs it (run_tool).

The model never sees this code, only each tool's name, description and input shape.
When it asks for a tool, the loop calls run_tool here.
"""
import pathlib

from harness import paths
from harness.core import run_code, toy_tools
from harness.features import memory, planning, skills, subagents

# The folder the file tools work in. Relative paths start here, and anything outside it
# needs your OK, even for tools that are normally allowed (so the model can't quietly read
# your other files and send them to the provider).
WORKSPACE = paths.WORKSPACE
FILE_TOOLS = {"list_files", "read_file", "write_file"}
PATH_TOOLS = FILE_TOOLS | {"run_python"}  # tools whose "path" is checked against the workspace


def resolve(path):
    """Where a path really points: relative to the workspace, with .. and shortcuts followed."""
    return (pathlib.Path(WORKSPACE) / path).resolve()


def outside_workspace(name, args):
    if name not in PATH_TOOLS or not isinstance(args, dict) or "path" not in args:
        return False
    return not resolve(args["path"]).is_relative_to(pathlib.Path(WORKSPACE).resolve())


# Run code (core/run_code.py). Always listed, so Settings → Tools has its rule and description, but
# offered to the model only when Settings → Tools → "Run code" is on (lab_settings.offered_tools)
RUN_PYTHON_TOOL = {
    "name": "run_python",
    "description": (
        "Run a Python script and get back its exit code, what it printed and any errors. Give either code "
        "(a script you write) or path (a .py file in the workspace), not both. It runs from the workspace "
        "folder, so open files with paths like 'budget.csv'. It is stopped after "
        f"{run_code.TIME_LIMIT} seconds, and only the first {run_code.OUTPUT_LIMIT:,} characters of its output "
        "come back. It runs in isolated mode (-I): a script can't import files next to it, only Python's own "
        "modules and installed packages."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "code": {"type": "string", "description": "A whole Python script to run"},
            "path": {"type": "string", "description": "Or: a .py file in the workspace, e.g. scripts/greet.py"},
        },
    },
}

# What the model is told: describe each tool so it knows when and how to ask for it
TOOLS = [
    {
        "name": "list_files",
        "description": "List the files and folders inside a folder.",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string", "description": "Folder path"}},
            "required": ["path"],
        },
    },
    {
        "name": "read_file",
        "description": "Read a text file and return its contents.",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string", "description": "File path"}},
            "required": ["path"],
        },
    },
    {
        "name": "write_file",
        "description": (
            "Create or overwrite a text file."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path"},
                "content": {"type": "string", "description": "Full text to write"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "search_files",
        "description": "Search the text files in the workspace for words, and get back the best-matching files "
                       "with their matching lines. Use it to find which file holds something before reading it "
                       "(e.g. a policy in handbook/), instead of reading every file.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Words to look for, e.g. 'refund annual plan'"},
                "limit": {"type": "integer", "description": "How many files at most (default 5)"},
            },
            "required": ["query"],
        },
    },
    RUN_PYTHON_TOOL,
] + toy_tools.TOOLS + [memory.REMEMBER_TOOL, subagents.DELEGATE_TOOL,  # toys, memory, helpers,
                       planning.PLAN_TOOL]                             # and a plan


TEXT_FILES = {".md", ".txt", ".csv", ".py", ".json"}


def search_files(query, limit=5):
    """Retrieval in its simplest form: rank workspace files by how often they contain the query's
    words, and return the best few with their matching lines. Hidden files and folders (names
    starting with a dot, like private/.env) are never searched."""
    words = [w for w in query.lower().replace(",", " ").split() if len(w) > 2] or query.lower().split()
    if not words:
        raise ValueError("give some words to search for")
    root = pathlib.Path(WORKSPACE).resolve()
    hits = []
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        if not path.is_file() or path.suffix.lower() not in TEXT_FILES or any(p.startswith(".") for p in rel.parts):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        low = text.lower()
        score = sum(low.count(w) for w in words) + 3 * sum(w in rel.as_posix().lower() for w in words)
        if score:
            lines = [ln.strip() for ln in text.splitlines() if any(w in ln.lower() for w in words)][:2]
            hits.append((score, rel.as_posix(), lines))
    hits.sort(key=lambda h: (-h[0], h[1]))
    top = hits[:max(1, min(int(limit), 10))]
    if not top:
        return f"No files mention {query!r}."
    return "\n".join(f"{name} (score {score})\n" + "\n".join(f"  {ln[:160]}" for ln in lines) for score, name, lines in top)


# The code that actually runs when the model asks for a tool
def run_tool(name, args, profile_path=None):
    if name == "list_files":
        entries = sorted(resolve(args["path"]).iterdir())
        return "\n".join(p.name + ("/" if p.is_dir() else "") for p in entries) or "(empty folder)"

    if name == "read_file":
        return resolve(args["path"]).read_text(encoding="utf-8")

    if name == "write_file":
        path = resolve(args["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(args["content"], encoding="utf-8")
        return f"Wrote {len(args['content'])} characters to {path}"

    if name == "search_files":
        return search_files(args["query"], args.get("limit", 5))

    if name == "run_python":
        return run_code.run_python(code=args.get("code"), path=args.get("path"))

    if name in toy_tools.HANDLERS:
        return toy_tools.HANDLERS[name](**args)

    if name == "remember_fact":
        return memory.remember(args["label"], args["value"], profile_path)

    if name == "update_plan":
        return planning.update(args)

    if name == "load_skill":
        return skills.load(args)

    raise ValueError(f"Unknown tool: {name}")
