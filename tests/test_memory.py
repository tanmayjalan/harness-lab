"""Offline tests for memory.py (About you) and how the harness uses it.

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

from harness.core import loop
from harness.features import memory
from harness.web import server as web_server


def tmp_profile():
    return pathlib.Path(tempfile.mkdtemp()) / "profile.json"


class ProfileTests(unittest.TestCase):
    def test_new_profile_shares_nothing(self):
        facts = memory.load(tmp_profile())
        self.assertEqual([f["label"] for f in facts], [f["label"] for f in memory.STARTER])
        self.assertEqual(memory.addition(facts), "")
        self.assertEqual(memory.system_prompt("BASE", facts), "BASE")

    def test_only_ticked_facts_with_a_value_are_sent(self):
        facts = [{"label": "Name", "value": "Asha", "share": True},
                 {"label": "Units", "value": "Fahrenheit", "share": False},
                 {"label": "Time zone", "value": "", "share": True}]
        prompt = memory.system_prompt("BASE", facts)
        self.assertTrue(prompt.startswith("BASE\n\nAbout the user"))
        self.assertIn("- Name: Asha", prompt)
        self.assertNotIn("Fahrenheit", prompt)
        self.assertNotIn("Time zone", prompt)

    def test_save_cleans_and_round_trips(self):
        path = tmp_profile()
        saved = memory.save([{"label": "  Name ", "value": " Asha ", "share": 1},
                                   {"label": "", "value": "dropped", "share": True}], path)
        self.assertEqual(saved, [{"label": "Name", "value": "Asha", "share": True}])
        self.assertEqual(memory.load(path), saved)

    def test_bad_input_is_refused(self):
        for bad in [None, "text", [1, 2], [{"label": f"x{i}"} for i in range(31)]]:
            with self.subTest(bad=str(bad)[:30]), self.assertRaises(ValueError):
                memory.save(bad, tmp_profile())


class RememberTests(unittest.TestCase):
    def test_remember_adds_then_updates_and_shares(self):
        path = tmp_profile()
        memory.remember("Favourite colour", "green", path)
        memory.remember("favourite colour", "blue", path)  # same label: update, don't duplicate
        facts = [f for f in memory.load(path) if f["label"].lower() == "favourite colour"]
        self.assertEqual(facts, [{"label": "Favourite colour", "value": "blue", "share": True}])

    # Several facts saved at the same moment (Compare or evals running a question 3 at a time, say) must all
    # be kept, with no save failing on another's half-done file
    def test_facts_saved_at_the_same_time_are_all_kept(self):
        path = tmp_profile()
        errors = []

        def remember_some(who):
            for i in range(6):
                try:
                    memory.remember(f"fact {who}-{i}", "yes", path)
                except Exception as e:  # noqa: BLE001  (any failure is the bug)
                    errors.append(repr(e))
        threads = [threading.Thread(target=remember_some, args=(n,)) for n in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])
        labels = {f["label"] for f in memory.load(path)}
        self.assertEqual({f"fact {w}-{i}" for w in range(4) for i in range(6)} - labels, set())
        self.assertEqual(list(path.parent.glob("*.tmp")), [])  # no temporary files left behind

    # A damaged profile must not stop every message, and must not be overwritten by the next save either:
    # it is moved aside (kept, so you can fix it) and the starter facts are used, with a note saying so
    def test_a_damaged_profile_is_moved_aside_and_reported(self):
        from harness import saving
        path = tmp_profile()
        path.write_text('{"facts": [ broken', encoding="utf-8")
        saving.DAMAGED.clear()
        self.addCleanup(saving.DAMAGED.clear)
        facts = memory.load(path)
        self.assertEqual([f["label"] for f in facts], [f["label"] for f in memory.STARTER])
        self.assertFalse(path.exists())
        aside = list(path.parent.glob("profile.damaged-*.json"))
        self.assertEqual(len(aside), 1)
        self.assertEqual(aside[0].read_text(encoding="utf-8"), '{"facts": [ broken')
        self.assertEqual(len(saving.DAMAGED), 1)
        self.assertIn(aside[0].name, saving.notes()[0])

    # A profile edited by hand to more facts than the page allows is still read whole: it isn't damaged, so it
    # isn't moved aside (the limit applies when the page saves)
    def test_a_profile_over_the_limit_is_read_not_moved_aside(self):
        import json
        from harness import saving
        path = tmp_profile()
        facts = [{"label": f"fact {i}", "value": "x", "share": False} for i in range(memory.MAX_FACTS + 1)]
        path.write_text(json.dumps({"facts": facts}), encoding="utf-8")
        saving.DAMAGED.clear()
        self.addCleanup(saving.DAMAGED.clear)
        self.assertEqual(len(memory.load(path)), memory.MAX_FACTS + 1)
        self.assertTrue(path.exists())
        self.assertEqual(saving.notes(), [])

    def test_model_can_only_remember_with_your_ok(self):
        from anthropic.types import ToolUseBlock
        for answer, expect in [(True, "Fahrenheit"), (False, None)]:
            with self.subTest(allowed=answer):
                path = tmp_profile()
                client = SystemCapturingClient(
                    NS(stop_reason="tool_use", content=[ToolUseBlock(
                        type="tool_use", id="t1", name="remember_fact",
                        input={"label": "Temperature unit", "value": "Fahrenheit"})]))
                s = web_server.Session(client, "test", profile_path=path)
                s.start("I always use Fahrenheit")
                end = time.time() + 5
                while time.time() < end and not [e for e in s.snapshot(0)["events"] if e["kind"] == "approval"]:
                    time.sleep(0.01)
                approval = [e for e in s.snapshot(0)["events"] if e["kind"] == "approval"][0]
                self.assertEqual(approval["tool"], "remember_fact")
                s.decide(approval["id"], answer)
                while s.running and time.time() < end:
                    time.sleep(0.01)
                saved = {f["label"]: f["value"] for f in memory.load(path)}
                self.assertEqual(saved.get("Temperature unit"), expect)


class ReplacesTests(unittest.TestCase):
    # F277: remembering a label you already have replaces its value and shares it again: the approval says so
    def test_the_approval_says_what_a_fact_replaces(self):
        from anthropic.types import ToolUseBlock
        path = tmp_profile()
        memory.save([{"label": "Temperature unit", "value": "Celsius", "share": False}], path)
        client = SystemCapturingClient(
            NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id="t1", name="remember_fact",
                                                             input={"label": "temperature unit", "value": "Fahrenheit"})]))
        s = web_server.Session(client, "test", profile_path=path)
        s.start("I use Fahrenheit")
        end = time.time() + 5
        while time.time() < end and not [e for e in s.snapshot(0)["events"] if e["kind"] == "approval"]:
            time.sleep(0.01)
        approval = [e for e in s.snapshot(0)["events"] if e["kind"] == "approval"][0]
        self.assertEqual(approval["replaces"], {"label": "Temperature unit", "value": "Celsius", "shared": False})
        s.decide(approval["id"], False)
        while s.running and time.time() < end:
            time.sleep(0.01)

    def test_find_matches_a_label_whatever_its_case(self):
        facts = [{"label": "Name", "value": "Ada", "share": True}]
        self.assertEqual(memory.find(facts, " name "), facts[0])
        self.assertIsNone(memory.find(facts, "Nickname"))


class SystemCapturingClient:
    def __init__(self, *replies):
        self.replies = list(replies)
        self.systems = []
        self.messages = self

    def create(self, **kwargs):
        self.systems.append(kwargs["system"])
        if self.replies:
            return self.replies.pop(0)
        return NS(stop_reason="end_turn", content=[TextBlock(type="text", text="ok")])


def run(session, text):
    session.start(text)
    end = time.time() + 5
    while session.running and time.time() < end:
        time.sleep(0.01)


class AcrossConversationsTests(unittest.TestCase):
    def test_facts_reach_the_model_in_every_conversation(self):
        path = tmp_profile()
        memory.save([{"label": "Name", "value": "Asha", "share": True}], path)
        client = SystemCapturingClient()
        s = web_server.Session(client, "test", profile_path=path)
        run(s, "hi")
        self.assertTrue(s.reset())  # "New conversation"
        run(s, "hi again")
        self.assertEqual(len(client.systems), 2)
        self.assertTrue(all("- Name: Asha" in sp for sp in client.systems))
        request = [e for e in s.snapshot(0)["events"] if e["kind"] == "request"][0]
        self.assertEqual(request["facts"], 1)
        self.assertIn("Asha", request["system"])  # the page can show the exact system prompt

    def test_unticking_applies_from_the_next_message(self):
        path = tmp_profile()
        memory.save([{"label": "Name", "value": "Asha", "share": True}], path)
        client = SystemCapturingClient()
        s = web_server.Session(client, "test", profile_path=path)
        run(s, "one")
        memory.save([{"label": "Name", "value": "Asha", "share": False}], path)
        run(s, "two")
        self.assertIn("Asha", client.systems[0])
        self.assertEqual(client.systems[1], loop.SYSTEM)


class ProfileHttpTests(unittest.TestCase):
    def setUp(self):
        self.path = tmp_profile()
        self.session = web_server.Session(SystemCapturingClient(), "test", profile_path=self.path)
        self.server = web_server.make_server(self.session, 0)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def call(self, method, path, body=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        headers = {"Host": "127.0.0.1", "Content-Type": "application/json"}
        conn.request(method, path, body=json.dumps(body) if body is not None else None, headers=headers)
        r = conn.getresponse()
        data = json.loads(r.read())
        conn.close()
        return r.status, data

    def test_get_and_save_profile(self):
        status, data = self.call("GET", "/profile")
        self.assertEqual((status, data["shared"]), (200, 0))
        status, data = self.call("POST", "/profile", {"facts": [{"label": "Name", "value": "Asha", "share": True}]})
        self.assertEqual((status, data["shared"]), (200, 1))
        self.assertIn("- Name: Asha", data["addition"])
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8"))["facts"][0]["value"], "Asha")

    def test_bad_profile_is_refused(self):
        status, data = self.call("POST", "/profile", {"facts": "not a list"})
        self.assertEqual(status, 400)
        self.assertFalse(self.path.exists())


if __name__ == "__main__":
    unittest.main()
