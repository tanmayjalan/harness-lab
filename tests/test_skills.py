"""Offline tests for skills (features/skills.py): instructions the model loads only when it needs them.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import json
import pathlib
import tempfile
import time
import unittest
from types import SimpleNamespace as NS
from unittest import mock

from anthropic.types import TextBlock, ToolUseBlock

from harness.core import loop, tools
from harness.features import lab_settings, skills
from harness.web import server as web_server

EXPENSES = """---
name: expenses
description: Filing an expense with submit_expense
---
Use YYYY-MM-DD dates. Alcohol is never reimbursed.
"""
NOTES = """---
name: meeting-notes
description: Summarising meeting notes
---
Write Decided / To do / Open questions.
"""


def folder(*files):
    d = pathlib.Path(tempfile.mkdtemp())
    for i, text in enumerate(files):
        (d / f"skill{i}.md").write_text(text, encoding="utf-8")
    return d


class SkillFileTests(unittest.TestCase):
    def test_a_skill_file_has_a_name_a_description_and_instructions(self):
        found = skills.load_all(folder(EXPENSES, NOTES))
        self.assertEqual([s["name"] for s in found], ["expenses", "meeting-notes"])
        self.assertEqual(found[0]["description"], "Filing an expense with submit_expense")
        self.assertEqual(found[0]["body"], "Use YYYY-MM-DD dates. Alcohol is never reimbursed.")

    def test_a_file_without_a_name_is_skipped(self):
        self.assertEqual(skills.load_all(folder("just some text", EXPENSES))[0]["name"], "expenses")
        self.assertEqual(len(skills.load_all(folder("just some text", EXPENSES))), 1)

    def test_no_folder_means_no_skills(self):
        self.assertEqual(skills.load_all(pathlib.Path(tempfile.mkdtemp()) / "missing"), [])

    def test_loading_gives_the_instructions_and_a_wrong_name_lists_the_right_ones(self):
        d = folder(EXPENSES, NOTES)
        self.assertIn("Alcohol is never reimbursed.", skills.load({"name": "expenses"}, d))
        with self.assertRaises(ValueError) as e:
            skills.load({"name": "taxes"}, d)
        self.assertIn("expenses, meeting-notes", str(e.exception))

    def test_the_shipped_skills_are_well_formed(self):
        shipped = skills.load_all(pathlib.Path(__file__).resolve().parent.parent / "config" / "skills")
        self.assertEqual(sorted(s["name"] for s in shipped), ["expenses", "meeting-notes", "trip-check"])
        for s in shipped:
            self.assertTrue(s["description"] and s["body"], s["name"])


class PromptTests(unittest.TestCase):
    def test_on_demand_lists_one_line_per_skill(self):
        found = skills.load_all(folder(EXPENSES, NOTES))
        text = skills.system_prompt("BASE", {"enabled": True, "mode": "on_demand"}, found)
        self.assertTrue(text.startswith("BASE\n\n"))
        self.assertIn("- expenses: Filing an expense with submit_expense", text)
        self.assertIn("load_skill", text)
        self.assertNotIn("Alcohol is never reimbursed.", text)  # the full text waits until it's loaded

    def test_all_in_the_prompt_puts_every_skill_in_full(self):
        found = skills.load_all(folder(EXPENSES, NOTES))
        text = skills.system_prompt("BASE", {"enabled": True, "mode": "all_in_prompt"}, found)
        self.assertIn("Alcohol is never reimbursed.", text)
        self.assertIn("Write Decided / To do / Open questions.", text)
        self.assertNotIn("load_skill", text)

    def test_off_or_no_skills_changes_nothing(self):
        found = skills.load_all(folder(EXPENSES))
        self.assertEqual(skills.system_prompt("BASE", None, found), "BASE")
        self.assertEqual(skills.system_prompt("BASE", {"enabled": True, "mode": "on_demand"}, []), "BASE")


class SettingTests(unittest.TestCase):
    def clean(self, changes):
        return lab_settings.clean(changes, loop.SYSTEM, tools.TOOLS, loop.default_permission)

    def test_the_setting_is_kept_only_when_on_and_checked(self):
        self.assertEqual(self.clean({"skills": {"enabled": True}})["skills"], {"enabled": True, "mode": "on_demand"})
        self.assertEqual(self.clean({"skills": {"enabled": True, "mode": "all_in_prompt"}})["skills"],
                         {"enabled": True, "mode": "all_in_prompt"})
        self.assertIsNone(self.clean({"skills": {"enabled": False}})["skills"])
        with self.assertRaises(ValueError):
            self.clean({"skills": {"enabled": True, "mode": "sometimes"}})

    def test_it_counts_as_a_change_and_a_tag(self):
        s = self.clean({"skills": {"enabled": True}})
        self.assertEqual(lab_settings.what_changed(s), ["skills on"])
        config = {"model": "m", "skills": s["skills"]}
        self.assertEqual(lab_settings.badges(config), ["m", "skills on"])


class Client:
    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []
        self.messages = self

    def create(self, **kwargs):
        self.calls.append({**kwargs, "messages": list(kwargs["messages"])})  # as it was then
        return self.replies.pop(0)


class InTheLabTests(unittest.TestCase):
    def session(self, client, setting):
        path = pathlib.Path(tempfile.mkdtemp()) / "settings.json"
        lab_settings.save({"skills": setting} if setting else {}, loop.SYSTEM, tools.TOOLS, loop.default_permission, path)
        return web_server.Session(client, "Mock", model="m", provider="mock", settings_path=path,
                                  profile_path=pathlib.Path(tempfile.mkdtemp()) / "profile.json")

    def send(self, s, text):
        s.start(text)
        end = time.time() + 5
        while s.running and time.time() < end:
            time.sleep(0.01)

    def test_off_by_default_nothing_changes(self):
        with mock.patch.object(skills, "DIR", folder(EXPENSES)):
            client = Client(NS(stop_reason="end_turn", content=[TextBlock(type="text", text="ok")]))
            self.send(self.session(client, None), "hi")
        self.assertNotIn("load_skill", [t["name"] for t in client.calls[0]["tools"]])
        self.assertNotIn("expenses", client.calls[0]["system"])

    def test_on_demand_the_model_loads_a_skill_with_the_tool(self):
        with mock.patch.object(skills, "DIR", folder(EXPENSES)):
            client = Client(NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id="s1", name="load_skill",
                                                                              input={"name": "expenses"})]),
                            NS(stop_reason="end_turn", content=[TextBlock(type="text", text="filed")]))
            s = self.session(client, {"enabled": True, "mode": "on_demand"})
            self.send(s, "file my taxi")
        self.assertIn("load_skill", [t["name"] for t in client.calls[0]["tools"]])
        self.assertIn("- expenses: Filing an expense", client.calls[0]["system"])
        self.assertNotIn("Alcohol", client.calls[0]["system"])
        result = client.calls[1]["messages"][-1]["content"][0]
        self.assertIn("Alcohol is never reimbursed.", result["content"])
        request = [e for e in s.snapshot(0)["events"] if e["kind"] == "request"][0]
        self.assertEqual(request["config"]["skills"], {"enabled": True, "mode": "on_demand"})

    def test_all_in_the_prompt_sends_the_full_text_and_no_tool(self):
        with mock.patch.object(skills, "DIR", folder(EXPENSES)):
            client = Client(NS(stop_reason="end_turn", content=[TextBlock(type="text", text="ok")]))
            self.send(self.session(client, {"enabled": True, "mode": "all_in_prompt"}), "hi")
        self.assertIn("Alcohol is never reimbursed.", client.calls[0]["system"])
        self.assertNotIn("load_skill", [t["name"] for t in client.calls[0]["tools"]])

    # F271 ruling: what a conversation keeps is what it sent, skills included
    def test_skills_are_kept_with_the_start(self):
        with mock.patch.object(skills, "DIR", folder(EXPENSES)):
            ok = NS(stop_reason="end_turn", content=[TextBlock(type="text", text="ok")])
            client = Client(ok, ok)
            s = self.session(client, {"enabled": True, "mode": "on_demand"})
            lab_settings.save({"apply": "conversation", "skills": {"enabled": True, "mode": "on_demand"}},
                              loop.SYSTEM, tools.TOOLS, loop.default_permission, s.settings_path)
            self.send(s, "first")
            lab_settings.save({"apply": "conversation"}, loop.SYSTEM, tools.TOOLS, loop.default_permission, s.settings_path)
            self.send(s, "second")
        self.assertIn("- expenses:", client.calls[1]["system"])
        self.assertIn("load_skill", [t["name"] for t in client.calls[1]["tools"]])

    def test_the_settings_page_shows_the_skills_and_what_is_added(self):
        import http.client
        import threading
        with mock.patch.object(skills, "DIR", folder(EXPENSES)):
            s = self.session(Client(), {"enabled": True, "mode": "on_demand"})
            server = web_server.make_server(s, 0, None)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=10)
                conn.request("GET", "/settings", headers={"Host": "127.0.0.1"})
                sent = json.loads(conn.getresponse().read())
                conn.close()
            finally:
                server.shutdown()
                server.server_close()
        self.assertEqual(sent["skills"]["found"], [{"name": "expenses", "description": "Filing an expense with submit_expense"}])
        self.assertIn("- expenses: Filing an expense", sent["skills"]["addition"])
        self.assertEqual(sent["skills"]["setting"], {"enabled": True, "mode": "on_demand"})
        self.assertNotIn("load_skill", [t["name"] for t in sent["tools"]])  # not a tool you set a rule for


if __name__ == "__main__":
    unittest.main()
