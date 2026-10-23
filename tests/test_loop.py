"""Offline tests: a fake Claude replays scripted replies, so no API key or cost.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import pathlib
import tempfile
import unittest
from types import SimpleNamespace as NS

from harness.core import loop, tools


def text(t):
    return NS(type="text", text=t)


def tool_use(id, name, **input):
    return NS(type="tool_use", id=id, name=name, input=input)


def reply(stop_reason, *content):
    return NS(stop_reason=stop_reason, content=list(content))


class FakeClient:
    """Stands in for anthropic.Anthropic(); returns scripted replies in order."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.sent = []  # the messages list as it was on each call
        self.messages = self  # so client.messages.create(...) works

    def create(self, **kwargs):
        self.sent.append(list(kwargs["messages"]))
        return self.replies.pop(0)


def tool_results(client, call_index):
    """The tool_result blocks the harness sent on a given call."""
    return client.sent[call_index][-1]["content"]


class HarnessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())

    def run_agent(self, client, confirm=lambda prompt: "n", **kw):
        messages = [{"role": "user", "content": "do the task"}]
        self.last_messages = messages  # the live history, even if agent() raises
        return loop.agent(messages, client, confirm=confirm, **kw), messages

    def test_plain_answer_needs_no_tools(self):
        client = FakeClient(reply("end_turn", text("Hello!")))
        answer, messages = self.run_agent(client)
        self.assertEqual(answer, "Hello!")
        self.assertEqual(len(client.sent), 1)
        self.assertEqual(messages[-1]["role"], "assistant")

    def test_tool_runs_and_result_goes_back_with_matching_id(self):
        (self.tmp / "notes.md").write_text("hi", encoding="utf-8")
        client = FakeClient(
            reply("tool_use", tool_use("t1", "list_files", path=str(self.tmp))),
            reply("end_turn", text("There is one file.")),
        )
        answer, _ = self.run_agent(client)
        self.assertEqual(answer, "There is one file.")
        [result] = tool_results(client, 1)
        self.assertEqual(result["tool_use_id"], "t1")
        self.assertEqual(result["content"], "notes.md")

    def test_parallel_tool_calls_share_one_message(self):
        (self.tmp / "a.txt").write_text("A", encoding="utf-8")
        (self.tmp / "b.txt").write_text("B", encoding="utf-8")
        client = FakeClient(
            reply(
                "tool_use",
                tool_use("t1", "read_file", path=str(self.tmp / "a.txt")),
                tool_use("t2", "read_file", path=str(self.tmp / "b.txt")),
            ),
            reply("end_turn", text("done")),
        )
        self.run_agent(client)
        results = tool_results(client, 1)
        self.assertEqual([r["tool_use_id"] for r in results], ["t1", "t2"])
        self.assertEqual([r["content"] for r in results], ["A", "B"])

    def test_tool_failure_is_reported_not_raised(self):
        client = FakeClient(
            reply("tool_use", tool_use("t1", "read_file", path=str(self.tmp / "missing.txt"))),
            reply("end_turn", text("That file does not exist.")),
        )
        answer, _ = self.run_agent(client)
        self.assertEqual(answer, "That file does not exist.")
        [result] = tool_results(client, 1)
        self.assertTrue(result["is_error"])
        self.assertIn("Error:", result["content"])

    def test_declined_write_leaves_no_file(self):
        target = self.tmp / "out.txt"
        client = FakeClient(
            reply("tool_use", tool_use("t1", "write_file", path=str(target), content="x")),
            reply("end_turn", text("ok")),
        )
        self.run_agent(client, confirm=lambda prompt: "n")
        self.assertFalse(target.exists())
        self.assertIn("declined", tool_results(client, 1)[0]["content"])

    def test_approved_write_creates_file(self):
        target = self.tmp / "sub" / "out.txt"
        client = FakeClient(
            reply("tool_use", tool_use("t1", "write_file", path=str(target), content="hello")),
            reply("end_turn", text("ok")),
        )
        self.run_agent(client, confirm=lambda prompt: "y")
        self.assertEqual(target.read_text(encoding="utf-8"), "hello")

    def test_early_stop_is_flagged(self):
        client = FakeClient(reply("max_tokens", text("partial")))
        answer, _ = self.run_agent(client)
        self.assertIn("[stopped early: max_tokens]", answer)

    def test_events_report_each_step_in_order(self):
        client = FakeClient(
            reply("tool_use", tool_use("t1", "list_files", path=str(self.tmp))),
            reply("end_turn", text("done")),
        )
        events = []
        self.run_agent(client, on_event=lambda kind, **data: events.append((kind, data)))
        self.assertEqual([k for k, _ in events],
                         ["request", "response", "tool_call", "tool_result", "request", "response"])
        self.assertEqual([d["turn"] for k, d in events if k == "request"], [1, 2])
        self.assertEqual(events[1][1]["stop_reason"], "tool_use")
        self.assertEqual(events[3][1]["result"]["tool_use_id"], "t1")

    def test_blocked_tool_never_runs(self):
        target = self.tmp / "out.txt"
        client = FakeClient(
            reply("tool_use", tool_use("t1", "write_file", path=str(target), content="x")),
            reply("end_turn", text("ok")),
        )
        self.run_agent(client, confirm=lambda p: "y", permission=lambda name: "block")
        self.assertFalse(target.exists())
        self.assertTrue(tool_results(client, 1)[0]["is_error"])

    def test_a_tool_this_call_did_not_offer_never_runs_whatever_the_rule(self):
        ran, events = [], []
        client = FakeClient(
            reply("tool_use", tool_use("t1", "write_file", path="x.txt", content="x"), tool_use("t2", "calculate",
                                                                                                expression="1+1")),
            reply("end_turn", text("ok")),
        )
        offered = [t for t in tools.TOOLS if t["name"] == "calculate"]
        self.run_agent(client, confirm=lambda p: "y", permission=lambda name: "allow", tools=offered,
                       run=lambda name, args: ran.append(name) or "2",
                       on_event=lambda kind, **d: events.append((kind, d)))
        self.assertEqual(ran, ["calculate"])  # write_file was never run
        refused, fine = tool_results(client, 1)
        self.assertTrue(refused["is_error"])
        self.assertTrue(refused["content"].startswith("Not run: write_file wasn't offered to you on this call"))
        self.assertNotIn("find_tool", refused["content"])  # (the hint is only for a list that has find_tool)
        self.assertEqual(fine["content"], "2")
        self.assertEqual([d["outcome"] for k, d in events if k == "tool_result"], ["not_run", "ran"])

    def test_with_no_tools_at_all_nothing_runs(self):  # (a workflow's writing step)
        ran = []
        client = FakeClient(reply("tool_use", tool_use("t1", "calculate", expression="1+1")), reply("end_turn", text("ok")))
        self.run_agent(client, permission=lambda name: "allow", tools=[], run=lambda name, args: ran.append(name))
        self.assertEqual(ran, [])
        self.assertTrue(tool_results(client, 1)[0]["is_error"])

    def test_any_tool_can_require_approval(self):
        (self.tmp / "a.txt").write_text("secret", encoding="utf-8")
        client = FakeClient(
            reply("tool_use", tool_use("t1", "read_file", path=str(self.tmp / "a.txt"))),
            reply("end_turn", text("ok")),
        )
        asked = []
        self.run_agent(client, confirm=lambda p: asked.append(p) or "n", permission=lambda name: "ask")
        self.assertIn("read the file", asked[0])
        self.assertIn("declined", tool_results(client, 1)[0]["content"])

    def test_reading_outside_the_workspace_asks_first(self):
        inside = self.tmp / "in.txt"
        inside.write_text("fine", encoding="utf-8")
        old = tools.WORKSPACE
        tools.WORKSPACE = self.tmp
        try:
            for path, expect_asked in [(str(inside), False), ("in.txt", False),
                                       (str(self.tmp / ".." / "elsewhere.txt"), True), ("C:/Windows/win.ini", True)]:
                with self.subTest(path=path):
                    client = FakeClient(reply("tool_use", tool_use("t1", "read_file", path=path)),
                                        reply("end_turn", text("ok")))
                    asked = []
                    self.run_agent(client, confirm=lambda p: asked.append(p) or "n")
                    self.assertEqual(bool(asked), expect_asked)
                    if expect_asked:
                        self.assertIn("OUTSIDE the workspace", asked[0])
                        self.assertIn("declined", tool_results(client, 1)[0]["content"])
                    else:
                        self.assertEqual(tool_results(client, 1)[0]["content"], "fine")
        finally:
            tools.WORKSPACE = old

    # A path that isn't text (a small model's mistake) must come back to the model as an error. If it crashed
    # the loop instead, the saved history would hold a tool request with no result, and the API refuses that
    # conversation for good
    def test_a_path_that_isnt_text_is_an_error_not_a_crash(self):
        for path in [None, 5, ["a.txt"]]:
            for name in ["read_file", "write_file"]:
                with self.subTest(path=path, name=name):
                    args = {"path": path, "content": "x"} if name == "write_file" else {"path": path}
                    client = FakeClient(reply("tool_use", NS(type="tool_use", id="t1", name=name, input=args)),
                                        reply("end_turn", text("ok")))
                    answer, _ = self.run_agent(client, confirm=lambda p: "y")
                    self.assertEqual(answer, "ok")
                    result = tool_results(client, 1)[0]
                    self.assertEqual(result["tool_use_id"], "t1")
                    self.assertTrue(result["is_error"])

    # write_file keeps the line endings the model gave: "\r\n" must not become "\r\r\n" on Windows
    def test_write_file_keeps_line_endings_as_given(self):
        old = tools.WORKSPACE
        tools.WORKSPACE = self.tmp
        self.addCleanup(setattr, tools, "WORKSPACE", old)
        for content in ["a\r\nb\r\n", "a\nb\n"]:
            with self.subTest(content=content):
                tools.run_tool("write_file", {"path": "out.txt", "content": content})
                self.assertEqual((self.tmp / "out.txt").read_bytes(), content.encode("utf-8"))

    # A huge file isn't sent whole: only the start comes back, with a note saying how much was left out, so one
    # read can't fill the conversation (and the bill)
    def test_read_file_sends_only_the_start_of_a_huge_file(self):
        old = tools.WORKSPACE
        tools.WORKSPACE = self.tmp
        self.addCleanup(setattr, tools, "WORKSPACE", old)
        (self.tmp / "big.txt").write_text("x" * (tools.READ_LIMIT + 5000), encoding="utf-8")
        (self.tmp / "small.txt").write_text("hello", encoding="utf-8")
        text = tools.run_tool("read_file", {"path": "big.txt"})
        self.assertTrue(text.startswith("x" * tools.READ_LIMIT))
        self.assertIn(f"{tools.READ_LIMIT + 5000:,} characters", text)
        self.assertLess(len(text), tools.READ_LIMIT + 300)
        self.assertEqual(tools.run_tool("read_file", {"path": "small.txt"}), "hello")

    # A ':' after the drive letter names a hidden extra part of a file (an "alternate data stream") that Rewind
    # can't see, so the file tools refuse it
    def test_file_tools_refuse_a_hidden_stream(self):
        old = tools.WORKSPACE
        tools.WORKSPACE = self.tmp
        self.addCleanup(setattr, tools, "WORKSPACE", old)
        (self.tmp / "a.txt").write_text("visible", encoding="utf-8")
        for name, args in [("write_file", {"path": "a.txt:hidden", "content": "x"}),
                           ("read_file", {"path": "a.txt:hidden"}), ("list_files", {"path": ".:x"}),
                           ("run_python", {"path": "s.py:x"})]:
            with self.subTest(name=name):
                with self.assertRaisesRegex(ValueError, "':'"):
                    tools.run_tool(name, args)
        self.assertEqual(tools.run_tool("read_file", {"path": str(self.tmp / "a.txt")}), "visible")  # C: is fine

    # A network path (\\host\share) is outside the workspace by its text alone. Looking it up on the disk
    # would make Windows contact that host before you're asked: the name lookup can carry data out, and the
    # connection attempt can send your Windows login (NTLM hash)
    def test_a_network_path_is_outside_and_never_looked_up(self):
        from unittest import mock
        looked_up = []
        real = pathlib.Path.resolve

        def record(self, *a, **kw):
            looked_up.append(str(self))
            return real(self, *a, **kw)
        for path in ["\\\\attacker.example\\share\\x.txt", "//attacker.example/share/x.txt",
                     "\\\\?\\UNC\\attacker.example\\share\\x.txt", "/\\attacker.example\\share\\x.txt"]:
            for name in ["read_file", "write_file", "run_python"]:
                with self.subTest(path=path, name=name):
                    looked_up.clear()
                    args = {"path": path, "content": "x"} if name == "write_file" else {"path": path}
                    self.assertTrue(tools.outside_workspace(name, args))
                    client = FakeClient(reply("tool_use", tool_use("t1", name, **args)), reply("end_turn", text("ok")))
                    asked = []
                    with mock.patch.object(pathlib.Path, "resolve", record):
                        self.run_agent(client, confirm=lambda p: asked.append(p) or "n")
                    self.assertIn("OUTSIDE the workspace", asked[0])
                    self.assertIn("attacker.example", asked[0])
                    self.assertFalse([p for p in looked_up if "attacker.example" in p], looked_up)
                    self.assertIn("declined", tool_results(client, 1)[0]["content"])

    # F298: with nobody to ask (no confirm), a tool that needs your OK isn't run, and nobody is said to have
    # declined it or blocked it in the settings: the rule stays "ask" and the reason is given
    def test_with_nobody_to_ask_an_ask_first_tool_is_not_run(self):
        events = []
        client = FakeClient(reply("tool_use", tool_use("t1", "write_file", path="out.txt", content="x")),
                            reply("end_turn", text("couldn't")))
        messages = [{"role": "user", "content": "write it"}]
        loop.agent(messages, client, confirm=None, on_event=lambda kind, **d: events.append((kind, d)))
        call = next(d for k, d in events if k == "tool_call")
        result = next(d for k, d in events if k == "tool_result")
        self.assertEqual(call["permission"], "ask")
        self.assertEqual(result["outcome"], "unattended")
        self.assertIn("nobody can be asked", tool_results(client, 1)[0]["content"])
        self.assertTrue(tool_results(client, 1)[0]["is_error"])
        self.assertFalse((self.tmp / "out.txt").exists())

    def test_blocked_stays_blocked_inside_the_workspace(self):
        self.assertFalse(tools.outside_workspace("calculate", {"expression": "1+1"}))
        self.assertFalse(tools.outside_workspace("read_file", {"path": str(self.tmp / "x")}))

    def test_stop_mid_reply_keeps_every_tool_request_answered(self):
        client = FakeClient(
            reply("tool_use", tool_use("t1", "list_files", path=str(self.tmp)),
                  tool_use("t2", "list_files", path=str(self.tmp))),
        )
        stop = {"now": False}

        def run(name, args):
            stop["now"] = True  # the user presses Stop while the first tool runs
            return tools.run_tool(name, args)

        with self.assertRaises(loop.Stopped):
            self.run_agent(client, run=run, should_stop=lambda: stop["now"])
        results = self.last_messages[-1]["content"]
        self.assertEqual([r["tool_use_id"] for r in results], ["t1", "t2"])
        self.assertTrue(results[1]["is_error"])
        self.assertIn("stopped", results[1]["content"])

    def test_prepare_changes_only_what_is_sent(self):
        client = FakeClient(reply("end_turn", text("ok")))
        self.run_agent(client, prepare=lambda msgs: [{"role": "user", "content": "TRIMMED"}])
        self.assertEqual(client.sent[0], [{"role": "user", "content": "TRIMMED"}])
        self.assertEqual(self.last_messages[0]["content"], "do the task")

    def test_thinking_is_off_unless_asked_for(self):
        seen = []
        client = FakeClient(reply("end_turn", text("ok")), reply("end_turn", text("ok")))
        client.create = lambda **kw: (seen.append(kw), client.replies.pop(0))[1]
        self.run_agent(client)
        self.run_agent(client, thinking={"style": "budget", "budget": 3000})
        self.assertNotIn("thinking", seen[0])
        self.assertEqual(seen[1]["thinking"], {"type": "enabled", "budget_tokens": 3000})
        self.assertNotIn("output_config", seen[1])
        self.assertGreater(seen[1]["max_tokens"], 3000)  # the budget comes out of max_tokens

    def test_thinking_off_out_loud_sends_disabled(self):
        # gemma4 in Ollama thinks unless told not to: with thinking off, the local servers are told
        seen = []
        client = FakeClient(reply("end_turn", text("ok")))
        client.create = lambda **kw: (seen.append(kw), client.replies.pop(0))[1]
        self.run_agent(client, thinking={"style": "off"})
        self.assertEqual(seen[0]["thinking"], {"type": "disabled"})

    def test_a_prompt_the_server_cut_is_noticed(self):
        request = {"system": "s" * 4000, "tools": [], "messages": [{"role": "user", "content": "x" * 8000}]}  # ~3,000 tokens
        cut = loop.prompt_cut(request, NS(input_tokens=1200, cache_read_input_tokens=0, cache_creation_input_tokens=None))
        self.assertEqual(cut["read"], 1200)
        self.assertGreater(cut["sent_about"], 2900)
        # a count near the guess, cached tokens included, is not a cut; nor is a small request, or no count at all
        self.assertIsNone(loop.prompt_cut(request, NS(input_tokens=200, cache_read_input_tokens=2600, cache_creation_input_tokens=0)))
        self.assertIsNone(loop.prompt_cut({"messages": [{"role": "user", "content": "hi"}]}, NS(input_tokens=1)))
        self.assertIsNone(loop.prompt_cut(request, None))

    def test_the_response_event_says_when_the_prompt_was_cut(self):
        events = []
        client = FakeClient(reply("end_turn", text("ok")))
        big = "word " * 3000  # ~15,000 characters, about 3,750 tokens
        client.replies[0].usage = NS(input_tokens=900, output_tokens=5, cache_read_input_tokens=0, cache_creation_input_tokens=0)
        loop.agent([{"role": "user", "content": big}], client, confirm=lambda *a: True,
                   on_event=lambda kind, **d: events.append((kind, d)))
        [response] = [d for kind, d in events if kind == "response"]
        self.assertEqual(response["prompt_cut"]["read"], 900)

    def test_adaptive_thinking_sends_an_effort_not_a_budget(self):
        seen = []
        client = FakeClient(reply("end_turn", text("ok")))
        client.create = lambda **kw: (seen.append(kw), client.replies.pop(0))[1]
        self.run_agent(client, thinking={"style": "adaptive", "effort": "high"})
        self.assertEqual(seen[0]["thinking"], {"type": "adaptive", "display": "summarized"})
        self.assertEqual(seen[0]["output_config"], {"effort": "high"})

    def test_a_cut_off_tool_request_still_gets_an_answer(self):
        # the reply hit max_tokens while writing a tool request: answer it, or the next call is refused
        client = FakeClient(reply("max_tokens", text("Let me"), tool_use("t1", "roll_dice", sides=6)))
        answer, messages = self.run_agent(client)
        self.assertIn("[stopped early: max_tokens]", answer)
        self.assertEqual(messages[-1]["role"], "user")
        [result] = messages[-1]["content"]
        self.assertEqual((result["tool_use_id"], result["is_error"]), ("t1", True))
        self.assertIn("cut off", result["content"])

    def test_caching_marks_the_ends_without_changing_the_history(self):
        seen, events = [], []
        client = FakeClient(reply("tool_use", tool_use("t1", "roll_dice", sides=6)), reply("end_turn", text("ok")))
        client.create = lambda **kw: (seen.append(kw), client.replies.pop(0))[1]
        self.run_agent(client, cache=True, on_event=lambda kind, **d: events.append((kind, d)))
        first, second = seen
        self.assertEqual(first["system"][0]["cache_control"], {"type": "ephemeral"})
        self.assertEqual(first["tools"][-1]["cache_control"], {"type": "ephemeral"})
        self.assertNotIn("cache_control", first["tools"][0])
        self.assertEqual(first["messages"][-1]["content"],
                         [{"type": "text", "text": "do the task", "cache_control": {"type": "ephemeral"}}])
        # the second call marks its last message (the tool results), not the first one any more
        self.assertEqual(second["messages"][0]["content"], "do the task")
        self.assertEqual(second["messages"][-1]["content"][-1]["cache_control"], {"type": "ephemeral"})
        # the stored history and the tool list themselves are never marked
        self.assertEqual(self.last_messages[0]["content"], "do the task")
        self.assertNotIn("cache_control", self.last_messages[2]["content"][-1])
        self.assertNotIn("cache_control", tools.TOOLS[-1])
        request = next(d for k, d in events if k == "request")
        self.assertEqual((request["cache"], request["thinking"]), (True, None))

    def test_the_request_event_records_exactly_the_body_sent(self):
        # F377: the page shows this record, so it must be the real request (tool shapes, strict, cache marks), not a rebuild
        import copy
        sent, events = [], []
        client = FakeClient(reply("tool_use", tool_use("t1", "roll_dice", sides=6)), reply("end_turn", text("ok")))
        client.create = lambda **kw: (sent.append(copy.deepcopy(kw)), client.replies.pop(0))[1]
        strict_tool = {"name": "pick", "description": "d", "strict": True,
                       "input_schema": {"type": "object", "properties": {}, "additionalProperties": False}}
        self.run_agent(client, cache=True, tools=[*tools.TOOLS, strict_tool],
                       thinking={"style": "adaptive", "effort": "low"},
                       on_event=lambda kind, **d: events.append((kind, copy.deepcopy(d))))
        recorded = [d for k, d in events if k == "request"]
        self.assertEqual(len(recorded), len(sent))
        for r, body in zip(recorded, sent):
            self.assertEqual({**r["api_body"], "messages": r["messages"]}, body)
            self.assertFalse(r["streamed"])
        self.assertTrue(recorded[0]["api_body"]["tools"][-1]["strict"])
        self.assertEqual(recorded[0]["api_body"]["tools"][-1]["cache_control"], {"type": "ephemeral"})

    def test_a_tool_list_given_as_a_function_is_read_again_before_each_call(self):
        # how the list can change between calls (find_tool, features/tool_search.py); caching marks the list sent
        seen, lists = [], [[{"name": "a"}], [{"name": "a"}, {"name": "b"}]]
        client = FakeClient(reply("tool_use", tool_use("t1", "roll_dice", sides=6)), reply("end_turn", text("ok")))
        client.create = lambda **kw: (seen.append(kw), client.replies.pop(0))[1]
        self.run_agent(client, tools=lambda: lists.pop(0), cache=True)
        self.assertEqual([[t["name"] for t in kw["tools"]] for kw in seen], [["a"], ["a", "b"]])
        self.assertEqual(seen[1]["tools"][-1], {"name": "b", "cache_control": {"type": "ephemeral"}})
        self.assertNotIn("cache_control", seen[1]["tools"][0])

    def test_streaming_passes_text_on_as_it_arrives(self):
        final = reply("end_turn", text("Hello there"))

        class Stream:
            text_stream = iter(["Hel", "lo ", "there"])

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def get_final_message(self):
                return final

        class StreamingClient:
            def __init__(self):
                self.messages = self

            def stream(self, **kw):
                return Stream()

        pieces = []
        answer, _ = self.run_agent(StreamingClient(), stream=True,
                                   on_event=lambda kind, **d: kind == "text" and pieces.append(d["text"]))
        self.assertEqual(pieces, ["Hel", "lo ", "there"])
        self.assertEqual(answer, "Hello there")

    def test_turn_limit_stops_endless_tool_use(self):
        loop = [reply("tool_use", tool_use(f"t{i}", "list_files", path=str(self.tmp))) for i in range(3)]
        client = FakeClient(*loop)
        with self.assertRaises(RuntimeError):
            self.run_agent(client, max_turns=3)
        self.assertEqual(len(client.sent), 3)


if __name__ == "__main__":
    unittest.main()


class ThinkingBudgetFitsTests(unittest.TestCase):
    def test_a_budget_too_big_for_the_reply_limit_shrinks_or_goes(self):
        seen = []
        for max_tokens in (3000, 1000):
            client = FakeClient(reply("end_turn", text("ok")))
            client.create = lambda **kw: (seen.append(kw), client.replies.pop(0))[1]
            loop.agent([{"role": "user", "content": "hi"}], client, confirm=lambda q: "n",
                       thinking={"style": "budget", "budget": 4000}, max_tokens=max_tokens)
        self.assertEqual(seen[0]["thinking"]["budget_tokens"], 2744)  # below max_tokens
        self.assertNotIn("thinking", seen[1])                          # no room for the minimum 1,024
