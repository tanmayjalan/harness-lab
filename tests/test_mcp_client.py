"""Tests for mcp_client.py. These start the real demo MCP server (a few seconds), but call no model.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import json
import pathlib
import tempfile
import time
import unittest
from types import SimpleNamespace as NS

from anthropic.types import TextBlock, ToolUseBlock

from harness.features import mcp_client
from harness.web import server as web_server


def config(servers):
    path = pathlib.Path(tempfile.mkdtemp()) / "mcp_servers.json"
    path.write_text(json.dumps({"servers": servers}), encoding="utf-8")
    return path


class MCPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mcp = mcp_client.load(config({"text-tools": {"command": "python", "args": ["examples/demo_mcp_server.py"]},
                                          "broken": {"command": "no-such-program-xyz"}}))

    @classmethod
    def tearDownClass(cls):
        cls.mcp.close()

    def test_tools_are_listed_with_the_server_name(self):
        names = [t["name"] for t in self.mcp.tools]
        self.assertEqual(names, ["text-tools__word_count", "text-tools__reverse_text", "text-tools__make_slug"])
        self.assertEqual(self.mcp.sources["text-tools__word_count"], "MCP: text-tools")
        self.assertIn("text", self.mcp.tools[0]["input_schema"]["properties"])

    def test_calls_go_to_the_server(self):
        self.assertEqual(self.mcp.call("text-tools__reverse_text", {"text": "abc"}), "cba")
        self.assertEqual(self.mcp.call("text-tools__make_slug", {"title": "Hello, World!"}), "hello-world")

    def test_server_errors_come_back_as_errors(self):
        with self.assertRaises(RuntimeError) as caught:
            self.mcp.call("text-tools__make_slug", {"title": "!!!"})
        self.assertIn("no letters or digits", str(caught.exception))

    def test_a_server_that_wont_start_is_skipped(self):
        self.assertTrue(any(p.startswith("broken:") for p in self.mcp.problems))

    def test_in_the_lab_mcp_tools_ask_first_and_run_through_the_server(self):
        client_replies = [
            NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id="t1", name="text-tools__word_count",
                                                            input={"text": "one two three"})]),
            NS(stop_reason="end_turn", content=[TextBlock(type="text", text="3 words")]),
        ]
        sent_tools = []

        class Client:
            messages = None

            def create(self, **kw):
                sent_tools.append([t["name"] for t in kw["tools"]])
                return client_replies.pop(0)
        client = Client()
        client.messages = client
        s = web_server.Session(client, "test", mcp=self.mcp)
        self.assertEqual(s.default_permission("text-tools__word_count"), "ask")
        self.assertEqual(s.default_permission("read_file"), "allow")
        s.start("count")
        end = time.time() + 10
        while not [e for e in s.snapshot(0)["events"] if e["kind"] == "approval"] and time.time() < end:
            time.sleep(0.02)
        approval = [e for e in s.snapshot(0)["events"] if e["kind"] == "approval"][0]
        s.decide(approval["id"], True)
        while s.running and time.time() < end:
            time.sleep(0.02)
        self.assertIn("text-tools__word_count", sent_tools[0])
        result = [e for e in s.snapshot(0)["events"] if e["kind"] == "tool_result"][0]["result"]
        self.assertTrue(result["content"].startswith("3 words"))


class NoMCPTests(unittest.TestCase):
    def test_no_config_means_no_tools_and_no_errors(self):
        empty = mcp_client.load(pathlib.Path(tempfile.mkdtemp()) / "missing.json")
        self.assertEqual((empty.tools, empty.problems), ([], []))

    def test_broken_config_is_reported_not_raised(self):
        path = pathlib.Path(tempfile.mkdtemp()) / "mcp_servers.json"
        path.write_text("{ not json", encoding="utf-8")
        broken = mcp_client.load(path)
        self.assertEqual(broken.tools, [])
        self.assertEqual(len(broken.problems), 1)


if __name__ == "__main__":
    unittest.main()
