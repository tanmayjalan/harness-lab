r"""A tiny MCP server with a few text tools, to show how a harness uses tools from MCP servers.

MCP (Model Context Protocol) is a standard way for a harness to get tools from a separate
program. This file is that separate program: the harness starts it, asks it which tools it
has, and asks it to run them. The harness never imports this code; they only exchange
messages over the program's standard input and output.

The harness starts it for you (see config/mcp_servers.json). Run on its own, it just waits
for a harness to talk to it:  .venv\Scripts\python examples\demo_mcp_server.py
"""
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError  # an error we expect: its message reaches the model

server = MCPServer("text-tools", log_level="WARNING")


@server.tool()
def word_count(text: str) -> str:
    """Count the words, characters and lines in a piece of text."""
    return f"{len(text.split())} words, {len(text)} characters, {text.count(chr(10)) + 1} lines"


@server.tool()
def reverse_text(text: str) -> str:
    """Reverse a piece of text, character by character."""
    return text[::-1]


@server.tool()
def make_slug(title: str) -> str:
    """Turn a title into a URL-friendly slug, e.g. 'Hello, World!' -> 'hello-world'."""
    words = "".join(c.lower() if c.isalnum() else " " for c in title).split()
    if not words:
        raise ToolError("the title has no letters or digits")
    return "-".join(words)


if __name__ == "__main__":
    server.run()  # talks over standard input/output
