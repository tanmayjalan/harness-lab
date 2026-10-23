"""Offline tests for tally.py: how a run's tools, tokens and cost are added up, the same way for a
comparison side (compare.run_one) and a saved message (conversations.run_stats).

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import unittest
from types import SimpleNamespace as NS

from anthropic.types import TextBlock, ToolUseBlock

from harness.core import loop, tools
from harness.web import compare, conversations
from harness.web.tally import NOT_RUN, Tally


class Client:
    def __init__(self, *replies):
        self.replies = list(replies)
        self.messages = self

    def create(self, **kwargs):
        return self.replies.pop(0)


class OutcomeTests(unittest.TestCase):
    def test_the_outcomes_that_never_ran_are_every_one_but_ran_and_error(self):
        # The outcomes loop._run_one gives: "ran", "error", and the five below
        self.assertEqual(set(NOT_RUN), {"blocked", "declined", "hook_blocked", "unattended", "not_run"})

    def test_each_outcome_marks_the_tool_its_own_way(self):
        expected = {
            "ran": {},
            "error": {"failed": True, "outcome": "error"},
            "blocked": {"blocked": True, "outcome": "blocked"},
            "declined": {"blocked": True, "outcome": "declined"},
            "hook_blocked": {"blocked": True, "outcome": "hook_blocked"},
            "unattended": {"blocked": True, "unattended": True, "outcome": "unattended"},
            "not_run": {"blocked": True, "outcome": "not_run"},
        }
        for outcome, marks in expected.items():
            with self.subTest(outcome=outcome):
                tally = Tally()
                tally.tool_call("t1", "roll_dice", {"sides": 6})
                tally.tool_call("t2", "calculate", {})  # another call: left alone
                tally.tool_result("t1", outcome)
                self.assertEqual(tally.figures()["tools"],
                                 [{"name": "roll_dice", "input": {"sides": 6}, **marks},
                                  {"name": "calculate", "input": {}}])

    def test_tokens_and_cost_add_up_and_an_unknown_price_stays_unknown(self):
        tally = Tally()
        tally.response({"input_tokens": 100, "cache_read_input_tokens": 50, "output_tokens": 7}, 0.25, 1, False, 1.5)
        tally.response(None, None, 2, True, 0.5)
        figures = tally.figures()
        self.assertEqual((figures["tokens_read"], figures["tokens_written"], figures["cost"]), (150, 7, 0.25))
        self.assertEqual(figures["calls"][0], {"turn": 1, "sub": False, "input_tokens": 100, "cache_read": 50,
                                               "output_tokens": 7, "cost": 0.25, "seconds": 1.5})
        self.assertIsNone(Tally().figures()["cost"])


class BothCountersAgreeTests(unittest.TestCase):
    """A re-run shows the saved run beside the new one: a tool that wasn't run must look the same on both."""

    def test_a_tool_that_was_not_offered_is_marked_in_a_side_and_in_its_saved_conversation(self):
        asked = NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id="t1", name="no_such_tool",
                                                                 input={})])
        done = NS(stop_reason="end_turn", content=[TextBlock(type="text", text="ok")])
        side = compare.run_one(Client(asked, done), "m", "hi", "S", tools.TOOLS, loop.default_permission)
        saved = conversations.run_stats({"id": "c", "events": side["events"], "messages": []}, 0)
        mark = {"name": "no_such_tool", "input": {}, "blocked": True, "outcome": "not_run"}
        self.assertEqual(side["tools"], [mark])
        self.assertEqual(saved["tools"], [mark])


if __name__ == "__main__":
    unittest.main()
