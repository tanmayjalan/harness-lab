"""The web page with a throwaway copy of everything it saves: try anything without touching your real files.

Your profile, settings, conversations, hooks and the workspace are copied to a temporary folder, and
the server uses those copies. Approve writes, change settings, delete conversations: none of it
reaches data/, config/ or workspace/. Handy for demos and for testing the page.

    .venv\\Scripts\\python -m harness.web.sandbox                  mock provider, port 8100
    .venv\\Scripts\\python -m harness.web.sandbox --port 8200 --provider deepseek
    .venv\\Scripts\\python -m harness.web.sandbox --empty          start with no saved data at all

The temporary folder is printed on start; it's left in place so you can look at what changed.
"""
import pathlib
import shutil
import sys
import tempfile

from harness import paths
from harness.core import local_models, tools
from harness.features import checkpoints, hooks, lab_settings, mcp_client, memory, skills
from harness import evals
from harness.web import compare, conversations


def prepare(empty=False):
    """Copy what the lab saves into a fresh temporary folder and point the lab at the copies."""
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="harness-sandbox-"))
    (tmp / "data").mkdir()
    if not empty and paths.DATA.exists():
        shutil.copytree(paths.DATA, tmp / "data", dirs_exist_ok=True)
    shutil.copytree(paths.WORKSPACE, tmp / "workspace")
    shutil.copytree(paths.CONFIG, tmp / "config")  # my_hooks.py logs to ../data, so the log lands in tmp too

    memory.PATH = tmp / "data" / memory.PATH.name
    lab_settings.PATH = tmp / "data" / lab_settings.PATH.name
    conversations.DIR = tmp / "data" / "conversations"
    evals.HISTORY = tmp / "data" / "evals"
    compare.HISTORY = tmp / "data" / "compare"
    checkpoints.DIR = tmp / "data" / "checkpoints"  # the copies of files Rewind puts back
    local_models.PATH = tmp / "data" / local_models.PATH.name  # the addresses of your own model servers
    hooks.PATH = tmp / "config" / hooks.PATH.name
    paths.CONFIG = tmp / "config"  # the eval questions (config/evals.json)
    mcp_client.CONFIG = tmp / "config" / mcp_client.CONFIG.name  # which MCP servers to start
    skills.DIR = tmp / "config" / "skills"
    tools.WORKSPACE = tmp / "workspace"
    return tmp


def main():
    empty = "--empty" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--empty"]
    if "--port" not in args:
        args += ["--port", "8100"]
    tmp = prepare(empty)
    print(f"Sandbox: everything this server saves goes to {tmp}")
    from harness.web import server  # imported after the paths are switched
    sys.argv = [sys.argv[0], *args]
    server.main()


if __name__ == "__main__":
    main()
