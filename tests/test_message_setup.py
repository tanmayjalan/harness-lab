"""Offline tests for message_setup.py: what one message is sent with, built from your settings (the page,
the terminal and Compare all build it there), and the server's check of a provider and model.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import unittest

from harness.core import loop, tools
from harness.features import lab_settings, message_setup
from harness.web import server as web_server


def settings(**changes):
    return lab_settings.clean(changes, loop.SYSTEM, tools.TOOLS, loop.default_permission)


def names(tool_list):
    return [t["name"] for t in tool_list]


class BuildTests(unittest.TestCase):
    def test_the_defaults(self):
        s = message_setup.build(settings(), "mock", tools.TOOLS)
        self.assertEqual(s["system"], loop.SYSTEM)
        self.assertNotIn("run_python", names(s["tools"]))  # only with Run code on
        self.assertEqual((s["thinking"], s["cache"], s["busy"], s["at_once"], s["workflow"], s["extra_tools"]),
                         (None, False, False, None, False, None))
        self.assertEqual((s["max_tokens"], s["max_turns"], s["facts_shared"]), (16000, 20, 0))
        self.assertEqual(s["permission"]("write_file"), "ask")

    def test_your_settings_and_facts_reach_the_setup(self):
        facts = [{"label": "name", "value": "Sam", "share": True}]
        s = message_setup.build(settings(system="Be brief.", run_code={"enabled": True}, cache={"enabled": True},
                                         limits={"max_tokens": 3000, "max_turns": 5},
                                         permissions={"roll_dice": "block"}), "mock", tools.TOOLS, facts)
        self.assertTrue(s["system"].startswith("Be brief."))
        self.assertIn("Sam", s["system"])
        self.assertEqual(s["facts_shared"], 1)
        self.assertIn("run_python", names(s["tools"]))
        self.assertEqual((s["cache"], s["max_tokens"], s["max_turns"]), (True, 3000, 5))
        self.assertEqual(s["permission"]("roll_dice"), "block")

    def test_tools_from_mcp_never_run_alongside_others(self):
        s = message_setup.build(settings(tools_at_once={"enabled": True}), "mock", tools.TOOLS,
                                is_mcp=lambda name: name == "shout")
        self.assertTrue(s["at_once"]("roll_dice"))
        self.assertFalse(s["at_once"]("shout"))
        self.assertFalse(s["at_once"]("write_file"))  # (it writes)

    def test_only_anthropic_gets_strict(self):
        strict = [t for t in tools.TOOLS if t.get("strict")]
        self.assertTrue(strict, "no tool uses strict")
        name = strict[0]["name"]
        for provider, kept in (("anthropic", True), ("deepseek", False)):
            with self.subTest(provider=provider):
                s = message_setup.build(settings(), provider, tools.TOOLS)
                [sent] = [t for t in s["tools"] if t["name"] == name]
                self.assertEqual("strict" in sent, kept)
                [described] = [t for t in s["described"] if t["name"] == name]
                self.assertIn("strict", described)

    def test_a_kept_start_is_sent_but_run_python_leaves_it_once_run_code_is_off(self):
        first = message_setup.build(settings(system="Prompt A.", run_code={"enabled": True}), "mock", tools.TOOLS)
        kept = {"system": first["system"], "tools": first["described"]}
        for run_code, offered in ((True, True), (False, False)):
            with self.subTest(run_code=run_code):
                now = settings(system="Prompt B.", run_code={"enabled": run_code})
                s = message_setup.build(now, "mock", tools.TOOLS)
                message_setup.use_kept_start(s, kept, now)
                self.assertTrue(s["system"].startswith("Prompt A."))
                self.assertEqual("run_python" in names(s["tools"]), offered)

    def test_loop_args_are_the_ones_loop_agent_takes(self):
        s = message_setup.build(settings(), "mock", tools.TOOLS, use_hooks=False)
        args = message_setup.loop_args(s)
        self.assertIsNone(args["hooks"])
        self.assertLessEqual(set(args), set(loop.agent.__code__.co_varnames))


class ChoiceProblemTests(unittest.TestCase):
    def test_a_known_provider_and_model_have_no_problem(self):
        self.assertIsNone(web_server.choice_problem("mock", None))

    def test_an_unknown_provider_or_model_is_said(self):
        self.assertEqual(web_server.choice_problem("nope", None), "unknown provider 'nope'")
        self.assertIn("has no model 'nope'", web_server.choice_problem("mock", "nope"))


if __name__ == "__main__":
    unittest.main()
