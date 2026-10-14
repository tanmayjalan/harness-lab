"""Where everything lives. Every folder the lab uses is worked out here, from this file's own place."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent   # the Harness folder
CONFIG = ROOT / "config"        # files you're meant to edit: hooks, MCP servers, eval questions
DATA = ROOT / "data"            # what the lab saves as you use it (not in git)
WORKSPACE = ROOT / "workspace"  # the only folder the model's file tools use without asking
EXAMPLES = ROOT / "examples"    # example programs, e.g. the demo MCP server
