"""Offline tests for trimming.py: sending a smaller copy of a long history.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import copy
import pathlib
import tempfile
import time
import unittest
from types import SimpleNamespace as NS

from anthropic.types import TextBlock, ToolUseBlock

from harness.core import loop, tools
from harness.features import lab_settings
from harness.features import trimming
from harness.web import server as web_server

BIG = "x" * 5000


def tool_round(n, content=BIG):
    return [
        {"role": "assistant", "content": [{"type": "thinking", "thinking": "hm", "signature": "sig"},
                                          {"type": "tool_use", "id": f"t{n}", "name": "read_file", "input": {"path": "a"}}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": f"t{n}", "content": content}]},
    ]


class TrimTests(unittest.TestCase):
    def setUp(self):
        self.history = [{"role": "user", "content": "read things"}] + tool_round(1) + tool_round(2) + tool_round(3)

    def test_old_results_are_trimmed_recent_ones_kept(self):
        before = copy.deepcopy(self.history)
        sent, stats = trimming.trim(self.history, keep_last=2)
        self.assertEqual(stats, {"count": 1, "chars": 5000})
        self.assertIn("Trimmed by the harness", sent[2]["content"][0]["content"])
        self.assertEqual(sent[2]["content"][0]["tool_use_id"], "t1")   # still answers its request
        self.assertEqual(sent[4]["content"][0]["content"], BIG)        # recent rounds whole
        self.assertEqual(sent[6]["content"][0]["content"], BIG)
        self.assertEqual(sent[1], self.history[1])                     # thinking and tool requests untouched
        self.assertEqual(self.history, before)                         # the real history is unchanged

    def test_short_results_and_keep_all(self):
        history = [{"role": "user", "content": "go"}] + tool_round(1, "short") + tool_round(2)
        self.assertEqual(trimming.trim(history, keep_last=0)[1], {"count": 1, "chars": 5000})
        self.assertEqual(trimming.trim(history, keep_last=5)[1], {"count": 0, "chars": 0})


class TrimInTheLabTests(unittest.TestCase):
    def make_session(self, provider):
        path = pathlib.Path(tempfile.mkdtemp()) / "lab_settings.json"
        lab_settings.save({"trim": {"enabled": True, "keep_last": 1}}, loop.SYSTEM, tools.TOOLS,
                          loop.default_permission, path)

        class Client:
            sent = []
            messages = None

            def create(self, **kw):
                Client.sent.append(copy.deepcopy(kw["messages"]))
                return NS(stop_reason="end_turn", content=[TextBlock(type="text", text="ok")])
        client = Client()
        client.messages = client
        s = web_server.Session(client, "test", provider=provider, settings_path=path)
        s.messages = [{"role": "user", "content": "go"}] + tool_round(1) + tool_round(2)
        return s, Client.sent

    def run_one(self, s):
        s.start("and now?")
        end = time.time() + 5
        while s.running and time.time() < end:
            time.sleep(0.01)

    def test_trimmed_copy_is_sent_and_reported(self):
        s, sent = self.make_session("deepseek")
        self.run_one(s)
        self.assertIn("Trimmed by the harness", sent[0][2]["content"][0]["content"])
        self.assertEqual(s.messages[2]["content"][0]["content"], BIG)   # the history keeps it
        request = [e for e in s.snapshot(0)["events"] if e["kind"] == "request"][0]
        self.assertEqual(request["trimmed"], {"count": 1, "chars": 5000})

    def test_not_used_with_the_anthropic_api(self):
        s, sent = self.make_session("anthropic")
        self.run_one(s)
        self.assertEqual(sent[0][2]["content"][0]["content"], BIG)
        request = [e for e in s.snapshot(0)["events"] if e["kind"] == "request"][0]
        self.assertIn("skipped", request["trimmed"])


if __name__ == "__main__":
    unittest.main()
