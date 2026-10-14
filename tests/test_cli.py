"""Offline tests for the terminal version (cli.py): a fake model, scripted replies, no API key.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import contextlib
import io
import unittest
import unittest.mock
from types import SimpleNamespace as NS

from anthropic.types import TextBlock, ToolUseBlock

from harness import cli
from harness.core import loop, tools
from harness.features import lab_settings


def answer(text):
    return NS(stop_reason="end_turn", content=[TextBlock(type="text", text=text)])


def call(id, name, **input):
    return NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id=id, name=name, input=input)])


class Client:
    """Answers from a script and keeps every request it got."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.requests = []
        self.messages = self

    def create(self, **kwargs):
        self.requests.append({**kwargs, "messages": [dict(m) for m in kwargs["messages"]]})
        return self.replies.pop(0)


def settings(**changes):
    return lab_settings.clean(changes, loop.SYSTEM, tools.TOOLS, loop.default_permission)


def run(client, text, s=None, history=(), provider="mock", confirm=lambda prompt: "n"):
    """One message through the terminal version; returns (answer, what it printed)."""
    lines = []
    messages = [*history, {"role": "user", "content": text}]
    out = io.StringIO()
    with contextlib.redirect_stdout(out):  # anything printed outside `say` would show up here
        result = cli.one_message(messages, client, provider, "m", s or settings(), [], confirm=confirm, say=lines.append)
    return result, lines, out.getvalue()


class SettingsReachTheModelTests(unittest.TestCase):
    # F291: the page's limits, thinking and caching apply in the terminal too
    def test_limits_thinking_and_caching_are_sent(self):
        client = Client(answer("hi"))
        run(client, "hello", settings(limits={"max_tokens": 3000, "max_turns": 5},
                                      thinking={"enabled": True, "budget": 2000}, cache={"enabled": True}))
        sent = client.requests[0]
        self.assertEqual(sent["max_tokens"], 3000)
        self.assertEqual(sent["thinking"], {"type": "enabled", "budget_tokens": 2000})
        self.assertIn("cache_control", sent["system"][0])

    def test_the_call_limit_applies(self):
        roll = call("r", "roll_dice", sides=6)
        client = Client(roll, roll, roll)
        result, lines, _ = run(client, "keep rolling", settings(limits={"max_tokens": 16000, "max_turns": 2}))
        self.assertEqual(len(client.requests), 2)
        self.assertIn("Stopped after 2 model calls", result)  # in plain words, as the answer

    # F291: trimming shortens old tool results in the copy that's sent
    def test_trimming_applies(self):
        long = "x" * 500
        history = []
        for i in range(3):
            history += [{"role": "user", "content": f"read {i}"},
                        {"role": "assistant", "content": [{"type": "tool_use", "id": f"t{i}", "name": "read_file", "input": {"path": "a"}}]},
                        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": f"t{i}", "content": long}]},
                        {"role": "assistant", "content": "ok"}]
        client = Client(answer("done"))
        run(client, "and now?", settings(trim={"enabled": True, "keep_last": 1}), history=history)
        sent = [b.get("content") for m in client.requests[0]["messages"] if isinstance(m["content"], list)
                for b in m["content"] if b.get("type") == "tool_result"]
        self.assertEqual(sum(c == long for c in sent), 1)  # only the newest round kept whole

    # F291 (the bug found next to it): a helper in the terminal follows your Block, as in the page
    def test_a_helper_follows_your_block(self):
        client = Client(call("d1", "delegate", task="read notes.md"),
                        call("h1", "read_file", path="notes.md"), answer("couldn't read it"),
                        answer("The helper couldn't read it."))
        run(client, "use a helper to read notes.md", settings(permissions={"read_file": "block"}))
        helper_second_call = client.requests[2]["messages"]
        result = helper_second_call[-1]["content"][0]
        self.assertIn("settings block this tool", result["content"])


class PrintingTests(unittest.TestCase):
    # F290: each tool is printed once, after it ran or didn't, with what happened; the loop prints nothing
    def test_a_blocked_tool_is_printed_once_as_blocked(self):
        client = Client(call("t1", "roll_dice", sides=6), answer("blocked"))
        result, lines, printed = run(client, "roll", settings(permissions={"roll_dice": "block"}))
        tool_lines = [line for line in lines if "roll_dice" in line]
        self.assertEqual(len(tool_lines), 1)
        self.assertIn("blocked by your settings", tool_lines[0])
        self.assertEqual(printed, "")

    def test_a_declined_tool_says_you_declined(self):
        client = Client(call("w1", "write_file", path="out.txt", content="x"), answer("ok"))
        _, lines, _ = run(client, "write it")
        self.assertTrue(any("write_file" in line and "you declined" in line for line in lines))

    # F292: a cut-off reply is said in plain words
    def test_a_cut_off_reply_is_said_in_plain_words(self):
        client = Client(NS(stop_reason="max_tokens", content=[TextBlock(type="text", text="Half an ans")]))
        result, _, _ = run(client, "write a lot")
        self.assertNotIn("[stopped early: max_tokens]", result)
        self.assertIn("cut off: the reply reached the longest-reply limit", result)


class WorkflowTests(unittest.TestCase):
    def test_with_the_workflow_on_each_step_and_the_check_are_said(self):
        client = Client(call("w1", "calculate", expression="2+2"), answer("- 2+2 is 4"), answer("It's 4."),
                        answer("PASS"))
        result, lines, printed = run(client, "What is 2+2?", settings(workflow={"enabled": True}))
        self.assertEqual(result, "It's 4.")
        self.assertEqual(lines, ["  [step 1: Gather facts]", "  -> calculate({'expression': '2+2'}): ran",
                                 "  [step 2: Write]", "  [step 3: Check]", "  [check: pass]"])
        self.assertEqual(printed, "")
        self.assertNotIn("tools", client.requests[2])  # the writer is offered no tools


class SessionTests(unittest.TestCase):
    def run_main(self, inputs, facts=()):
        out = io.StringIO()
        replies = iter(inputs)

        def fake_input(prompt=""):
            item = next(replies)
            if isinstance(item, BaseException):
                raise item
            return item
        with unittest.mock.patch("builtins.input", fake_input), \
                unittest.mock.patch.object(cli, "make_client", lambda provider: Client(answer("hi"))), \
                unittest.mock.patch.object(cli.memory, "load", lambda *a: list(facts)), \
                unittest.mock.patch("sys.argv", ["cli", "--provider", "deepseek"]), \
                contextlib.redirect_stdout(out):
            cli.main()
        return out.getvalue()

    # F292: the banner names the lab and counts facts in words
    def test_the_banner_names_the_lab_and_counts_facts(self):
        out = self.run_main(["exit"], facts=[{"label": "Unit", "value": "C", "share": True}])
        self.assertIn("Harness lab, terminal version", out)
        self.assertIn("1 fact about you", out)
        self.assertNotIn("Simple harness", out)

    # F292: Ctrl+C or Ctrl+Z (end of input) ends it without a traceback
    def test_ctrl_c_and_end_of_input_end_cleanly(self):
        for stop in (KeyboardInterrupt(), EOFError()):
            with self.subTest(stop=type(stop).__name__):
                self.assertIn("Bye.", self.run_main(["hello", stop]))


if __name__ == "__main__":
    unittest.main()
