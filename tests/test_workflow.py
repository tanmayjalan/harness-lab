"""Offline tests for the workflow: a fixed chain of agents (gather facts, write, check, fix) run by code.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import time
import unittest
from types import SimpleNamespace as NS

from anthropic.types import TextBlock, ToolUseBlock

from harness.core import loop, tools
from harness.features import lab_settings, workflow
from harness.web import compare
from harness.web import server as web_server


def says(text):
    return NS(stop_reason="end_turn", content=[TextBlock(type="text", text=text)])


def asks(name, **input):
    return NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id=f"t-{name}", name=name, input=input)])


class Client:
    """Answers in order and keeps every request it was sent."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.sent = []
        self.messages = self

    def create(self, **kwargs):
        self.sent.append({**kwargs, "messages": list(kwargs["messages"])})  # (the loop adds to the list later)
        return self.replies.pop(0)


FILE = lambda name, args: "Refunds: annual plans within 30 days."  # noqa: E731  (every tool "reads" this)


def chain(client, question="What's the refund policy?", messages=None, max_turns=20, **extra):
    events = []
    messages = messages if messages is not None else [{"role": "user", "content": question}]
    answer = workflow.run(messages, client, tools=tools.TOOLS, max_turns=max_turns, run=FILE, confirm=None,
                          on_event=lambda kind, **d: events.append((kind, d)), **extra)
    return answer, events, messages


def steps(events):
    return [(d["name"], d.get("verdict")) for k, d in events if k == "step_done"]


class VerdictTests(unittest.TestCase):
    def test_pass_and_problems_are_read_however_they_are_written(self):
        for text in ("PASS", "**PASS**", "Pass.", "\n pass\n", "PASS - all backed by the facts"):
            self.assertEqual(workflow.verdict(text)[0], "pass", text)
        self.assertEqual(workflow.verdict("PROBLEMS\n- says 60 days"), ("problems", "- says 60 days"))
        self.assertEqual(workflow.verdict("**Problems:** the 60 days is wrong"), ("problems", "the 60 days is wrong"))
        self.assertEqual(workflow.verdict("FAIL: wrong")[0], "problems")

    def test_a_reply_that_says_neither_is_unclear(self):
        self.assertEqual(workflow.verdict("Looks good to me")[0], "unclear")
        self.assertEqual(workflow.verdict("")[0], "unclear")
        self.assertEqual(workflow.verdict("Passable")[0], "unclear")  # (a word starting with "pass" isn't PASS)


class ChainTests(unittest.TestCase):
    def test_gather_write_check_in_order_and_only_the_answer_joins_the_conversation(self):
        c = Client(asks("read_file", path="handbook/refunds.md"), says("- annual: 30 days (refunds.md)"),
                   says("You can get a refund within 30 days."), says("PASS"))
        answer, events, messages = chain(c)
        self.assertEqual(answer, "You can get a refund within 30 days.")
        self.assertEqual(steps(events), [("gather", None), ("write", None), ("check", "pass")])
        # The main conversation gets the question and the answer: none of the steps' working
        self.assertEqual(messages, [{"role": "user", "content": "What's the refund policy?"},
                                    {"role": "assistant", "content": "You can get a refund within 30 days."}])

    def test_each_step_gets_only_what_the_code_passes_it(self):
        c = Client(asks("read_file", path="refunds.md"), says("- annual: 30 days"), says("Draft: 30 days."), says("PASS"))
        chain(c)
        gather, _, write, check = c.sent
        # Gathering may use the read-only tools; writing and checking get no tools at all
        self.assertTrue({t["name"] for t in gather["tools"]} <= set(workflow.subagents.READ_ONLY))
        self.assertNotIn("write_file", {t["name"] for t in gather["tools"]})
        self.assertNotIn("tools", write)
        self.assertNotIn("tools", check)
        # Each starts with one message of its own: the writer sees the notes, not the file the gatherer read
        self.assertEqual(len(write["messages"]), 1)
        self.assertIn("- annual: 30 days", write["messages"][0]["content"])
        self.assertNotIn("Refunds: annual plans", write["messages"][0]["content"])
        self.assertIn("Draft: 30 days.", check["messages"][0]["content"])
        self.assertEqual([s["system"] for s in c.sent[1:]], [workflow.GATHER, workflow.WRITE, workflow.CHECK])

    def test_problems_send_the_draft_back_to_be_fixed_then_checked_again(self):
        c = Client(says("- 30 days"), says("60 days."), says("PROBLEMS\n- the facts say 30 days"),
                   says("30 days."), says("**PASS**"))
        answer, events, _ = chain(c)
        self.assertEqual(answer, "30 days.")
        self.assertEqual(steps(events), [("gather", None), ("write", None), ("check", "problems"), ("fix", None),
                                         ("check", "pass")])
        fix = c.sent[3]["messages"][0]["content"]
        self.assertIn("60 days.", fix)
        self.assertIn("- the facts say 30 days", fix)

    def test_fixing_stops_after_the_last_fix_and_keeps_the_last_draft(self):
        c = Client(says("- 30 days"), says("v1"), *[r for i in range(workflow.FIXES)
                                                   for r in (says("PROBLEMS\n- wrong"), says(f"v{i + 2}"))],
                   says("PROBLEMS\n- still wrong"))
        answer, events, _ = chain(c)
        self.assertEqual(answer, f"v{workflow.FIXES + 1}")
        checks = [d for k, d in events if k == "step_done" and d["name"] == "check"]
        self.assertEqual(len(checks), workflow.FIXES + 1)
        self.assertTrue(checks[-1]["last"])
        self.assertFalse(any(d["last"] for d in checks[:-1]))
        self.assertEqual(c.replies, [])

    def test_a_check_the_code_cant_read_keeps_the_draft(self):
        c = Client(says("- 30 days"), says("30 days."), says("Looks fine to me."))
        answer, events, _ = chain(c)
        self.assertEqual(answer, "30 days.")
        self.assertEqual(steps(events)[-1], ("check", "unclear"))

    def test_events_say_what_each_step_was_sent_and_its_calls_say_which_step(self):
        c = Client(asks("read_file", path="refunds.md"), says("- 30 days"), says("30 days."), says("PASS"))
        _, events, _ = chain(c)
        started = [d for k, d in events if k == "step"]
        self.assertEqual([(d["n"], d["name"], d["label"]) for d in started],
                         [(1, "gather", "Gather facts"), (2, "write", "Write"), (3, "check", "Check")])
        self.assertIn("read_file", started[0]["tools"])
        self.assertEqual(started[1]["tools"], [])
        self.assertIn("- 30 days", started[1]["sent"])
        requests = [d for k, d in events if k == "request"]
        self.assertEqual([(d["step"], d["turn"]) for d in requests], [(1, 1), (1, 2), (2, 1), (3, 1)])
        self.assertEqual(requests[2]["step_tools"], [])

    def test_a_follow_up_brings_the_earlier_question_and_answer(self):
        messages = [{"role": "user", "content": "What's the refund policy?"},
                    {"role": "assistant", "content": [TextBlock(type="text", text="30 days for annual plans.")]},
                    {"role": "user", "content": "And for monthly plans?"}]
        c = Client(says("- monthly: none"), says("No refunds."), says("PASS"))
        chain(c, messages=messages)
        sent = c.sent[0]["messages"][0]["content"]
        self.assertIn("User: What's the refund policy?", sent)
        self.assertIn("Assistant: 30 days for annual plans.", sent)
        self.assertIn("Question: And for monthly plans?", sent)
        self.assertEqual(messages[-1], {"role": "assistant", "content": "No refunds."})

    def test_the_call_limit_is_for_the_whole_message(self):
        c = Client(asks("read_file", path="a"), asks("read_file", path="b"), says("- notes"), says("draft"))
        with self.assertRaisesRegex(RuntimeError, r"hit max_turns \(4\)"):
            chain(c, max_turns=4)  # gathering takes 3, writing 1: no call left to check
        self.assertEqual(len(c.sent), 4)

    def test_a_limit_reached_inside_a_step_names_the_message_limit(self):
        c = Client(asks("read_file", path="a"), asks("read_file", path="b"), asks("read_file", path="c"))
        with self.assertRaisesRegex(RuntimeError, r"hit max_turns \(3\)"):
            chain(c, max_turns=3)

    def test_stop_ends_the_chain(self):
        c = Client(says("- notes"), says("draft"), says("PASS"))
        with self.assertRaises(loop.Stopped):
            chain(c, should_stop=lambda: len(c.sent) >= 1)
        self.assertEqual(len(c.sent), 1)


class SettingTests(unittest.TestCase):
    def test_off_by_default_kept_when_on_and_named_in_what_changed(self):
        self.assertFalse(lab_settings.workflow(lab_settings.empty()))
        s = lab_settings.clean({"workflow": {"enabled": True}}, loop.SYSTEM, tools.TOOLS, loop.default_permission)
        self.assertEqual(s["workflow"], {"enabled": True})
        self.assertTrue(lab_settings.workflow(s))
        self.assertIn("workflow on", lab_settings.what_changed(s))
        off = lab_settings.clean({"workflow": {"enabled": False}}, loop.SYSTEM, tools.TOOLS, loop.default_permission)
        self.assertIsNone(off["workflow"])
        with self.assertRaises(ValueError):
            lab_settings.clean({"workflow": True}, loop.SYSTEM, tools.TOOLS, loop.default_permission)

    def test_badges_and_snapshot(self):
        s = {**lab_settings.empty(), "workflow": {"enabled": True}}
        snap = lab_settings.snapshot(s, provider="mock", label="Mock", model="m", system="S", facts_shared=0,
                                     tools=[], permission=lambda n: "allow", source=lambda n: "built in")
        self.assertEqual(snap["workflow"], {"enabled": True})
        self.assertIn("workflow", lab_settings.badges(snap))


class PageTests(unittest.TestCase):
    """The web server's conversation, with the setting on."""

    def session(self, client):
        path = isolate.TMP / f"settings-{time.time_ns()}.json"
        lab_settings.save({"workflow": {"enabled": True}}, loop.SYSTEM, tools.TOOLS, loop.default_permission, path)
        return web_server.Session(client, "Mock", provider="mock", settings_path=path,
                                  profile_path=isolate.TMP / f"profile-{time.time_ns()}.json")

    def send(self, s, text):
        self.assertTrue(s.start(text))
        end = time.time() + 10
        while s.running and time.time() < end:
            time.sleep(0.01)
        self.assertFalse(s.running)

    def test_two_messages_keep_a_valid_conversation(self):
        c = Client(asks("calculate", expression="2+2"), says("- notes.md exists"), says("There is notes.md."), says("PASS"),
                   says("- nothing else"), says("Nothing else."), says("PASS"))
        s = self.session(c)
        self.send(s, "What files are there?")
        self.send(s, "Anything else?")
        self.assertEqual([m["role"] for m in s.messages], ["user", "assistant", "user", "assistant"])
        answers = [e["text"] for e in s.events if e["kind"] == "answer"]
        self.assertEqual(answers, ["There is notes.md.", "Nothing else."])
        self.assertIn("Assistant: There is notes.md.", c.sent[4]["messages"][0]["content"])

    def test_each_call_records_only_the_tools_its_step_was_offered(self):
        c = Client(says("- notes"), says("draft"), says("PASS"))
        s = self.session(c)
        self.send(s, "Hi")
        requests = [e for e in s.events if e["kind"] == "request"]
        self.assertEqual([r["step"] for r in requests], [1, 2, 3])
        gathered = {t["name"] for t in requests[0]["tools"]}
        self.assertIn("read_file", gathered)
        self.assertNotIn("write_file", gathered)
        self.assertEqual(requests[1]["tools"], [])
        self.assertTrue(all("step_tools" not in r for r in requests))
        self.assertEqual([e["name"] for e in s.events if e["kind"] == "step"], ["gather", "write", "check"])
        self.assertIn("workflow on", requests[0]["config"]["edited"])

    def test_a_new_step_starting_afresh_is_not_a_changed_start(self):
        c = Client(says("- notes"), says("draft"), says("PASS"))
        s = self.session(c)
        self.send(s, "Hi")
        self.assertFalse(any(e.get("start_changed") for e in s.events if e["kind"] == "request"))


class CompareTests(unittest.TestCase):
    def test_a_side_can_answer_with_the_workflow(self):
        c = Client(says("- notes"), says("The answer."), says("PASS"))
        result = compare.run_one(c, "m", "Question?", system="S", tools=tools.TOOLS,
                                 permission=lambda n: "allow", workflow_on=True)
        self.assertEqual(result["answer"], "The answer.")
        self.assertEqual(len(result["calls"]), 3)
        kinds = [e["kind"] for e in result["events"]]
        self.assertEqual(kinds.count("step"), 3)
        self.assertEqual(result["messages"][-1], {"role": "assistant", "content": "The answer."})


if __name__ == "__main__":
    unittest.main()
