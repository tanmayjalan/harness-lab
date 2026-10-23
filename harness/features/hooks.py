"""Loads your hooks (my_hooks.py) so the loop can call them around every tool call.

The file is loaded fresh each time, so edits apply from the next message. If it
has a mistake, the harness carries on without hooks and says why.
"""
import importlib.util
import pathlib

from harness import paths

PATH = paths.CONFIG / "my_hooks.py"


class Hooks:
    def __init__(self, before=None, after=None, problem=None, file=None):
        self.before = before      # before_tool(name, args) -> None or a reason to block
        self.after = after        # after_tool(name, args, result) -> None or replacement text
        self.problem = problem    # why the file couldn't be used, if it couldn't
        self.file = file

    def names(self):
        return [n for n, f in (("before_tool", self.before), ("after_tool", self.after)) if f]

    def describe(self):
        """Which file, which functions were found, and why it failed if it did (shown with each call)."""
        return {"file": self.file, "functions": self.names(), "problem": self.problem}


def load(path=None):
    path = pathlib.Path(path or PATH)
    if not path.exists():
        return Hooks(file=str(path))
    try:
        spec = importlib.util.spec_from_file_location("my_hooks", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)  # a fresh copy each time, so your edits apply
    except Exception as e:
        return Hooks(problem=f"{type(e).__name__}: {e}", file=str(path))
    return Hooks(getattr(module, "before_tool", None), getattr(module, "after_tool", None), file=str(path))
