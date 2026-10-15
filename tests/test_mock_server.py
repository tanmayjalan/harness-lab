"""Offline tests for the mock server's translation code (no `claude -p` calls).

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import contextlib
import http.client
import io
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest import mock

import anthropic

from harness.core import loop, tools
from harness.core import mock_server


REQUEST = {
    "model": "claude-opus-5-5",
    "system": "Be brief.",
    "tools": tools.TOOLS,
    "messages": [
        {"role": "user", "content": "What is in this folder?"},
        {"role": "assistant", "content": [
            {"type": "tool_use", "id": "toolu_1", "name": "list_files", "input": {"path": "."}},
        ]},
        {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "toolu_1", "content": "harness.py", "is_error": False},
        ]},
    ],
}


class PromptTests(unittest.TestCase):
    def test_prompt_carries_system_tools_and_every_turn(self):
        prompt = mock_server.build_prompt(REQUEST)
        self.assertIn("Be brief.", prompt)
        for tool in tools.TOOLS:
            self.assertIn(tool["name"], prompt)
        self.assertIn("What is in this folder?", prompt)
        self.assertIn('[tool call toolu_1: list_files({"path": "."})]', prompt)
        self.assertIn("[tool result for toolu_1]\nharness.py", prompt)

    def test_failed_tool_result_is_marked(self):
        block = {"type": "tool_result", "tool_use_id": "t9", "content": "Error: nope", "is_error": True}
        self.assertIn("(ERROR)", mock_server.block_to_text(block))

    def test_schema_limits_tool_names_to_the_harness_tools(self):
        schema = mock_server.reply_schema(["list_files", "read_file"])
        self.assertEqual(schema["properties"]["tool_calls"]["items"]["properties"]["name"]["enum"],
                         ["list_files", "read_file"])


class ReplyShapeTests(unittest.TestCase):
    def test_text_answer_ends_the_turn(self):
        msg = mock_server.to_api_message({"text": "Done.", "tool_calls": []}, "m")
        self.assertEqual(msg["stop_reason"], "end_turn")
        self.assertEqual(msg["content"], [{"type": "text", "text": "Done."}])

    def test_tool_calls_become_tool_use_blocks_with_unique_ids(self):
        msg = mock_server.to_api_message({"text": "", "tool_calls": [
            {"name": "read_file", "input": {"path": "a"}},
            {"name": "read_file", "input": {"path": "b"}},
        ]}, "m")
        self.assertEqual(msg["stop_reason"], "tool_use")
        self.assertEqual([b["type"] for b in msg["content"]], ["tool_use", "tool_use"])
        self.assertNotEqual(msg["content"][0]["id"], msg["content"][1]["id"])


class OnlyTheHarnessMayAskTests(unittest.TestCase):
    """F387: each request spends the user's Claude Code plan, and any web page can send requests to
    127.0.0.1. So the mock answers only requests addressed to 127.0.0.1 or localhost, sent as JSON and
    carrying its key. `claude -p` is faked: a refused request must never reach it."""

    def setUp(self):
        self.server, self.key = mock_server.serve()
        self.port = self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def post(self, headers, body=b'{"model": "m", "max_tokens": 10, "messages": []}'):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.putrequest("POST", "/v1/messages", skip_host=True)
        for name, value in headers.items():
            conn.putheader(name, value)
        conn.putheader("Content-Length", str(len(body)))
        conn.endheaders(body)
        response = conn.getresponse()
        status, data = response.status, json.loads(response.read() or b"{}")
        conn.close()
        return status, data

    def ok_headers(self, **changes):
        headers = {"Host": f"127.0.0.1:{self.port}", "Content-Type": "application/json", "x-api-key": self.key}
        headers.update(changes)
        return {k: v for k, v in headers.items() if v is not None}

    def test_refused_requests_never_reach_claude(self):
        cases = {
            "no key": (self.ok_headers(**{"x-api-key": None}), 401),
            "wrong key": (self.ok_headers(**{"x-api-key": "mock"}), 401),
            "another host name (a page using a look-alike address)": (self.ok_headers(Host="evil.example:80"), 403),
            "not JSON (what a web page can send without asking first)": (
                self.ok_headers(**{"Content-Type": "text/plain"}), 415),
        }
        with mock.patch.object(mock_server, "ask_claude") as ask:
            for name, (headers, expected) in cases.items():
                with self.subTest(name):
                    status, body = self.post(headers)
                    self.assertEqual(status, expected)
                    self.assertEqual(body["type"], "error")
            ask.assert_not_called()

    def test_the_right_request_is_answered(self):
        fake = {"text": "hello", "tool_calls": []}
        with mock.patch.object(mock_server, "ask_claude", return_value=fake):
            status, body = self.post(self.ok_headers(Host="localhost"))
        self.assertEqual(status, 200)
        self.assertEqual(body["content"][-1]["text"], "hello")

    def test_a_handler_without_a_key_refuses_everything(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), mock_server.Handler)  # not via serve(): no key set
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            self.port = server.server_port
            with mock.patch.object(mock_server, "ask_claude") as ask:
                status, _ = self.post(self.ok_headers(**{"x-api-key": "anything"}))
            self.assertEqual(status, 401)
            ask.assert_not_called()
        finally:
            server.shutdown()
            server.server_close()

    def test_each_server_gets_its_own_random_key(self):
        other, other_key = mock_server.serve()
        other.shutdown()
        other.server_close()
        self.assertNotEqual(self.key, other_key)
        self.assertGreaterEqual(len(self.key), 24)


class OverHttpTests(unittest.TestCase):
    """The real Anthropic SDK talks to the server; only `claude -p` is faked."""

    def setUp(self):
        self.server, key = mock_server.serve()
        self.client = anthropic.Anthropic(
            api_key=key, base_url=f"http://127.0.0.1:{self.server.server_port}", max_retries=0)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_sdk_parses_a_tool_call_reply(self):
        fake = {"text": "Let me look.", "tool_calls": [{"name": "list_files", "input": {"path": "."}}]}
        with mock.patch.object(mock_server, "ask_claude", return_value=fake):
            response = self.client.messages.create(
                model="claude-opus-5-5", max_tokens=100, tools=tools.TOOLS,
                messages=[{"role": "user", "content": "hi"}])
        self.assertEqual(response.stop_reason, "tool_use")
        self.assertEqual(response.content[1].name, "list_files")
        self.assertEqual(response.content[1].input, {"path": "."})

    def test_claude_failure_becomes_an_api_error(self):
        with mock.patch.object(mock_server, "ask_claude", side_effect=RuntimeError("boom")), \
             mock.patch("sys.stderr"):
            with self.assertRaises(anthropic.InternalServerError):
                self.client.messages.create(
                    model="claude-opus-5-5", max_tokens=100,
                    messages=[{"role": "user", "content": "hi"}])

    # Visible retries: claude -p saying the service is overloaded becomes a real 529 with retry-after,
    # and the loop tries again after that wait
    def test_an_overloaded_claude_is_a_529_the_loop_tries_again(self):
        fake = {"text": "fine", "tool_calls": []}
        busy = RuntimeError('API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}')
        events = []
        with mock.patch.object(mock_server, "ask_claude", side_effect=[busy, fake]), mock.patch("sys.stderr"):
            text = loop.agent([{"role": "user", "content": "hi"}], self.client, confirm=None, tools=[],
                              on_event=lambda kind, **d: events.append((kind, d)))
        self.assertEqual(text, "fine")
        retry = next(d for k, d in events if k == "retry")
        self.assertEqual((retry["status"], retry["wait"]), (529, 1.0))

    # Any other claude -p failure: trying again quickly won't help, so the mock says not to
    def test_other_failures_say_not_to_try_again(self):
        with mock.patch.object(mock_server, "ask_claude", side_effect=RuntimeError("boom")), mock.patch("sys.stderr"):
            with self.assertRaises(anthropic.InternalServerError) as e:
                self.client.messages.create(model="claude-opus-5-5", max_tokens=100, messages=[{"role": "user", "content": "hi"}])
        self.assertEqual(e.exception.response.headers.get("x-should-retry"), "false")

    # F294: the console lines say what happened in plain words, with context
    def test_the_console_lines_are_in_plain_words(self):
        import contextlib
        import io
        err, out = io.StringIO(), io.StringIO()
        with mock.patch.object(mock_server, "ask_claude", side_effect=RuntimeError("boom")), \
                contextlib.redirect_stderr(err):
            with self.assertRaises(anthropic.InternalServerError):
                self.client.messages.create(model="claude-opus-5-5", max_tokens=100,
                                            messages=[{"role": "user", "content": "hi"}])
        self.assertIn("claude -p failed, so the harness gets an error: RuntimeError: boom", err.getvalue())
        fake = {"text": "", "tool_calls": [{"name": "list_files", "input": {"path": "."}}]}
        with mock.patch.object(mock_server, "ask_claude", return_value=fake), contextlib.redirect_stdout(out):
            self.client.messages.create(model="claude-opus-5-5", max_tokens=100, tools=tools.TOOLS,
                                        messages=[{"role": "user", "content": "hi"}])
        self.assertIn("1 message in; it asked for a tool: list_files", out.getvalue())
        self.assertNotIn("-> tool_use", out.getvalue())
        self.assertNotIn("localhost", mock_server.__doc__)

    def test_child_claude_does_not_inherit_the_mock_settings(self):
        seen = {}

        def fake_run(args, **kw):
            seen["env"] = kw["env"]
            return mock.Mock(returncode=0, stdout=json.dumps(
                {"type": "result", "is_error": False, "structured_output": {"text": "ok", "tool_calls": []}}))

        with mock.patch.dict("os.environ", {"ANTHROPIC_BASE_URL": "http://x", "ANTHROPIC_API_KEY": "mock"}), \
             mock.patch.object(mock_server.shutil, "which", return_value="claude"), \
             mock.patch.object(mock_server.subprocess, "run", side_effect=fake_run):
            mock_server.ask_claude(REQUEST)
        self.assertNotIn("ANTHROPIC_BASE_URL", seen["env"])
        self.assertNotIn("ANTHROPIC_API_KEY", seen["env"])

    def test_the_setup_check_makes_one_call_and_reports_it(self):
        ok = mock.Mock(returncode=0, stdout=json.dumps(
            {"type": "result", "is_error": False, "structured_output": {"text": "ready", "tool_calls": []}}))
        out = io.StringIO()
        with mock.patch.object(mock_server.shutil, "which", return_value="claude"), \
             mock.patch.object(mock_server.subprocess, "run", return_value=ok) as run, \
             contextlib.redirect_stdout(out):
            self.assertEqual(mock_server.check(), 0)
        self.assertEqual(run.call_count, 1)
        self.assertIn("claude -p works", out.getvalue())
        self.assertIn("ready", out.getvalue())

    def test_the_setup_check_reports_a_failure(self):
        out = io.StringIO()
        with mock.patch.object(mock_server.shutil, "which", return_value=None), contextlib.redirect_stdout(out):
            self.assertEqual(mock_server.check(), 1)
        self.assertIn("claude -p did not work", out.getvalue())
        self.assertIn("not found", out.getvalue())


class EstimateTests(unittest.TestCase):
    def test_tokens_are_estimated_from_the_request_and_marked(self):
        reply = mock_server.to_api_message({"text": "x" * 400, "tool_calls": []}, "m")
        usage = mock_server.estimate_usage(REQUEST, reply)
        self.assertTrue(usage["estimated"])
        self.assertGreater(usage["input_tokens"], 100)   # the tool descriptions alone are large
        self.assertGreater(usage["output_tokens"], 90)
        self.assertNotIn("cache_read_input_tokens", usage)  # the mock never claims cache reads


def stream(*steps):
    """claude -p's step-by-step output: one JSON object per line."""
    return "\n".join(json.dumps(s) for s in steps)


def said(*blocks):
    return {"type": "assistant", "message": {"content": list(blocks)}}


RESULT = {"type": "result", "is_error": False,
          "structured_output": {"text": "Sorry, the tool isn't available. It's 416.5.", "tool_calls": []}}


class ReadReplyTests(unittest.TestCase):
    def test_the_structured_reply_is_used_normally(self):
        reply = mock_server.read_reply(stream({"type": "system"}, said({"type": "text", "text": "hi"}), RESULT), ["calculate"])
        self.assertEqual(reply, {**RESULT["structured_output"], "thinking": [], "overhead_ms": None})

    def test_a_direct_tool_attempt_becomes_the_tool_request(self):
        # Haiku often calls the harness tool directly; Claude Code refuses; the model gives up
        out = stream(
            said({"type": "text", "text": "Let me calculate that."}),
            said({"type": "tool_use", "name": "calculate", "input": {"expression": "2450*17/100"}}),
            said({"type": "tool_use", "name": "get_current_time", "input": {"timezone": "Asia/Tokyo"}}),
            {"type": "user", "message": {"content": [{"type": "tool_result", "content": "No such tool available"}]}},
            said({"type": "tool_use", "name": "calculate", "input": {"expression": "retry"}}),  # after: ignored
            RESULT)
        reply = mock_server.read_reply(out, ["calculate", "get_current_time"])
        self.assertEqual(reply, {"text": "Let me calculate that.", "thinking": [], "overhead_ms": None, "tool_calls": [
            {"name": "calculate", "input": {"expression": "2450*17/100"}},
            {"name": "get_current_time", "input": {"timezone": "Asia/Tokyo"}}]})

    def test_its_own_structured_output_call_is_not_a_harness_tool(self):
        out = stream(said({"type": "tool_use", "name": "StructuredOutput", "input": {"text": "x"}}), RESULT)
        self.assertEqual(mock_server.read_reply(out, ["calculate"]),
                         {**RESULT["structured_output"], "thinking": [], "overhead_ms": None})

    def test_claude_p_start_up_time_is_measured(self):
        timed = {**RESULT, "duration_ms": 9000, "duration_api_ms": 6500}
        self.assertEqual(mock_server.read_reply(stream(timed), [])["overhead_ms"], 2500)

    def test_thinking_blocks_come_back_first(self):
        out = stream(said({"type": "thinking", "thinking": "", "signature": "abc"}), RESULT)
        reply = mock_server.read_reply(out, ["calculate"])
        self.assertEqual(reply["thinking"], [{"type": "thinking", "thinking": "", "signature": "abc"}])
        message = mock_server.to_api_message(reply, "m")
        self.assertEqual([b["type"] for b in message["content"]], ["thinking", "text"])

    def test_thinking_switch_reaches_claude_p(self):
        seen = {}

        def fake_run(args, **kw):
            seen.setdefault("budgets", []).append(kw["env"]["MAX_THINKING_TOKENS"])
            return mock.Mock(returncode=0, stdout=json.dumps(RESULT))

        with mock.patch.object(mock_server.shutil, "which", return_value="claude"), \
             mock.patch.object(mock_server.subprocess, "run", side_effect=fake_run):
            mock_server.ask_claude(REQUEST)
            mock_server.ask_claude({**REQUEST, "thinking": {"type": "enabled", "budget_tokens": 3000}})
        self.assertEqual(seen["budgets"], ["0", "3000"])

    def test_errors_and_missing_results_are_reported(self):
        with self.assertRaisesRegex(RuntimeError, "reported an error"):
            mock_server.read_reply(stream({"type": "result", "is_error": True, "result": "rate limited"}), [])
        with self.assertRaisesRegex(RuntimeError, "no result"):
            mock_server.read_reply("not json\n", [])


if __name__ == "__main__":
    unittest.main()


class FitInputTests(unittest.TestCase):
    def test_numbers_sent_as_text_get_the_type_the_tool_asks_for(self):
        tools = [{"name": "roll_dice", "input_schema": {"properties": {
            "sides": {"type": "integer"}, "count": {"type": "integer"}}}},
            {"name": "calc", "input_schema": {"properties": {
                "x": {"type": "number"}, "y": {"type": "number"}, "exact": {"type": "boolean"}, "note": {"type": "string"}}}}]
        answer = {"text": "", "tool_calls": [
            {"name": "roll_dice", "input": {"count": "2", "sides": "6"}},
            {"name": "calc", "input": {"x": "2.5", "y": "4", "exact": "True", "note": "7"}},
            {"name": "roll_dice", "input": {"count": "two", "sides": 6}},
        ]}
        calls = mock_server.fit_inputs(answer, tools)["tool_calls"]
        self.assertEqual(calls[0]["input"], {"count": 2, "sides": 6})
        self.assertEqual(calls[1]["input"], {"x": 2.5, "y": 4, "exact": True, "note": "7"})
        self.assertEqual(calls[2]["input"], {"count": "two", "sides": 6})  # not a number: left for the tool to refuse


class LimitTests(unittest.TestCase):
    def test_a_long_reply_is_cut_at_max_tokens(self):
        answer = {"text": "word " * 400, "tool_calls": [{"name": "calculate", "input": {}}]}
        cut, was_cut = mock_server.apply_limit(answer, 100)
        self.assertTrue(was_cut)
        self.assertEqual((len(cut["text"]), cut["tool_calls"]), (400, []))
        same, was_cut = mock_server.apply_limit({"text": "short", "tool_calls": []}, 100)
        self.assertFalse(was_cut)

    def test_a_tool_request_cut_while_being_written_is_kept_unfinished(self):
        answer = {"text": "Saving it.", "tool_calls": [
            {"name": "calculate", "input": {"expression": "1+1"}},
            {"name": "write_file", "input": {"path": "story.txt", "content": "word " * 400}},
            {"name": "list_files", "input": {}}]}
        cut, was_cut = mock_server.apply_limit(answer, 100)
        self.assertTrue(was_cut)
        self.assertEqual(cut["text"], "Saving it.")
        self.assertEqual([(c["name"], c["input"]) for c in cut["tool_calls"]],
                         [("calculate", {"expression": "1+1"}), ("write_file", {})])
