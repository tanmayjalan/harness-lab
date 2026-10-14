"""Offline tests for running several tools at once: allowed tools from one reply run at the same time.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import threading
import time
import unittest
from types import SimpleNamespace as NS

from anthropic.types import TextBlock, ToolUseBlock

from harness.core import loop, tools
from harness.features import lab_settings
from harness.web import compare


def ask_for(*names):
    return NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id=f"t{i}", name=n, input={"city": n})
                                               for i, n in enumerate(names)])


def answer(text="done"):
    return NS(stop_reason="end_turn", content=[TextBlock(type="text", text=text)])


class Client:
    def __init__(self, *replies):
        self.replies = list(replies)
        self.sent = []
        self.messages = self

    def create(self, **kwargs):
        self.sent.append(list(kwargs["messages"]))
        return self.replies.pop(0)


def slow_run(delay=0.3, order=None):
    def run(name, args):
        time.sleep(delay if name != "fast" else delay / 3)
        if order is not None:
            order.append(name)
        return f"{name} done"
    return run


ALL_ALLOWED = lambda name: "allow"  # noqa: E731
EVERYTHING = lambda name: True  # noqa: E731  (every tool may run alongside others)


def offering(client):
    """A tool list that offers every name the scripted replies ask for (the loop runs only tools it offered)."""
    names = sorted({b.name for r in client.replies for b in r.content if b.type == "tool_use"})
    return [{"name": n, "description": n, "input_schema": {"type": "object"}} for n in names]


def agent(client, at_once=EVERYTHING, permission=ALL_ALLOWED, run=None, hooks=None, should_stop=lambda: False,
          tools=None):
    events = []
    loop.agent([{"role": "user", "content": "go"}], client, confirm=lambda p: "y", permission=permission,
               run=run or slow_run(), hooks=hooks, at_once=at_once, should_stop=should_stop,
               tools=offering(client) if tools is None else tools,
               on_event=lambda kind, **d: events.append((kind, d)))
    return events


class AtOnceTests(unittest.TestCase):
    def test_three_allowed_tools_run_at_the_same_time(self):
        client = Client(ask_for("Paris", "Tokyo", "London"), answer())
        started = time.time()
        events = agent(client)
        self.assertLess(time.time() - started, 0.6)  # about one lookup, not three (0.9 s)
        note = next(d for k, d in events if k == "tools_at_once")
        self.assertEqual((note["count"], note["together"], note["reason"]), (3, True, None))
        self.assertEqual([d["outcome"] for k, d in events if k == "tool_result"], ["ran"] * 3)

    def test_a_tool_this_call_did_not_offer_is_not_run_alongside_the_others(self):
        client = Client(ask_for("Paris", "Tokyo"), answer())
        ran = []
        events = agent(client, run=lambda name, args: ran.append(name) or "ok",
                       tools=[{"name": "Paris", "description": "", "input_schema": {"type": "object"}}])
        outcomes = {d["result"]["tool_use_id"]: d["outcome"] for k, d in events if k == "tool_result"}
        self.assertEqual(outcomes, {"t0": "ran", "t1": "not_run"})
        self.assertEqual(ran, ["Paris"])
        [refused] = [d["result"] for k, d in events if k == "tool_result" and d["outcome"] == "not_run"]
        self.assertTrue(refused["is_error"])
        self.assertIn("Tokyo wasn't offered to you", refused["content"])

    def test_results_go_back_in_the_reply_s_order(self):
        client = Client(ask_for("slow", "fast"), answer())
        order = []
        agent(client, run=slow_run(order=order))
        self.assertEqual(order, ["fast", "slow"])  # the fast one finished first...
        sent = [r["content"] for r in client.sent[1][-1]["content"]]
        self.assertEqual(sent, ["slow done", "fast done"])  # ...but the model gets them in its own order

    def test_every_request_is_announced_before_any_result_and_each_result_when_ready(self):
        events = agent(Client(ask_for("slow", "fast"), answer()))
        kinds = [k for k, _ in events if k in ("tool_call", "tool_result")]
        self.assertEqual(kinds, ["tool_call", "tool_call", "tool_result", "tool_result"])
        results = [d["result"]["tool_use_id"] for k, d in events if k == "tool_result"]
        self.assertEqual(results, ["t1", "t0"])  # the fast one's result first
        self.assertTrue(all(d.get("together") for k, d in events if k == "tool_call"))

    def test_one_tool_that_asks_first_makes_them_all_run_one_by_one(self):
        client = Client(ask_for("Paris", "remember_fact"), answer())
        rule = lambda name: "ask" if name == "remember_fact" else "allow"  # noqa: E731
        started = time.time()
        events = agent(client, permission=rule)
        self.assertGreaterEqual(time.time() - started, 0.6)
        note = next(d for k, d in events if k == "tools_at_once")
        self.assertFalse(note["together"])
        self.assertIn("remember_fact is set to Ask first", note["reason"])

    def test_a_tool_that_must_run_alone_makes_them_run_one_by_one(self):
        events = agent(Client(ask_for("Paris", "delegate"), answer()), at_once=lambda name: name != "delegate")
        note = next(d for k, d in events if k == "tools_at_once")
        self.assertFalse(note["together"])
        self.assertIn("delegate", note["reason"])

    def test_off_means_one_by_one_and_no_note(self):
        events = agent(Client(ask_for("Paris", "Tokyo"), answer()), at_once=None)
        self.assertNotIn("tools_at_once", [k for k, _ in events])
        self.assertFalse(any(d.get("together") for k, d in events if k == "tool_call"))

    def test_your_hooks_run_one_at_a_time(self):
        busy, most = [0], [0]
        lock = threading.Lock()

        def hook(*args):
            with lock:
                busy[0] += 1
                most[0] = max(most[0], busy[0])
            time.sleep(0.05)
            with lock:
                busy[0] -= 1
            return None
        hooks = NS(before=hook, after=hook, describe=lambda: {})
        events = agent(Client(ask_for("Paris", "Tokyo", "London"), answer()), hooks=hooks)
        self.assertEqual(most[0], 1)
        self.assertEqual(len([1 for k, d in events if k == "hook"]), 6)  # before and after, for each of the three

    def test_a_hook_that_blocks_one_lets_the_others_run(self):
        hooks = NS(before=lambda name, args: "not Tokyo" if name == "Tokyo" else None, after=None, describe=lambda: {})
        client = Client(ask_for("Paris", "Tokyo"), answer())
        events = agent(client, hooks=hooks)
        outcomes = {d["result"]["tool_use_id"]: d["outcome"] for k, d in events if k == "tool_result"}
        self.assertEqual(outcomes, {"t0": "ran", "t1": "hook_blocked"})

    def test_stop_pressed_once_the_reply_is_in_runs_none_of_its_tools(self):
        client = Client(ask_for("Paris", "Tokyo"), answer())
        events = []
        with self.assertRaises(loop.Stopped):
            loop.agent([{"role": "user", "content": "go"}], client, confirm=lambda p: "y", permission=ALL_ALLOWED,
                       run=slow_run(), at_once=EVERYTHING, should_stop=lambda: len(client.sent) >= 1, tools=offering(client),
                       on_event=lambda kind, **d: events.append((kind, d)))
        self.assertEqual([d["outcome"] for k, d in events if k == "tool_result"], ["not_run", "not_run"])


class SettingTests(unittest.TestCase):
    def test_it_is_a_setting_off_by_default(self):
        clean = lambda c: lab_settings.clean(c, loop.SYSTEM, tools.TOOLS, loop.default_permission)  # noqa: E731
        self.assertEqual(clean({"tools_at_once": {"enabled": True}})["tools_at_once"], {"enabled": True})
        self.assertIsNone(clean({})["tools_at_once"])
        self.assertIn("tools at once", lab_settings.what_changed(clean({"tools_at_once": {"enabled": True}})))
        with self.assertRaises(ValueError):
            clean({"tools_at_once": "yes"})

    def test_which_tools_may_run_alongside_others(self):
        may = lab_settings.at_once({"tools_at_once": {"enabled": True}})
        self.assertTrue(may("get_weather"))
        for alone in ("delegate", "write_file", "remember_fact", "load_skill"):
            self.assertFalse(may(alone), alone)
        self.assertIsNone(lab_settings.at_once({}))


class CompareSideTests(unittest.TestCase):
    # The Compare preset needs a side to honour it
    def test_a_compare_side_can_run_tools_at_once(self):
        client = Client(ask_for("Paris", "Tokyo", "London"), answer())
        side = {"label": "A", "model": "m", "client": client, "system": "S", "tools": tools.TOOLS,
                "permission": ALL_ALLOWED, "run": slow_run(), "at_once": EVERYTHING}
        started = time.time()
        [result] = compare.compare([side], "weather in three cities", save=False)
        self.assertLess(time.time() - started, 0.6)
        self.assertEqual(len(result["tools"]), 3)


if __name__ == "__main__":
    unittest.main()
