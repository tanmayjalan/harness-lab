"""The words the server says (error sentences) and the marks the Evals table shows (F361, F349i).

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import json
import pathlib
import tempfile
import threading
import unittest
from types import SimpleNamespace as NS

from anthropic.types import ToolUseBlock

from harness import evals
from harness.core import loop
from harness.web import compare
from test_compare import ScriptedClient, answer, side
import test_web_server


class ServerSentenceTests(unittest.TestCase):
    def setUp(self):
        self.http = test_web_server.HttpTests("call")
        self.http.setUp()
        self.addCleanup(self.http.tearDown)

    def error(self, path, body):
        status, data = self.http.call("POST", path, body)
        return status, json.loads(data)["error"]

    def test_an_empty_message(self):
        self.assertEqual(self.error("/chat", {"text": " "}), (400, "The message is empty."))

    def test_a_message_while_the_harness_is_busy(self):
        gate = threading.Event()
        self.http.session.client.gate = gate
        self.addCleanup(gate.set)
        self.assertEqual(self.http.call("POST", "/chat", {"text": "one"})[0], 202)
        self.assertEqual(self.error("/chat", {"text": "two"}), (
            409, "The harness is still working on the last message. Wait for it, or press Esc to stop it."))

    def test_a_comparison_without_sides(self):
        self.assertEqual(self.error("/compare", {"text": "q", "sides": []}), (
            400, "Send a question and one to three sides, each with a known provider."))

    def test_runs_per_side(self):
        status, message = self.error("/compare", {"text": "q", "sides": [{"provider": "mock"}], "repeat": 9})
        self.assertEqual((status, message), (400, "Runs per side must be 1 to 5."))

    def test_evals_runs_per_question(self):
        self.assertEqual(self.error("/evals", {"provider": "mock", "repeat": 9}), (
            400, "Pick a model from the provider's list and 1 to 5 runs per question."))


def write_call(target):
    return NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id="t1", name="write_file",
                                                            input={"path": str(target), "content": "x"})])


class NotRunMarkTests(unittest.TestCase):
    """F349i: a tool that needed an approval nobody could give shows "(not run)", a tool your settings
    block shows "(blocked)"; the score reads the same flag as before."""

    def run_with(self, permission):
        target = pathlib.Path(tempfile.mkdtemp()) / "out.txt"
        client = ScriptedClient(write_call(target), answer("couldn't"))
        [result] = compare.compare([side("A", client, permission=permission)], "write it", save=False)
        return result["tools"][0]

    def test_ask_first_is_not_run(self):
        t = self.run_with(loop.default_permission)
        self.assertEqual((t["outcome"], t["blocked"], t.get("unattended")), ("unattended", True, True))
        self.assertEqual(evals.tool_mark(t), "write_file (not run)")

    def test_block_is_blocked(self):
        t = self.run_with(lambda name: "block")
        self.assertEqual((t["outcome"], t["blocked"], t.get("unattended")), ("blocked", True, None))
        self.assertEqual(evals.tool_mark(t), "write_file (blocked)")

    def test_the_marks_reach_the_table_and_the_score_is_unchanged(self):
        case = {"question": "q", "tools": ["write_file"], "tool_may_not_work": True}
        for flags, mark in (({"blocked": True, "unattended": True}, "(not run)"), ({"blocked": True}, "(blocked)")):
            run = {"tools": [{"name": "write_file", "input": {}, **flags}], "answer": "no", "seconds": 1,
                   "tokens_read": 0, "tokens_written": 0}
            self.assertEqual(evals.check(case, run), [])  # trying the tool counts, as before
            self.assertEqual(evals.tool_mark(run["tools"][0]), f"write_file {mark}")
        plain = {"question": "q", "tools": ["write_file"]}
        run = {"tools": [{"name": "write_file", "input": {}, "blocked": True, "unattended": True}], "answer": ""}
        self.assertEqual(evals.check(plain, run), ["didn't use: write_file"])  # still not counted as used


class OneReasonTests(unittest.TestCase):
    # F367: the page and the server give the same single reason for skipping trimming
    def test_the_trimming_reason(self):
        from harness.features import context
        self.assertEqual(context.ANTHROPIC_SKIPS_TRIMMING,
                         "Trimming is off with the Anthropic API: it refuses a request whose earlier messages changed, "
                         "and offers its own server-side option instead (context editing).")

    # F351: the file's note points at the section by the name the page uses
    def test_mcp_note_names_the_page(self):
        from harness import paths
        about = json.loads((paths.CONFIG / "mcp_servers.json").read_text(encoding="utf-8"))["about"]
        self.assertIn("Settings → Tools", about)
        self.assertNotIn("Tools tab", about)


if __name__ == "__main__":
    unittest.main()
