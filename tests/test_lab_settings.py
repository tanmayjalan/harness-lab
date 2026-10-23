"""Offline tests for lab_settings.py: editing the prompt, tool descriptions and permissions.

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

from harness.core import loop, tools
from harness.features import lab_settings
from harness.web import server as web_server


def tmp_settings():
    return pathlib.Path(tempfile.mkdtemp()) / "lab_settings.json"


def save(changes, path):
    return lab_settings.save(changes, loop.SYSTEM, tools.TOOLS, loop.default_permission, path)


class CleanTests(unittest.TestCase):
    # Saves at the same moment (a Settings change while a reply saves, say) must not fail on each other's
    # half-done file
    def test_saves_at_the_same_time_never_fail(self):
        path = tmp_settings()
        errors = []

        def save_some(who):
            for i in range(15):
                try:
                    save({"system": f"Prompt {who}-{i}"}, path)
                except Exception as e:  # noqa: BLE001  (any failure is the bug)
                    errors.append(repr(e))
        threads = [threading.Thread(target=save_some, args=(n,)) for n in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])
        self.assertTrue(lab_settings.load(path)["system"].startswith("Prompt "))
        self.assertEqual(list(path.parent.glob("*.tmp")), [])

    # A damaged settings file (bad JSON, or JSON that isn't an object) is moved aside and reported, not used
    def test_a_damaged_settings_file_is_moved_aside_and_reported(self):
        from harness import saving
        for text in ["{ not json", "[1, 2]"]:
            with self.subTest(text=text):
                path = tmp_settings()
                path.write_text(text, encoding="utf-8")
                saving.DAMAGED.clear()
                self.addCleanup(saving.DAMAGED.clear)
                self.assertEqual(lab_settings.load(path), lab_settings.empty())
                aside = list(path.parent.glob("lab_settings.damaged-*.json"))
                self.assertEqual([a.read_text(encoding="utf-8") for a in aside], [text])
                self.assertIn(aside[0].name, saving.notes()[0])

    def test_only_real_changes_are_kept(self):
        path = tmp_settings()
        kept = save({
            "system": loop.SYSTEM,                                  # unchanged
            "descriptions": {"calculate": "Do maths.", "read_file": tools.TOOLS[1]["description"],
                             "no_such_tool": "ignored"},
            "permissions": {"write_file": "ask", "read_file": "block"},  # write_file "ask" is the default
        }, path)
        self.assertEqual(kept, {"system": None, "descriptions": {"calculate": "Do maths."},
                                "permissions": {"read_file": "block"}, "trim": None, "compact": None,
                                "thinking": None, "cache": None, "apply": None, "limits": None, "skills": None, "faults": None,
                                "tools_at_once": None, "workflow": None, "run_code": None, "extra_tools": None})
        self.assertEqual(lab_settings.load(path), kept)
        self.assertEqual(lab_settings.what_changed(kept), ["1 tool description", "1 permission"])

    def test_numbers_are_kept_while_the_feature_is_off(self):
        # F006: set the number first, then tick the box; the number must not snap back
        path = tmp_settings()
        kept = save({"trim": {"enabled": False, "keep_last": 5},
                     "compact": {"enabled": False, "over_chars": 50000}}, path)
        self.assertEqual(kept["trim"], {"enabled": False, "keep_last": 5})
        self.assertEqual(kept["compact"], {"enabled": False, "over_chars": 50000})
        self.assertEqual(lab_settings.what_changed(kept), [])  # off is still off
        # the default number while off is not a change worth storing
        kept = save({"trim": {"enabled": False, "keep_last": 2},
                     "compact": {"enabled": False, "over_chars": 40000}}, path)
        self.assertIsNone(kept["trim"])
        self.assertIsNone(kept["compact"])

    def test_thinking_and_caching_switches(self):
        path = tmp_settings()
        kept = save({"thinking": {"enabled": True, "budget": 2000}, "cache": {"enabled": True}}, path)
        self.assertEqual((kept["thinking"], kept["cache"]),
                         ({"enabled": True, "budget": 2000, "effort": "medium"}, {"enabled": True}))
        self.assertEqual(lab_settings.thinking_spec(kept, "budget"), {"style": "budget", "budget": 2000})
        self.assertEqual(lab_settings.thinking_spec(kept, "adaptive"), {"style": "adaptive", "effort": "medium"})
        self.assertEqual((lab_settings.thinking_budget(kept), lab_settings.caching(kept)), (2000, True))
        self.assertEqual(lab_settings.what_changed(kept), ["thinking on", "caching on"])
        off = save({"thinking": {"enabled": False, "budget": 2000}, "cache": {"enabled": False}}, path)
        self.assertEqual((lab_settings.thinking_budget(off), lab_settings.caching(off)), (None, False))
        self.assertIsNone(lab_settings.thinking_spec(off, "adaptive"))
        # Your own server is told "off" out loud (gemma4 thinks unless told not to); "on" is the same as elsewhere
        self.assertEqual(lab_settings.thinking_spec(off, "budget", say_off=True), {"style": "off"})
        self.assertEqual(lab_settings.thinking_spec(kept, "budget", say_off=True), {"style": "budget", "budget": 2000})
        for bad in [{"thinking": {"enabled": True, "budget": 50}}, {"thinking": "yes"}, {"cache": True},
                    {"thinking": {"enabled": True, "effort": "extreme"}}]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                save(bad, path)

    def test_back_to_defaults_removes_the_file(self):
        path = tmp_settings()
        save({"system": "Be a pirate."}, path)
        self.assertTrue(path.exists())
        save({"system": loop.SYSTEM}, path)
        self.assertFalse(path.exists())

    def test_bad_input_is_refused(self):
        for bad in [[], {"permissions": {"read_file": "sometimes"}}, {"system": 42}]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                save(bad, tmp_settings())

    def test_each_on_off_switch_says_its_own_name_and_the_first_bad_setting_is_reported(self):
        for name in ("cache", "tools_at_once", "workflow", "run_code"):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, f'^{name} must be like {{"enabled": true}}$'):
                save({name: True}, tmp_settings())
        # Checked in a fixed order: the prompt, descriptions and permissions first, then the switches as listed
        with self.assertRaisesRegex(ValueError, "^trim must be like"):
            save({"limits": "x", "cache": True, "trim": "x"}, tmp_settings())
        with self.assertRaisesRegex(ValueError, "^the system prompt"):
            save({"trim": "x", "system": 42}, tmp_settings())

    def test_a_setting_left_out_or_equal_to_its_default_is_not_kept(self):
        self.assertEqual(lab_settings.clean({"trim": {"enabled": False}, "apply": "message", "system": loop.SYSTEM,
                                             "limits": {"max_tokens": 16000, "max_turns": 20}},
                                            loop.SYSTEM, tools.TOOLS, loop.default_permission), lab_settings.empty())


class CapturingClient:
    def __init__(self, *replies):
        self.replies = list(replies) or [NS(stop_reason="end_turn", content=[TextBlock(type="text", text="ok")])]
        self.calls = []
        self.messages = self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.replies.pop(0)


def run(session, text):
    session.start(text)
    end = time.time() + 5
    while session.running and time.time() < end:
        time.sleep(0.01)


class EditsReachTheModelTests(unittest.TestCase):
    def test_edited_prompt_and_description_are_sent(self):
        path = tmp_settings()
        save({"system": "Be a pirate.", "descriptions": {"calculate": "Do maths."}}, path)
        client = CapturingClient()
        s = web_server.Session(client, "test", settings_path=path)
        run(s, "hi")
        sent = client.calls[0]
        self.assertTrue(sent["system"].startswith("Be a pirate."))
        self.assertEqual({t["name"]: t["description"] for t in sent["tools"]}["calculate"], "Do maths.")
        request = [e for e in s.snapshot(0)["events"] if e["kind"] == "request"][0]
        self.assertEqual(request["edited"], ["the system prompt", "1 tool description"])

    def test_blocked_tool_is_refused(self):
        path = tmp_settings()
        save({"permissions": {"roll_dice": "block"}}, path)
        client = CapturingClient(
            NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id="t1", name="roll_dice", input={})]),
            NS(stop_reason="end_turn", content=[TextBlock(type="text", text="ok")]))
        s = web_server.Session(client, "test", settings_path=path)
        run(s, "roll")
        result = [e for e in s.snapshot(0)["events"] if e["kind"] == "tool_result"][0]["result"]
        self.assertTrue(result["is_error"])
        self.assertIn("block", result["content"])

    def test_events_say_which_rule_applied_and_how_it_ended(self):
        path = tmp_settings()
        save({"permissions": {"roll_dice": "block"}}, path)
        client = CapturingClient(
            NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id="t1", name="roll_dice", input={}),
                                                ToolUseBlock(type="tool_use", id="t2", name="calculate",
                                                             input={"expression": "1+1"})]),
            NS(stop_reason="end_turn", content=[TextBlock(type="text", text="ok")]))
        s = web_server.Session(client, "test", settings_path=path)
        run(s, "go")
        events = s.snapshot(0)["events"]
        calls = [(e["name"], e["permission"], e["outside"], e["source"]) for e in events if e["kind"] == "tool_call"]
        self.assertEqual(calls, [("roll_dice", "block", False, "built in"), ("calculate", "allow", False, "built in")])
        self.assertEqual([e["outcome"] for e in events if e["kind"] == "tool_result"], ["blocked", "ran"])
        # the outcome is for the page only: the result sent to the model has no extra fields
        sent_results = client.calls[1]["messages"][2]["content"]   # [you, model's tool request, tool results, ...]
        self.assertEqual(set(sent_results[0]), {"type", "tool_use_id", "content", "is_error"})

    def test_each_call_records_the_settings_in_effect(self):
        path = tmp_settings()
        save({"system": "Be brief.", "permissions": {"write_file": "allow"}, "trim": {"enabled": True, "keep_last": 1}},
             path)
        s = web_server.Session(CapturingClient(), "Mock: replies from claude -p", model="claude-opus-5-5",
                               provider="mock", settings_path=path)
        run(s, "hi")
        request = [e for e in s.snapshot(0)["events"] if e["kind"] == "request"][0]
        self.assertEqual(request["provider"], "Mock: replies from claude -p")   # the label, which the page shows
        cfg = request["config"]
        self.assertEqual((cfg["provider"], cfg["model"], cfg["system_edited"]), ("mock", "claude-opus-5-5", True))
        self.assertEqual(cfg["permissions"], {"write_file": "allow"})           # only what you changed
        self.assertTrue(cfg["system"].startswith("Be brief."))
        tool = {t["name"]: t for t in request["tools"]}["write_file"]
        self.assertEqual(set(tool), {"name", "description", "source", "permission"})
        self.assertEqual(tool["permission"], "allow")
        self.assertEqual(lab_settings.badges(cfg), ["claude-opus-5-5", "prompt edited", "1 permission", "trimming on"])  # F092
        self.assertEqual(lab_settings.badges(None), [])

    def test_every_event_says_which_message_it_belongs_to(self):
        s = web_server.Session(CapturingClient(NS(stop_reason="end_turn", content=[TextBlock(type="text", text="a")]),
                                               NS(stop_reason="end_turn", content=[TextBlock(type="text", text="b")])),
                               "test")
        run(s, "one")
        run(s, "two")
        msgs = {(e["kind"], e["msg"]) for e in s.snapshot(0)["events"]}
        self.assertIn(("user", 1), msgs)
        self.assertIn(("answer", 2), msgs)
        self.assertEqual({e["msg"] for e in s.snapshot(0)["events"] if e["seq"] >= 5}, {2})
        conv = s.conv_id
        s.reset()
        self.assertEqual(s.msg, 0)
        s.open(conv)
        self.assertEqual(s.msg, 2)


class SettingsHttpTests(unittest.TestCase):
    def setUp(self):
        self.path = tmp_settings()
        self.session = web_server.Session(CapturingClient(), "test", settings_path=self.path)
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

    def test_a_damaged_file_is_reported_to_the_page(self):
        from harness import saving
        saving.DAMAGED.clear()
        self.addCleanup(saving.DAMAGED.clear)
        self.path.write_text("{ not json", encoding="utf-8")
        status, data = self.call("/settings")
        self.assertEqual(status, 200)
        self.assertEqual(len(data["damaged"]), 1)
        self.assertIn("lab_settings.damaged-", data["damaged"][0])

    def test_read_change_and_reset(self):
        status, data = self.call("/settings")
        self.assertEqual(status, 200)
        self.assertEqual(data["system"], data["system_default"])
        write = next(t for t in data["tools"] if t["name"] == "write_file")
        self.assertEqual((write["permission"], write["default_permission"]), ("ask", "ask"))

        status, data = self.call("/settings", {"permissions": {"write_file": "block"}})
        self.assertEqual(status, 200)
        self.assertEqual(next(t for t in data["tools"] if t["name"] == "write_file")["permission"], "block")
        self.assertEqual(data["changed"], ["1 permission"])

        status, data = self.call("/settings/reset", {})
        self.assertEqual(data["changed"], [])
        self.assertFalse(self.path.exists())

    def test_saving_one_permission_keeps_the_others(self):
        self.call("/settings", {"permissions": {"write_file": "allow"}})
        status, data = self.call("/settings", {"permissions": {"roll_dice": "block"}})
        rules = {t["name"]: t["permission"] for t in data["tools"]}
        self.assertEqual((rules["write_file"], rules["roll_dice"]), ("allow", "block"))
        status, data = self.call("/settings", {"permissions": {"write_file": "ask"}})   # back to its default
        rules = {t["name"]: t["permission"] for t in data["tools"]}
        self.assertEqual((rules["write_file"], rules["roll_dice"]), ("ask", "block"))
        self.assertEqual(data["changed"], ["1 permission"])

    def test_bad_settings_are_refused(self):
        status, _ = self.call("/settings", {"permissions": {"write_file": "maybe"}})
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()


class WhenEditsApplyTests(unittest.TestCase):
    def two_messages_with_an_edit_between(self, apply):
        path = tmp_settings()
        save({"apply": apply}, path)
        client = CapturingClient(*[NS(stop_reason="end_turn", content=[TextBlock(type="text", text="ok")])] * 3)
        s = web_server.Session(client, "Mock", model="m", provider="mock", settings_path=path)
        run(s, "first")
        save({"apply": apply, "system": "Be a pirate."}, path)
        run(s, "second")
        requests = [e for e in s.snapshot(0)["events"] if e["kind"] == "request"]
        return s, client, requests

    def test_from_the_next_message_by_default(self):
        s, client, requests = self.two_messages_with_an_edit_between("message")
        self.assertNotIn("pirate", client.calls[0]["system"])
        self.assertIn("pirate", client.calls[1]["system"])
        self.assertEqual([r["start_changed"] for r in requests], [False, True])  # the cache can't help call 2

    def test_per_conversation_keeps_the_start_until_a_new_one(self):
        s, client, requests = self.two_messages_with_an_edit_between("conversation")
        self.assertNotIn("pirate", client.calls[1]["system"])  # still the start it began with
        self.assertEqual([r["start_changed"] for r in requests], [False, False])
        from harness.web import conversations
        self.assertNotIn("pirate", conversations.load(s.conv_id)["frozen"]["system"])
        s.reset()
        run(s, "third")
        self.assertIn("pirate", client.calls[2]["system"])  # a new conversation picks up the edit


    # F270: with the start kept, what a call reports (prompt edited, re-described tools, facts) is what it sent,
    # not today's settings; the sidebar tags and a re-run's "saved run" read the same record
    def test_a_kept_start_reports_what_it_sent(self):
        import json
        path, profile = tmp_settings(), tmp_settings()
        profile.write_text(json.dumps({"facts": [{"label": "Units", "value": "Celsius", "share": True}]}), encoding="utf-8")
        save({"apply": "conversation"}, path)
        client = CapturingClient(*[NS(stop_reason="end_turn", content=[TextBlock(type="text", text="ok")])] * 2)
        s = web_server.Session(client, "Mock", model="m", provider="mock", settings_path=path, profile_path=profile)
        run(s, "first")
        save({"apply": "conversation", "system": "Be a pirate.", "descriptions": {"roll_dice": "Throws dice."}}, path)
        profile.write_text(json.dumps({"facts": [{"label": "Units", "value": "Celsius", "share": False}]}), encoding="utf-8")
        run(s, "second")
        second = [e for e in s.snapshot(0)["events"] if e["kind"] == "request"][1]
        self.assertIn("Celsius", client.calls[1]["system"])  # the kept start still carries the fact
        self.assertEqual((second["config"]["system_edited"], second["config"]["descriptions"], second["config"]["facts_shared"]),
                         (False, [], 1))
        self.assertEqual(second["facts"], 1)
        self.assertNotIn("the system prompt", second["edited"])
        self.assertNotIn("1 tool description", second["config"]["edited"])
        self.assertIn("prompt fixed per conversation", second["edited"])  # per-message settings still count
        self.assertEqual(lab_settings.badges(second["config"]), ["m", "1 fact"])

    # F270: a start kept by an older save (only its text) still reports what it sent
    def test_an_older_kept_start_is_read_from_its_text(self):
        from harness.core import tools as core_tools
        from harness.features import memory
        fact = {"label": "Units", "value": "Celsius", "share": True}
        described = [{**t, "description": "Throws dice."} if t["name"] == "roll_dice" else t for t in core_tools.TOOLS]
        old = {"system": memory.system_prompt(loop.SYSTEM, [fact]), "tools": described}
        self.assertEqual(lab_settings.kept_start(old, loop.SYSTEM, core_tools.TOOLS),
                         {"system_edited": False, "descriptions": ["roll_dice"], "facts_shared": 1})
        edited = {"system": "Be a pirate.", "tools": core_tools.TOOLS}
        self.assertEqual(lab_settings.kept_start(edited, loop.SYSTEM, core_tools.TOOLS),
                         {"system_edited": True, "descriptions": [], "facts_shared": 0})

    # F275: kept tools are shaped for the provider in use at each message ("strict" only for Anthropic)
    def test_kept_tools_follow_a_provider_switch(self):
        path = tmp_settings()
        save({"apply": "conversation"}, path)
        client = CapturingClient(*[NS(stop_reason="end_turn", content=[TextBlock(type="text", text="ok")])] * 2)
        s = web_server.Session(client, "Anthropic", model="claude-opus-5-5", provider="anthropic", settings_path=path)
        run(s, "first")
        strict = lambda call: [t["name"] for t in call["tools"] if t.get("strict")]  # noqa: E731
        self.assertEqual(strict(client.calls[0]), ["submit_expense"])
        s.switch("mock", client, "Mock", "m")
        run(s, "second")
        self.assertEqual(strict(client.calls[1]), [])  # the mock isn't sent Anthropic's option

    def test_a_message_in_per_message_mode_drops_the_kept_start(self):
        # F176: per conversation, then per message with an edit, then per conversation again:
        # the conversation must not snap back to the start it kept the first time
        path = tmp_settings()
        save({"apply": "conversation"}, path)
        client = CapturingClient(*[NS(stop_reason="end_turn", content=[TextBlock(type="text", text="ok")])] * 3)
        s = web_server.Session(client, "Mock", model="m", provider="mock", settings_path=path)
        run(s, "first")
        save({"apply": "message", "system": "Be a pirate."}, path)
        run(s, "second")
        save({"apply": "conversation", "system": "Be a pirate."}, path)
        run(s, "third")
        self.assertIn("pirate", client.calls[1]["system"])
        self.assertIn("pirate", client.calls[2]["system"])


class LimitsTests(unittest.TestCase):
    def test_limits_are_checked_and_reach_the_model(self):
        path = tmp_settings()
        with self.assertRaises(ValueError):
            save({"limits": {"max_tokens": 10}}, path)
        with self.assertRaises(ValueError):
            save({"limits": {"max_turns": 50}}, path)
        kept = save({"limits": {"max_tokens": 300, "max_turns": 2}}, path)
        self.assertEqual(lab_settings.limits(kept), (300, 2))
        self.assertEqual(save({"limits": {"max_tokens": 16000, "max_turns": 20}}, path)["limits"], None)  # defaults
        save({"limits": {"max_tokens": 300, "max_turns": 2}}, path)
        roll = NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id="r", name="roll_dice", input={"sides": 6})])
        client = CapturingClient(roll, roll, roll)
        s = web_server.Session(client, "Mock", model="m", provider="mock", settings_path=path)
        run(s, "keep rolling")
        self.assertEqual([c["max_tokens"] for c in client.calls], [300, 300])  # two calls, then the limit
        error = [e for e in s.snapshot(0)["events"] if e["kind"] == "error"][0]
        self.assertEqual(error["message"], "Stopped after 2 model calls: the most allowed for one message.")
        self.assertIn("max_turns (2)", error["detail"])  # the raw error, which the page reads for its note
