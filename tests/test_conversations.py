"""Offline tests for saved conversations (conversations.py and the web server's use of it).

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

from anthropic.types import TextBlock

from harness.features import lab_settings
from harness.web import conversations
from harness.web import server as web_server


class CountingClient:
    """Remembers how many messages each call was sent."""

    def __init__(self):
        self.sizes = []
        self.messages = self

    def create(self, **kwargs):
        self.sizes.append(len(kwargs["messages"]))
        return NS(stop_reason="end_turn", content=[TextBlock(type="text", text="ok")])


def run(session, text):
    session.start(text)
    end = time.time() + 5
    while session.running and time.time() < end:
        time.sleep(0.01)


class SavedConversationTests(unittest.TestCase):
    def test_saved_after_each_message_and_listed(self):
        s = web_server.Session(CountingClient(), "test")
        run(s, "What is the capital of France?")
        saved = conversations.load(s.conv_id)
        self.assertEqual(saved["title"], "What is the capital of France?")
        self.assertEqual([m["role"] for m in saved["messages"]], ["user", "assistant"])
        self.assertEqual(saved["events"][-1]["kind"], "done")
        self.assertIn(s.conv_id, [c["id"] for c in conversations.list_all()])

    def test_reopen_and_carry_on_with_the_full_history(self):
        first = web_server.Session(CountingClient(), "test")
        run(first, "one")
        conv_id = first.conv_id

        client = CountingClient()
        later = web_server.Session(client, "test")   # e.g. after restarting the server
        self.assertTrue(later.open(conv_id))
        self.assertEqual(later.snapshot(0)["events"][0]["text"], "one")   # the page replays it
        run(later, "two")
        self.assertEqual(client.sizes, [3])   # it was sent the earlier turn too
        self.assertEqual(len(conversations.load(conv_id)["messages"]), 4)

    def test_new_conversation_keeps_the_old_one(self):
        s = web_server.Session(CountingClient(), "test")
        run(s, "keep me")
        old = s.conv_id
        s.reset()
        self.assertNotEqual(s.conv_id, old)
        self.assertEqual(conversations.load(old)["title"], "keep me")

    def test_deleting_the_open_conversation_starts_a_new_one(self):
        s = web_server.Session(CountingClient(), "test")
        run(s, "delete me")
        old = s.conv_id
        s.delete(old)
        self.assertNotEqual(s.conv_id, old)
        self.assertNotIn(old, [c["id"] for c in conversations.list_all()])

    def test_odd_ids_are_refused(self):
        for bad in ["../../secret", "a/b", "", None, "x" * 100]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                conversations.load(bad)


class RunSnapshotTests(unittest.TestCase):
    def test_one_run_per_message_with_the_settings_of_its_first_call(self):
        events = [
            {"seq": 0, "kind": "user", "time": 1.0, "text": "first"},
            {"seq": 1, "kind": "request", "time": 1.1, "config": {"model": "m1", "system": "long prompt", "trim": None}},
            {"seq": 2, "kind": "request", "time": 1.2, "config": {"model": "IGNORED"}},
            {"seq": 3, "kind": "user", "time": 2.0, "text": "x" * 100},
            {"seq": 4, "kind": "error", "time": 2.1, "message": "no request was made"},
        ]
        runs = conversations.runs(events)
        self.assertEqual([r["seq"] for r in runs], [0, 3])
        self.assertEqual(runs[0]["config"], {"model": "m1", "trim": None})  # the prompt itself isn't copied
        self.assertEqual(len(runs[1]["text"]), 80)
        self.assertIsNone(runs[1]["config"])

    def test_list_shows_the_setup_last_used(self):
        settings = pathlib.Path(tempfile.mkdtemp()) / "settings.json"
        lab_settings.save({"trim": {"enabled": True, "keep_last": 2}}, web_server.loop.SYSTEM, web_server.tools.TOOLS,
                          web_server.loop.default_permission, settings)
        s = web_server.Session(CountingClient(), "test", model="test-model", provider="mock", settings_path=settings)
        run(s, "with trimming")
        item = next(c for c in conversations.list_all() if c["id"] == s.conv_id)
        self.assertEqual((item["runs"], item["provider"], item["model"]), (1, "mock", "test-model"))
        self.assertIn("trimming on", item["badge"])
        self.assertEqual(conversations.load(s.conv_id)["runs"][0]["text"], "with trimming")

    def test_older_files_are_still_listed(self):
        conversations.DIR.mkdir(parents=True, exist_ok=True)
        old = {"id": "20200101-000000-abcdef", "title": "old", "created": 1, "updated": 2,
               "messages": [{"role": "user", "content": "hi"}],
               "events": [{"seq": 0, "kind": "user", "time": 1, "text": "hi"}]}  # no "runs", no config
        (conversations.DIR / "20200101-000000-abcdef.json").write_text(json.dumps(old), encoding="utf-8")
        item = next(c for c in conversations.list_all() if c["id"] == old["id"])
        self.assertEqual((item["runs"], item["badge"], item["model"]), (1, [], None))


class ConversationHttpTests(unittest.TestCase):
    def setUp(self):
        self.session = web_server.Session(CountingClient(), "test")
        self.server = web_server.make_server(self.session, 0)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def call(self, path, body=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        conn.request("POST" if body is not None else "GET", path, body=json.dumps(body) if body is not None else None,
                     headers={"Host": "127.0.0.1", "Content-Type": "application/json"})
        r = conn.getresponse()
        data = json.loads(r.read())
        conn.close()
        return r.status, data

    def test_list_open_and_refuse_unknown(self):
        run(self.session, "hello there")
        saved = self.session.conv_id
        self.session.reset()
        status, data = self.call("/conversations")
        self.assertEqual(status, 200)
        self.assertIn(saved, [c["id"] for c in data["items"]])
        status, data = self.call("/conversations/open", {"id": saved})
        self.assertEqual((status, data["current"]), (200, saved))
        self.assertEqual(self.call("/conversations/open", {"id": "../../etc"})[0], 404)
        self.assertEqual(self.call("/conversations/open", {"id": "20990101-000000-abcdef"})[0], 404)

    def test_get_returns_the_whole_saved_file(self):
        run(self.session, "read me back")
        status, data = self.call(f"/conversations/get?id={self.session.conv_id}")
        self.assertEqual(status, 200)
        self.assertEqual(data["runs"][0]["text"], "read me back")
        self.assertIn("events", data)
        for bad in ["../x", "..%2Fx", "", "20990101-000000-abcdef"]:
            with self.subTest(bad=bad):
                self.assertEqual(self.call(f"/conversations/get?id={bad}")[0], 404)



class DeleteAndRestoreTests(unittest.TestCase):
    # F091: a deleted conversation can be brought back (Undo)
    def test_a_deleted_conversation_can_be_restored(self):
        from harness.web import conversations
        cid = conversations.new_id()
        conversations.save(cid, "Keep me", [], [])
        conversations.delete(cid)
        self.assertNotIn(cid, [c["id"] for c in conversations.list_all()])
        self.assertTrue(conversations.restore(cid))
        self.assertIn(cid, [c["id"] for c in conversations.list_all()])
        self.assertFalse(conversations.restore("nope"))


if __name__ == "__main__":
    unittest.main()


class PurgeTests(unittest.TestCase):
    # Deferred M8: deleted conversations stay 7 days (for Undo or a manual rescue), then go
    def test_deleted_files_older_than_a_week_are_purged(self):
        import os
        old, new = conversations.new_id(), conversations.new_id()
        for cid in (old, new):
            conversations.save(cid, cid, [], [])
            conversations.delete(cid)
        now = time.time()
        os.utime(conversations.DIR / ".deleted" / f"{old}.json", (now - 8 * 86400, now - 8 * 86400))
        removed = conversations.purge_deleted(days=7, now=now)
        self.assertEqual(removed, 1)
        self.assertFalse(conversations.restore(old))
        self.assertTrue(conversations.restore(new))

    def test_purging_with_nothing_deleted_is_harmless(self):
        saved = conversations.DIR
        conversations.DIR = pathlib.Path(tempfile.mkdtemp()) / "none"
        self.addCleanup(setattr, conversations, "DIR", saved)
        self.assertEqual(conversations.purge_deleted(), 0)
