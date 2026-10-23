"""Offline tests for the web server's approve, stop, reset, delete and restore requests, sent over HTTP
the way the page sends them.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import http.client
import json
import pathlib
import tempfile
import threading
import unittest

from test_web_server import FakeClient, reply, text, tool_use, wait_for, wait_until_idle

from harness.web import server as web_server


class RouteTests(unittest.TestCase):
    def start(self, *replies, gate=None):
        self.session = web_server.Session(FakeClient(*replies, gate=gate), "test")
        self.server = web_server.make_server(self.session, 0)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def post(self, path, body):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        conn.request("POST", path, body=json.dumps(body),
                     headers={"Host": "127.0.0.1", "Content-Type": "application/json"})
        r = conn.getresponse()
        data = json.loads(r.read() or b"{}")
        conn.close()
        return r.status, data

    def test_approve_answers_only_the_waiting_question_and_only_once(self):
        target = pathlib.Path(tempfile.mkdtemp()) / "out.txt"
        self.start(reply("tool_use", tool_use("t1", "write_file", path=str(target), content="hello")),
                   reply("end_turn", text("Written.")))
        self.assertEqual(self.post("/chat", {"text": "write it"})[0], 202)
        approval = wait_for(self.session, "approval")
        self.assertEqual(self.post("/approve", {"id": "not-this-one", "allowed": True})[0], 404)
        self.assertEqual(self.post("/approve", {"id": approval["id"], "allowed": True}), (200, {"ok": True}))
        wait_until_idle(self.session)
        self.assertEqual(target.read_text(encoding="utf-8"), "hello")
        self.assertEqual(self.post("/approve", {"id": approval["id"], "allowed": True})[0], 404)  # already answered

    def test_stop_ends_a_running_message_and_says_when_nothing_runs(self):
        gate = threading.Event()
        self.start(reply("end_turn", text("too late")), gate=gate)
        self.assertEqual(self.post("/stop", {})[0], 409)  # nothing is running yet
        self.post("/chat", {"text": "hello"})
        self.assertEqual(self.post("/stop", {}), (200, {"ok": True}))
        gate.set()
        wait_until_idle(self.session)
        kinds = [e["kind"] for e in self.session.snapshot(0)["events"]]
        self.assertIn("stopping", kinds)

    def test_reset_waits_for_the_running_message_then_starts_a_new_conversation(self):
        gate = threading.Event()
        self.start(reply("end_turn", text("Hi.")), gate=gate)
        self.post("/chat", {"text": "hello"})
        self.assertEqual(self.post("/reset", {})[0], 409)  # still running
        gate.set()
        wait_until_idle(self.session)
        old = self.session.conv_id
        self.assertEqual(self.post("/reset", {}), (200, {"ok": True}))
        self.assertNotEqual(self.session.conv_id, old)
        self.assertEqual(self.session.messages, [])

    def test_a_deleted_conversation_can_be_brought_back_once(self):
        self.start(reply("end_turn", text("Hi.")))
        self.post("/chat", {"text": "hello"})
        wait_until_idle(self.session)
        cid = self.session.conv_id
        status, data = self.post("/conversations/delete", {"id": cid})
        self.assertEqual(status, 200)
        self.assertNotIn(cid, [c["id"] for c in data["items"]])
        status, data = self.post("/conversations/restore", {"id": cid})
        self.assertEqual(status, 200)
        self.assertIn(cid, [c["id"] for c in data["items"]])
        self.assertEqual(self.post("/conversations/restore", {"id": cid})[0], 404)  # nothing left to bring back
