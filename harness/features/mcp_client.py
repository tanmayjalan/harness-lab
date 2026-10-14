"""Offer the model tools from MCP servers (listed in mcp_servers.json).

For each server, the harness starts the program, asks which tools it has,
and adds them to the tool list as "<server>__<tool>". When the model calls
one, the harness passes the call to that server and sends back its answer.

The MCP library is asynchronous, while the harness loop is not, so all MCP
work runs on one background event loop; each server gets one long-lived
task that opens the connection, serves calls and closes it again.

If the mcp package isn't installed or a server won't start, the harness
carries on with its built-in tools and reports the problem.
"""
import asyncio
import json
import pathlib
import re
import sys
import threading

from harness import paths

CONFIG = paths.CONFIG / "mcp_servers.json"
START_TIMEOUT = 30  # seconds for a server to start and list its tools
CALL_TIMEOUT = 60   # seconds for one tool call


class MCPTools:
    def __init__(self, config=None):
        self.tools = []      # tool descriptions for the model, named "<server>__<tool>"
        self.sources = {}    # tool name -> "MCP: <server>"
        self.problems = []   # servers that couldn't be used, and why
        self._routes = {}    # tool name -> (server, its own name for the tool)
        self._sessions = {}
        self._loop = None
        try:
            from mcp import ClientSession, StdioServerParameters  # noqa: F401
        except ImportError:
            self.problems.append("the mcp package isn't installed (pip install mcp)")
            return
        path = pathlib.Path(config or CONFIG)
        if not path.exists():
            return
        servers = json.loads(path.read_text(encoding="utf-8")).get("servers", {})
        if not servers:
            return
        self._loop = asyncio.new_event_loop()
        self._closing = None
        threading.Thread(target=self._loop.run_forever, daemon=True).start()
        self._closing = self._run(self._make_event())
        for name, spec in servers.items():
            try:
                tools = self._run(self._start(name, spec), timeout=START_TIMEOUT + 5)
            except Exception as e:
                self.problems.append(f"{name}: {type(e).__name__}: {e}")
                continue
            for t in tools:
                api_name = re.sub(r"[^a-zA-Z0-9_-]", "_", f"{name}__{t.name}")[:64]
                self.tools.append({"name": api_name, "description": t.description or "",
                                   "input_schema": t.input_schema or {"type": "object", "properties": {}}})
                self.sources[api_name] = f"MCP: {name}"
                self._routes[api_name] = (name, t.name)

    def handles(self, name):
        return name in self._routes

    def call(self, name, args):
        """Run one MCP tool and return its text. Raises if the server reports an error."""
        server, tool = self._routes[name]
        result = self._run(self._sessions[server].call_tool(tool, args), timeout=CALL_TIMEOUT)
        text = "\n".join(c.text for c in getattr(result, "content", []) if getattr(c, "type", "") == "text")
        if getattr(result, "is_error", False):
            raise RuntimeError(text or "the MCP server reported an error")
        return text or "(the tool returned no text)"

    def close(self):
        if self._loop and self._closing is not None:
            self._loop.call_soon_threadsafe(self._closing.set)

    # ----- the asynchronous side -----
    def _run(self, coroutine, timeout=None):
        return asyncio.run_coroutine_threadsafe(coroutine, self._loop).result(timeout)

    async def _make_event(self):
        return asyncio.Event()

    async def _start(self, name, spec):
        ready = asyncio.get_running_loop().create_future()
        asyncio.create_task(self._serve(name, spec, ready))
        return await asyncio.wait_for(ready, START_TIMEOUT)

    async def _serve(self, name, spec, ready):
        # Opened and closed in this one task: the MCP library requires that.
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
        command = sys.executable if spec.get("command") == "python" else spec["command"]
        params = StdioServerParameters(command=command, args=spec.get("args", []), cwd=str(paths.ROOT),
                                       env=spec.get("env"))
        try:
            async with stdio_client(params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    listed = await session.list_tools()
                    self._sessions[name] = session
                    ready.set_result(listed.tools)
                    await self._closing.wait()  # stay connected until the harness closes
        except Exception as e:
            if not ready.done():
                ready.set_exception(e)


def load(config=None):
    """Connect to the servers in mcp_servers.json. Never raises: problems are listed in .problems."""
    try:
        return MCPTools(config)
    except Exception as e:  # e.g. a broken config file
        empty = MCPTools.__new__(MCPTools)
        empty.tools, empty.sources, empty.problems, empty._routes = [], {}, [f"{type(e).__name__}: {e}"], {}
        empty._loop = None
        return empty
