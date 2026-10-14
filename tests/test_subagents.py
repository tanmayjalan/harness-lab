"""Offline tests for subagents.py: delegating a job to a helper with its own history.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import pathlib
import tempfile
import time
import unittest
from types import SimpleNamespace as NS

from anthropic.types import TextBlock, ToolUseBlock

from harness.core import loop, tools
from harness.features import subagents
from harness.web import server as web_server


def tool_use(id, name, **input):
    return ToolUseBlock(type="tool_use", id=id, name=name, input=input)


def reply(stop, *content):
    return NS(stop_reason=stop, content=list(content))


class ScriptedClient:
    """Replies in order; remembers each call's system prompt, tools and history size."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []
        self.messages = self

    def create(self, **kw):
        self.calls.append({"system": kw["system"], "tools": [t["name"] for t in kw["tools"]],
                           "n": len(kw["messages"]), "first": kw["messages"][0]["content"]})
        return self.replies.pop(0)


class HelperTests(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        (self.tmp / "big.txt").write_text("x" * 20000, encoding="utf-8")

    def test_helper_works_in_its_own_history_and_only_the_report_comes_back(self):
        client = ScriptedClient(
            # main agent delegates
            reply("tool_use", tool_use("m1", "delegate", task="Read big.txt", report="its length")),
            # helper: reads the big file, then reports
            reply("tool_use", tool_use("h1", "read_file", path=str(self.tmp / "big.txt"))),
            reply("end_turn", TextBlock(type="text", text="big.txt has 20,000 characters.")),
            # main agent answers
            reply("end_turn", TextBlock(type="text", text="It has 20,000 characters.")),
        )
        messages = [{"role": "user", "content": "How long is big.txt?"}]
        run = subagents.with_delegate(tools.run_tool, client, "m", tools.TOOLS)
        answer = loop.agent(messages, client, run=run)
        self.assertEqual(answer, "It has 20,000 characters.")

        main1, helper1, helper2, main2 = client.calls
        self.assertEqual(helper1["system"], subagents.HELPER_SYSTEM)
        self.assertIn("Report back: its length", helper1["first"])   # fresh history: just the task
        self.assertEqual(helper1["n"], 1)
        self.assertNotIn("delegate", helper1["tools"])                 # no helpers of helpers
        self.assertNotIn("write_file", helper1["tools"])               # read-only
        # The main conversation got the short report, not the 20,000-character file
        result = messages[2]["content"][0]["content"]
        self.assertEqual(result, "big.txt has 20,000 characters.")
        self.assertLess(sum(len(str(m["content"])) for m in messages), 2000)

    def test_helper_cannot_write_even_if_it_tries(self):
        target = self.tmp / "out.txt"
        client = ScriptedClient(
            reply("tool_use", tool_use("h1", "write_file", path=str(target), content="x")),
            reply("end_turn", TextBlock(type="text", text="couldn't")),
        )
        report = subagents.run_helper({"task": "write a file"}, client, "m", tools.TOOLS, tools.run_tool,
                                      on_event=lambda kind, **d: None, should_stop=lambda: False)
        self.assertEqual(report, "couldn't")
        self.assertFalse(target.exists())


class HelperFollowsYourRulesTests(unittest.TestCase):
    def test_a_tool_you_blocked_is_blocked_for_the_helper_too(self):
        tmp = pathlib.Path(tempfile.mkdtemp())
        (tmp / "a.txt").write_text("secret-ish", encoding="utf-8")
        client = ScriptedClient(reply("tool_use", tool_use("h1", "read_file", path=str(tmp / "a.txt"))),
                                reply("end_turn", TextBlock(type="text", text="couldn't read it")))
        seen = []
        yours = lambda name: "block" if name == "read_file" else loop.default_permission(name)  # noqa: E731
        subagents.run_helper({"task": "read a.txt"}, client, "m", tools.TOOLS, tools.run_tool,
                             on_event=lambda kind, **d: seen.append((kind, d)), should_stop=lambda: False,
                             permission=yours)
        outcomes = [d.get("outcome") for k, d in seen if k == "tool_result"]
        self.assertEqual(outcomes, ["blocked"])

    # F298: a read-only tool set to Ask first stays "ask" for a helper, and is refused because nobody can be
    # asked (not reported as blocked by your settings); tools that write are never the helper's
    def test_ask_first_stays_ask_and_allow_stays_allow(self):
        rule = subagents.helper_rule(lambda name: {"read_file": "ask"}.get(name, "allow"))
        self.assertEqual((rule("read_file"), rule("calculate"), rule("write_file")), ("ask", "allow", "block"))

    def test_a_helper_cannot_ask_you(self):
        tmp = pathlib.Path(tempfile.mkdtemp())
        (tmp / "a.txt").write_text("hello", encoding="utf-8")
        client = ScriptedClient(reply("tool_use", tool_use("h1", "read_file", path=str(tmp / "a.txt"))),
                                reply("end_turn", TextBlock(type="text", text="couldn't read it")))
        seen = []
        yours = lambda name: "ask" if name == "read_file" else loop.default_permission(name)  # noqa: E731
        subagents.run_helper({"task": "read a.txt"}, client, "m", tools.TOOLS, tools.run_tool,
                             on_event=lambda kind, **d: seen.append((kind, d)), should_stop=lambda: False,
                             permission=yours)
        self.assertEqual([d.get("outcome") for k, d in seen if k == "tool_result"], ["unattended"])


class HelperInTheLabTests(unittest.TestCase):
    def test_helper_steps_reach_the_page_as_sub_events(self):
        tmp = pathlib.Path(tempfile.mkdtemp())
        (tmp / "a.txt").write_text("hello", encoding="utf-8")
        client = ScriptedClient(
            reply("tool_use", tool_use("m1", "delegate", task="Read a.txt")),
            reply("tool_use", tool_use("h1", "read_file", path=str(tmp / "a.txt"))),
            reply("end_turn", TextBlock(type="text", text="a.txt says hello")),
            reply("end_turn", TextBlock(type="text", text="It says hello.")),
        )
        s = web_server.Session(client, "test")
        s.start("what does a.txt say?")
        end = time.time() + 5
        while s.running and time.time() < end:
            time.sleep(0.01)
        events = s.snapshot(0)["events"]
        subs = [e["step"] for e in events if e["kind"] == "sub"]
        self.assertEqual(subs, ["request", "response", "tool_call", "tool_result", "request", "response"])
        delegate_result = [e for e in events if e["kind"] == "tool_result"][0]["result"]
        self.assertEqual(delegate_result["content"], "a.txt says hello")
        self.assertEqual(events[-2]["kind"], "answer")
        # each helper step says which delegate call it works for, and numbers the helper's own calls
        self.assertEqual({e["helper"] for e in events if e["kind"] == "sub"}, {"m1"})
        self.assertEqual([e["call"] for e in events if e["kind"] == "sub"], [1, 1, 1, 1, 2, 2])


if __name__ == "__main__":
    unittest.main()
