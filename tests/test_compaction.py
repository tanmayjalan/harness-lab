"""Offline tests for compaction.py: replacing old history with a summary.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import pathlib
import tempfile
import time
import unittest
from types import SimpleNamespace as NS

from anthropic.types import TextBlock

from harness.features import compaction
from harness.core import loop, tools
from harness.features import lab_settings
from harness.web import server as web_server


def history():
    big = "x" * 3000
    return [
        {"role": "user", "content": "read the big file"},
        {"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "read_file", "input": {"path": "big"}}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": big}]},
        {"role": "assistant", "content": [{"type": "thinking", "thinking": "", "signature": "s"},
                                          {"type": "text", "text": "It's all x."}]},
        {"role": "user", "content": "and now something new"},
    ]


class SummaryClient:
    def __init__(self, summary="The user had a file read; it contained only x."):
        self.summary = summary
        self.calls = []
        self.messages = self

    def create(self, **kw):
        self.calls.append({**kw, "n": len(kw["messages"])})  # size at the time of the call
        if kw.get("system") == compaction.PROMPT:
            return NS(content=[TextBlock(type="text", text=self.summary)], usage=None)
        return NS(stop_reason="end_turn", content=[TextBlock(type="text", text="ok")])


class CompactTests(unittest.TestCase):
    def test_older_part_becomes_a_summary_merged_into_the_latest_message(self):
        client = SummaryClient()
        new, info = compaction.compact(history(), client, "m")
        self.assertEqual(len(new), 1)
        self.assertEqual(new[0]["role"], "user")
        self.assertTrue(new[0]["content"].startswith(compaction.HEADER))
        self.assertIn("contained only x", new[0]["content"])
        self.assertTrue(new[0]["content"].endswith("and now something new"))
        self.assertLess(info["after"], info["before"])
        self.assertIn("xxxx", client.calls[0]["messages"][0]["content"])   # the model saw the old part

    def test_works_with_real_reply_objects_in_the_history(self):
        from anthropic.types import ToolUseBlock
        h = [
            {"role": "user", "content": "what's 2+2?"},
            {"role": "assistant", "content": [TextBlock(type="text", text="Let me check."),
                                              ToolUseBlock(type="tool_use", id="t1", name="calculate", input={"expression": "2+2"})]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "2+2 = 4"}]},
            {"role": "assistant", "content": [TextBlock(type="text", text="It's 4.")]},
            {"role": "user", "content": "and now?"},
        ]
        client = SummaryClient()
        new, info = compaction.compact(h, client, "m")
        sent = client.calls[0]["messages"][0]["content"]
        self.assertIn("Let me check.", sent)
        self.assertIn("calculate", sent)
        self.assertIn("It's 4.", sent)
        self.assertEqual(info["messages_after"], 1)

    def test_cut_never_splits_a_tool_request_from_its_result(self):
        h = history()[:4] + [{"role": "user", "content": "next"}] + history()[1:3]
        self.assertEqual(compaction.split_point(h), 4)

    def test_nothing_old_means_nothing_to_do(self):
        self.assertEqual(compaction.compact([{"role": "user", "content": "hi"}], SummaryClient(), "m"), (None, None))


class CompactInTheLabTests(unittest.TestCase):
    def session(self, provider, over):
        path = pathlib.Path(tempfile.mkdtemp()) / "lab_settings.json"
        lab_settings.save({"compact": {"enabled": True, "over_chars": over}}, loop.SYSTEM, tools.TOOLS,
                          loop.default_permission, path)
        client = SummaryClient()
        s = web_server.Session(client, "test", provider=provider, settings_path=path)
        s.messages = history()[:4]
        return s, client

    def send(self, s, text):
        s.start(text)
        end = time.time() + 5
        while s.running and time.time() < end:
            time.sleep(0.01)

    def test_summarises_when_over_the_limit(self):
        s, client = self.session("mock", over=2000)
        self.send(s, "and now something new")
        compacted = [e for e in s.snapshot(0)["events"] if e["kind"] == "compacted"][0]
        self.assertIn("contained only x", compacted["summary"])
        self.assertEqual(len(s.messages), 2)   # summary+new message, then the reply
        self.assertEqual(client.calls[-1]["n"], 1)  # the model was sent the short history

    def test_leaves_it_alone_under_the_limit(self):
        s, client = self.session("mock", 100000)
        self.send(s, "hi")
        self.assertEqual(client.calls[-1]["n"], 5)  # full history sent

    def test_also_summarises_with_the_anthropic_api_cheaply(self):
        s, client = self.session("anthropic", over=2000)
        self.send(s, "and now something new")
        self.assertEqual(client.calls[-1]["n"], 1)  # the summary replaced the older turns
        summary_call = [c for c in client.calls if str(c["system"]).startswith("You summarise")][0]
        self.assertEqual(summary_call["output_config"], {"effort": "low"})  # adaptive thinking: keep it cheap


if __name__ == "__main__":
    unittest.main()
