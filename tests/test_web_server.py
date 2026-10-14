"""Offline tests for the web server (web/server.py): a fake Claude, real HTTP, no `claude -p` calls.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import http.client
import json
import pathlib
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace as NS

from anthropic.types import TextBlock, ToolUseBlock

from harness.core import tools
from harness.web import server as web_server


def text(t):
    return TextBlock(type="text", text=t)


def tool_use(id, name, **input):
    return ToolUseBlock(type="tool_use", id=id, name=name, input=input)


def reply(stop_reason, *content):
    return NS(stop_reason=stop_reason, content=list(content))


class FakeClient:
    """Scripted replies; `gate` lets a test hold the model 'thinking'."""

    def __init__(self, *replies, gate=None):
        self.replies = list(replies)
        self.gate = gate
        self.messages = self

    def create(self, **kwargs):
        if self.gate:
            self.gate.wait(5)
        return self.replies.pop(0)


def wait_until_idle(session, timeout=5):
    end = time.time() + timeout
    while session.running and time.time() < end:
        time.sleep(0.01)
    assert not session.running, "run did not finish"


def wait_for(session, kind, timeout=5):
    end = time.time() + timeout
    while time.time() < end:
        found = [e for e in session.snapshot(0)["events"] if e["kind"] == kind]
        if found:
            return found[-1]
        time.sleep(0.01)
    raise AssertionError(f"no {kind} event")


def kinds(session):
    return [e["kind"] for e in session.snapshot(0)["events"]]


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())

    def test_a_tool_turn_produces_every_step(self):
        s = web_server.Session(FakeClient(
            reply("tool_use", text("Let me look."), tool_use("t1", "list_files", path=str(self.tmp))),
            reply("end_turn", text("It's empty.")),
        ), "test")
        s.start("what's here?")
        wait_until_idle(s)
        self.assertEqual(kinds(s), ["user", "request", "response", "tool_call", "tool_result",
                                    "request", "response", "answer", "done"])
        events = s.snapshot(0)["events"]
        self.assertEqual(events[2]["content"][1], {"type": "tool_use", "id": "t1", "name": "list_files",
                                                   "input": {"path": str(self.tmp)}})
        # The second request shows the history as it was then: 3 messages, not the final 4
        self.assertEqual(len(events[5]["messages"]), 3)
        self.assertEqual(events[7]["text"], "It's empty.")

    def test_declined_write_pauses_then_keeps_history_valid(self):
        target = self.tmp / "out.txt"
        s = web_server.Session(FakeClient(
            reply("tool_use", tool_use("t1", "write_file", path=str(target), content="hello")),
            reply("end_turn", text("Okay, not written.")),
        ), "test")
        s.start("write it")
        approval = wait_for(s, "approval")
        self.assertTrue(s.running)  # the loop is paused, waiting for the page
        self.assertEqual((approval["path"], approval["content"]), (str(target), "hello"))
        # F279: the server says whether the path is outside the workspace, and where the file really goes
        self.assertEqual(approval["outside"], tools.outside_workspace("write_file", {"path": str(target)}))
        self.assertEqual(approval["where"], str(tools.resolve(str(target))))
        self.assertEqual(approval["setting"], "ask")  # your rule for the tool, before the workspace check
        self.assertFalse(s.decide("wrong-id", True))
        self.assertTrue(s.decide(approval["id"], False))
        wait_until_idle(s)

        self.assertFalse(target.exists())
        self.assertIn("decision", kinds(s))
        # Every tool request in the history has a matching result right after it
        for i, m in enumerate(s.messages):
            if m["role"] == "assistant" and not isinstance(m["content"], str):
                asked = {b.id for b in m["content"] if b.type == "tool_use"}
                if asked:
                    answered = {r["tool_use_id"] for r in s.messages[i + 1]["content"]}
                    self.assertEqual(asked, answered)

    def test_allowed_write_creates_the_file(self):
        target = self.tmp / "out.txt"
        s = web_server.Session(FakeClient(
            reply("tool_use", tool_use("t1", "write_file", path=str(target), content="hello")),
            reply("end_turn", text("Written.")),
        ), "test")
        s.start("write it")
        s.decide(wait_for(s, "approval")["id"], True)
        wait_until_idle(s)
        self.assertEqual(target.read_text(encoding="utf-8"), "hello")

    def test_always_allow_applies_to_the_rest_of_the_same_reply(self):
        # Final review I3: "Always allow" on the first of two writes must not ask again for the second
        a, b = self.tmp / "a.txt", self.tmp / "b.txt"
        s = web_server.Session(FakeClient(
            reply("tool_use", tool_use("t1", "write_file", path=str(a), content="1"),
                  tool_use("t2", "write_file", path=str(b), content="2")),
            reply("end_turn", text("Both written.")),
        ), "test")
        s.start("write both")
        s.decide(wait_for(s, "approval")["id"], True, always=True)
        wait_until_idle(s)
        self.assertEqual([e["kind"] for e in s.snapshot(0)["events"]].count("approval"), 1)
        self.assertTrue(a.exists() and b.exists())

    def test_a_follow_up_keeps_where_the_conversation_came_from(self):
        # Final review I8: a message sent in an opened side keeps its kind and origin when saved
        from harness.web import conversations
        cid = conversations.new_id()
        conversations.save(cid, "Compare · A · q", [], [], kind="compare", origin={"comparison": "x1", "side": "A"})
        s = web_server.Session(FakeClient(reply("end_turn", text("ok"))), "test")
        self.assertTrue(s.open(cid))
        s.start("and then?")
        wait_until_idle(s)
        saved = conversations.load(cid)
        self.assertEqual(saved.get("kind"), "compare")
        self.assertEqual(saved.get("origin"), {"comparison": "x1", "side": "A"})

    def test_reported_tokens_and_cost_reach_the_page(self):
        r = reply("end_turn", text("hi"))
        r.usage = NS(model_dump=lambda **kw: {"input_tokens": 1000, "output_tokens": 100})
        s = web_server.Session(FakeClient(r), "DeepSeek", provider="deepseek")
        s.start("hi")
        wait_until_idle(s)
        response = [e for e in s.snapshot(0)["events"] if e["kind"] == "response"][0]
        self.assertEqual(response["usage"], {"input_tokens": 1000, "output_tokens": 100})
        self.assertAlmostEqual(response["cost"], (1000 * 0.30 + 100 * 1.20) / 1_000_000)

    def test_streamed_text_is_kept_aside_not_stored_as_steps(self):
        s = web_server.Session(FakeClient(), "test")
        s.emit("request", turn=1, max_turns=20, messages=[], system="")
        s.emit("text", text="Hel")
        s.emit("text", text="lo")
        self.assertEqual(s.snapshot(0)["live"], "Hello")
        self.assertEqual(kinds(s), ["request"])            # no step per piece
        s.emit("response", turn=1, stop_reason="end_turn", content=[], usage=None)
        self.assertEqual(s.snapshot(0)["live"], "")         # the finished reply takes over

    def test_api_failure_becomes_an_error_event(self):
        class Broken:
            messages = NS(create=lambda **kw: (_ for _ in ()).throw(RuntimeError("server down")))
        s = web_server.Session(Broken(), "test")
        s.start("hi")
        wait_until_idle(s)
        self.assertEqual(kinds(s), ["user", "request", "error", "done"])
        self.assertIn("server down", s.snapshot(0)["events"][2]["message"])

    def test_known_provider_errors_are_explained_in_plain_words(self):
        # F095: the raw exception is kept as detail; a known cause gets a sentence that says what to do
        class NoClaude:
            messages = NS(create=lambda **kw: (_ for _ in ()).throw(
                RuntimeError("Error code: 500 - {'error': {'message': 'claude was not found on PATH'}}")))
        s = web_server.Session(NoClaude(), "test")
        s.start("hi")
        wait_until_idle(s)
        err = next(e for e in s.snapshot(0)["events"] if e["kind"] == "error")
        self.assertIn("Install Claude Code", err["message"])
        self.assertIn("claude was not found", err["detail"])

    def test_unknown_errors_keep_their_own_text(self):
        class Broken:
            messages = NS(create=lambda **kw: (_ for _ in ()).throw(RuntimeError("something odd")))
        s = web_server.Session(Broken(), "test")
        s.start("hi")
        wait_until_idle(s)
        err = next(e for e in s.snapshot(0)["events"] if e["kind"] == "error")
        self.assertIn("something odd", err["message"])
        self.assertNotIn("detail", err)

    def test_snapshot_says_when_the_conversation_keeps_its_start(self):
        # F200: a conversation with a frozen prompt and tools says so
        s = web_server.Session(FakeClient(), "test")
        self.assertFalse(s.snapshot(0)["frozen"])
        s.frozen = {"system": "x", "tools": []}
        self.assertTrue(s.snapshot(0)["frozen"])

    def test_reset_waits_for_the_run_then_clears(self):
        gate = threading.Event()
        s = web_server.Session(FakeClient(reply("end_turn", text("hi")), gate=gate), "test")
        s.start("hello")
        self.assertFalse(s.start("again"))  # one message at a time
        self.assertFalse(s.reset())
        gate.set()
        wait_until_idle(s)
        self.assertTrue(s.reset())
        snap = s.snapshot(0)
        self.assertEqual((snap["gen"], snap["running"], snap["events"]), (1, False, []))
        self.assertEqual(s.messages, [])


class RecordingClient:
    """Remembers the model and how many messages each call was sent."""

    def __init__(self, answer):
        self.answer = answer
        self.calls = []
        self.messages = self

    def create(self, **kwargs):
        self.calls.append((kwargs["model"], len(kwargs["messages"])))
        return reply("end_turn", text(self.answer))


class SwitchTests(unittest.TestCase):
    def test_switch_keeps_history_and_uses_the_new_model(self):
        first, second = RecordingClient("from mock"), RecordingClient("from deepseek")
        s = web_server.Session(first, "Mock", model="claude-opus-5-5", provider="mock")
        s.start("hello")
        wait_until_idle(s)
        self.assertTrue(s.switch("deepseek", second, "DeepSeek", "deepseek-flash"))
        s.start("and again")
        wait_until_idle(s)

        self.assertEqual(first.calls, [("claude-opus-5-5", 1)])
        self.assertEqual(second.calls, [("deepseek-flash", 3)])  # it was sent the earlier turn too
        events = s.snapshot(0)["events"]
        switch = [e for e in events if e["kind"] == "provider"][0]
        self.assertEqual((switch["name"], switch["model"], switch["history"]), ("deepseek", "deepseek-flash", 2))
        answers = [(e["provider"], e["model"], e["text"]) for e in events if e["kind"] == "answer"]
        self.assertEqual(answers, [("Mock", "claude-opus-5-5", "from mock"),
                                   ("DeepSeek", "deepseek-flash", "from deepseek")])

    def test_switching_drops_the_earlier_models_thinking(self):
        s = web_server.Session(RecordingClient("x"), "Mock", model="claude-opus-5-5", provider="mock")
        s.messages[:] = [{"role": "user", "content": "hi"},
                         {"role": "assistant", "content": [{"type": "thinking", "thinking": "hmm", "signature": "s"},
                                                           {"type": "text", "text": "hello"}]}]
        self.assertTrue(s.switch("deepseek", RecordingClient("y"), "DeepSeek", "deepseek-flash"))
        self.assertEqual(s.messages[1]["content"], [{"type": "text", "text": "hello"}])
        switch = [e for e in s.snapshot(0)["events"] if e["kind"] == "provider"][0]
        self.assertEqual(switch["thinking_dropped"], 1)

    def test_cannot_switch_mid_message(self):
        gate = threading.Event()
        s = web_server.Session(FakeClient(reply("end_turn", text("hi")), gate=gate), "Mock")
        s.start("hello")
        self.assertFalse(s.switch("deepseek", object(), "DeepSeek", "deepseek-flash"))
        gate.set()
        wait_until_idle(s)


class StopTests(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())

    def test_stop_during_a_model_call_ends_after_it(self):
        gate = threading.Event()
        s = web_server.Session(FakeClient(
            reply("tool_use", tool_use("t1", "list_files", path=str(self.tmp))),
            gate=gate), "test")
        s.start("go")
        wait_for(s, "request")
        self.assertTrue(s.stop())
        gate.set()  # the model call in progress finishes
        wait_until_idle(s)
        self.assertEqual(kinds(s)[-3:], ["tool_result", "stopped", "done"])
        result = [e for e in s.snapshot(0)["events"] if e["kind"] == "tool_result"][0]["result"]
        self.assertIn("Not run", result["content"])        # the tool never ran
        self.assertEqual(s.messages[-1]["content"][0]["tool_use_id"], "t1")  # but it has a result

    def test_stop_while_an_approval_waits_declines_it(self):
        target = self.tmp / "out.txt"
        s = web_server.Session(FakeClient(
            reply("tool_use", tool_use("t1", "write_file", path=str(target), content="x"))), "test")
        s.start("write it")
        wait_for(s, "approval")
        self.assertTrue(s.stop())
        wait_until_idle(s)  # would hang here if the approval kept waiting
        self.assertFalse(target.exists())
        self.assertEqual([e["allowed"] for e in s.snapshot(0)["events"] if e["kind"] == "decision"], [False])
        self.assertEqual(kinds(s)[-2:], ["stopped", "done"])

    def test_while_an_approval_waits_the_reason_says_to_answer_it(self):
        # F039: "wait for the current message to finish" misleads when nothing finishes until you answer
        target = self.tmp / "out2.txt"
        s = web_server.Session(FakeClient(
            reply("tool_use", tool_use("t1", "write_file", path=str(target), content="x"))), "test")
        self.assertEqual(s.busy_reason(), "Wait for the current message to finish.")
        s.start("write it")
        wait_for(s, "approval")
        self.assertEqual(s.busy_reason(), "Answer the approval first (Allow or Decline).")
        s.stop()
        wait_until_idle(s)

    def test_stop_when_idle_is_refused(self):
        self.assertFalse(web_server.Session(FakeClient(), "test").stop())


class FakeClients:
    def __init__(self, missing=()):
        self.missing = missing

    def get(self, name):
        if name in self.missing:
            raise web_server.providers.MissingKey(f"{name} needs a key")
        return RecordingClient(f"from {name}")


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.session = web_server.Session(FakeClient(reply("end_turn", text("Hello!"))), "test", provider="mock")
        self.server = web_server.make_server(self.session, 0, FakeClients(missing={"anthropic"}))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.port = self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def call(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        h = {"Host": f"localhost:{self.port}"}
        if body is not None:
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        conn.request(method, path, body=json.dumps(body) if body is not None else None, headers=h)
        r = conn.getresponse()
        data = r.read()
        conn.close()
        return r.status, data

    def test_info_is_served(self):
        status, data = self.call("GET", "/info")
        info = json.loads(data)
        self.assertEqual([t["name"] for t in info["tools"]][:3], ["list_files", "read_file", "write_file"])
        self.assertIn("built", info["frontend"])

    def test_static_folder_matches_the_vite_output_folder(self):
        from harness import paths
        self.assertEqual(web_server.STATIC, paths.ROOT / "harness" / "web" / "static")

    def with_static(self, built=True):
        """Point the server at a temporary built page for one test."""
        folder = pathlib.Path(tempfile.mkdtemp())
        if built:
            (folder / "assets").mkdir()
            (folder / "index.html").write_text("<!doctype html><title>Harness lab</title>", encoding="utf-8")
            (folder / "assets" / "app-abc123.js").write_text("console.log(1)", encoding="utf-8")
            (folder / "assets" / "app-abc123.css").write_text("body{}", encoding="utf-8")
        old = web_server.STATIC
        web_server.STATIC = folder
        self.addCleanup(setattr, web_server, "STATIC", old)

    def head(self, path, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("GET", path, headers={"Host": f"localhost:{self.port}", **(headers or {})})
        r = conn.getresponse()
        data = r.read()
        conn.close()
        return r.status, dict(r.getheaders()), data

    def test_built_page_and_assets_are_served(self):
        self.with_static()
        status, h, body = self.head("/")
        self.assertEqual((status, h["Content-Type"], h["Cache-Control"]), (200, "text/html; charset=utf-8", "no-store"))
        status, h, body = self.head("/assets/app-abc123.js")
        self.assertEqual(status, 200)
        self.assertEqual(h["Content-Type"], "application/javascript; charset=utf-8")
        self.assertIn("immutable", h["Cache-Control"])
        self.assertEqual(self.head("/assets/app-abc123.css")[1]["Content-Type"], "text/css; charset=utf-8")
        self.assertEqual(self.head("/assets/missing.js")[0], 404)

    def test_unbuilt_page_explains_itself(self):
        self.with_static(built=False)
        status, _, body = self.head("/")
        self.assertEqual(status, 503)
        self.assertIn(b"npm run build", body)
        self.assertIn(b"start.bat", body)

    def test_assets_cannot_reach_outside_the_folder(self):
        self.with_static()
        # (a path that stays inside the built folder, like /assets/../index.html, is harmless)
        for path in ["/assets/../../server.py", "/assets/%2e%2e/%2e%2e/server.py", "/assets/..\\..\\server.py",
                     "/assets/../../../../Windows/win.ini"]:
            with self.subTest(path=path):
                status, _, body = self.head(path)
                self.assertEqual(status, 404)
                self.assertNotIn(b"import", body)

    def test_static_still_checks_the_host_name(self):
        self.with_static()
        self.assertEqual(self.head("/", headers={"Host": "evil.example:80"})[0], 403)

    def test_chat_then_poll_events(self):
        self.assertEqual(self.call("POST", "/chat", {"text": "hi"})[0], 202)
        wait_until_idle(self.session)
        status, data = self.call("GET", "/events?since=1")
        got = json.loads(data)
        self.assertEqual([e["kind"] for e in got["events"]], ["request", "response", "answer", "done"])
        self.assertEqual(got["events"][0]["seq"], 1)

    def test_info_lists_providers_and_the_current_one(self):
        info = json.loads(self.call("GET", "/info")[1])
        self.assertEqual(info["provider"], "mock")
        self.assertEqual([p["name"] for p in info["providers"]], ["anthropic", "deepseek", "mock"])

    def test_switching_provider_over_http(self):
        status, data = self.call("POST", "/provider", {"name": "deepseek"})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data)["model"], "deepseek-flash")
        self.assertEqual(self.session.provider, "deepseek")

    def test_picking_a_model_for_the_mock(self):
        info = json.loads(self.call("GET", "/info")[1])
        mock = next(p for p in info["providers"] if p["name"] == "mock")
        self.assertIn("claude-haiku-4-5-20251001", mock["models"])
        self.assertEqual(next(p for p in info["providers"] if p["name"] == "deepseek")["models"], ["deepseek-flash"])
        status, data = self.call("POST", "/provider", {"name": "mock", "model": "claude-haiku-4-5-20251001"})
        self.assertEqual(status, 200)
        self.assertEqual(self.session.model, "claude-haiku-4-5-20251001")
        switch = [e for e in self.session.snapshot(0)["events"] if e["kind"] == "provider"][-1]
        self.assertEqual(switch["model"], "claude-haiku-4-5-20251001")
        # only models from the list
        self.assertEqual(self.call("POST", "/provider", {"name": "mock", "model": "gpt-9"})[0], 400)
        self.assertEqual(self.call("POST", "/provider", {"name": "deepseek", "model": "deepseek-v4-pro"})[0], 400)
        self.assertEqual(self.session.model, "claude-haiku-4-5-20251001")

    def test_unknown_or_keyless_provider_is_refused(self):
        self.assertEqual(self.call("POST", "/provider", {"name": "nope"})[0], 400)
        status, data = self.call("POST", "/provider", {"name": "anthropic"})
        self.assertEqual(status, 400)
        self.assertIn("needs a key", json.loads(data)["error"])
        self.assertEqual(self.session.provider, "mock")  # unchanged

    def test_empty_message_is_rejected(self):
        self.assertEqual(self.call("POST", "/chat", {"text": "  "})[0], 400)

    def test_other_host_names_are_refused(self):
        self.assertEqual(self.call("GET", "/info", headers={"Host": "evil.example:80"})[0], 403)

    def test_posts_must_be_json(self):
        status, _ = self.call("POST", "/chat", headers={"Content-Type": "text/plain"})
        self.assertEqual(status, 415)


if __name__ == "__main__":
    unittest.main()
