"""Tests for running code (core/run_code.py): the model writes a script, the harness runs it, and the output
or the error goes back. These start real Python processes, which is quick.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import http.client
import json
import os
import pathlib
import re
import subprocess
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace as NS
from unittest import mock

from anthropic.types import TextBlock, ToolUseBlock

from harness.core import loop, run_code, tools
from harness.features import lab_settings, subagents
from harness.web import server as web_server


def alive(pid):
    """Is a process with this id still running? (os.kill(pid, 0) would end it on Windows, so ask the system.)"""
    if os.name == "nt":
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
        return re.search(rf"\b{pid}\b", out) is not None
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


class Workspace(unittest.TestCase):
    """Each test gets its own empty workspace (under isolate.py the workspace is the whole temp folder)."""

    def setUp(self):
        self.work = pathlib.Path(tempfile.mkdtemp())
        patcher = mock.patch.object(tools, "WORKSPACE", self.work)
        patcher.start()
        self.addCleanup(patcher.stop)


class RunPythonTests(Workspace):
    def test_a_script_that_works_returns_its_output_and_runs_from_the_workspace(self):
        (self.work / "data.txt").write_text("forty-two", encoding="utf-8")
        out = run_code.run_python(code="print(open('data.txt').read())\nprint('→ done')")
        self.assertTrue(out.startswith("Exit code: 0\n"))
        self.assertIn("Output:\nforty-two\n→ done", out)
        self.assertNotIn("Errors:", out)

    def test_a_failing_script_raises_with_its_traceback(self):
        with self.assertRaises(RuntimeError) as caught:
            run_code.run_python(code="print('before')\nint('12.50')")
        text = str(caught.exception)
        self.assertTrue(text.startswith("Exit code: 1\n"))
        self.assertIn("Output:\nbefore", text)
        self.assertIn("Traceback (most recent call last)", text)
        self.assertIn("ValueError: invalid literal for int() with base 10: '12.50'", text)

    def test_the_loop_gives_the_model_a_failed_run_as_an_error_it_can_fix(self):
        client = NS(messages=NS(create=None))
        replies = [NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id="r1", name="run_python",
                                                                      input={"code": "1/0"})]),
                   NS(stop_reason="end_turn", content=[TextBlock(type="text", text="fixed")])]
        sent = []
        client.messages.create = lambda **kw: (sent.append(kw["messages"][-1]), replies.pop(0))[1]
        loop.agent([{"role": "user", "content": "go"}], client, permission=lambda name: "allow", tools=tools.TOOLS)
        [result] = sent[1]["content"]
        self.assertTrue(result["is_error"])
        self.assertIn("ZeroDivisionError", result["content"])

    def test_the_time_limit_ends_the_script_and_what_it_started(self):
        # Each process writes down its own id: python.exe in a venv is a launcher that starts the real one
        pids = self.work / "pids.txt"
        (self.work / "child.py").write_text(
            f"import os, time\nopen({str(pids)!r}, 'a').write(f'{{os.getpid()}}\\n')\ntime.sleep(60)\n", encoding="utf-8")
        script = ("import os, subprocess, sys, time\n"
                  "subprocess.Popen([sys.executable, 'child.py'])\n"
                  f"open({str(pids)!r}, 'a').write(f'{{os.getpid()}}\\n')\n"
                  "time.sleep(60)\n")
        started = time.time()
        with mock.patch.object(run_code, "TIME_LIMIT", 2), self.assertRaises(RuntimeError) as caught:
            run_code.run_python(code=script)
        self.assertLess(time.time() - started, 15)
        self.assertIn("2-second time limit", str(caught.exception))
        found = [int(p) for p in pids.read_text().split()]
        self.assertEqual(len(found), 2)  # the script and the program it started, each in its own words
        deadline = time.time() + 5
        while any(alive(p) for p in found) and time.time() < deadline:
            time.sleep(0.2)
        self.assertEqual([p for p in found if alive(p)], [])

    def test_stop_ends_the_script_at_once_and_what_it_started(self):
        pids = self.work / "pids.txt"
        script = ("import os, time\n"
                  f"open({str(pids)!r}, 'a').write(f'{{os.getpid()}}\\n')\n"
                  "time.sleep(60)\n")
        started = time.time()
        stop = lambda: pids.exists() and time.time() - started > 0.5  # noqa: E731  (pressed once it's running)
        with self.assertRaises(RuntimeError) as caught:
            run_code.run_python(code=script, should_stop=stop)
        self.assertLess(time.time() - started, 5)  # not the 10-second time limit
        self.assertIn("pressed Stop", str(caught.exception))
        [pid] = [int(p) for p in pids.read_text().split()]
        deadline = time.time() + 5
        while alive(pid) and time.time() < deadline:
            time.sleep(0.2)
        self.assertFalse(alive(pid))

    def test_stop_in_the_chat_ends_a_running_script(self):
        path = pathlib.Path(tempfile.mkdtemp()) / "lab_settings.json"
        lab_settings.save({"run_code": {"enabled": True}, "permissions": {"run_python": "allow"}}, loop.SYSTEM,
                          tools.TOOLS, loop.default_permission, path)
        replies = [NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id="r1", name="run_python",
                                                                      input={"code": "import time\ntime.sleep(60)"})])]
        client = NS(messages=NS(create=lambda **kw: replies.pop(0)))
        s = web_server.Session(client, "test", settings_path=path)
        s.start("go")
        end = time.time() + 5
        while not any(e["kind"] == "tool_call" for e in s.snapshot(0)["events"]) and time.time() < end:
            time.sleep(0.01)
        time.sleep(0.3)
        pressed = time.time()
        self.assertTrue(s.stop())
        while s.running and time.time() < pressed + 15:
            time.sleep(0.01)
        self.assertLess(time.time() - pressed, 5)
        kinds = [e["kind"] for e in s.snapshot(0)["events"]]
        self.assertIn("stopped", kinds)
        [result] = [e for e in s.snapshot(0)["events"] if e["kind"] == "tool_result"]
        self.assertIn("pressed Stop", result["result"]["content"])

    def test_output_is_cut_at_the_limit_and_the_rest_only_counted(self):
        out = run_code.run_python(code="import sys\nsys.stdout.write('x' * 50000)")
        self.assertIn("x" * 10_000 + "\n…cut: 40,000 more characters", out)
        self.assertNotIn("x" * 10_001, out)

    def test_a_script_in_the_workspace_runs_by_its_path(self):
        (self.work / "scripts").mkdir()
        (self.work / "scripts" / "hi.py").write_text("print('hi from a file')", encoding="utf-8")
        self.assertIn("hi from a file", run_code.run_python(path="scripts/hi.py"))
        with self.assertRaises(FileNotFoundError):
            run_code.run_python(path="scripts/missing.py")

    # The approval card won't open a file that isn't a .py script, so you can't see what it says: it must
    # not run either, even when you click Allow
    def test_a_file_that_isnt_a_py_script_never_runs(self):
        marker = self.work / "ran.txt"
        (self.work / "notes.txt").write_text(f"open({str(marker)!r}, 'w').write('ran')", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, r"\.py"):
            run_code.run_python(path="notes.txt")
        block = NS(id="t1", name="run_python", input={"path": "notes.txt"})
        result, outcome = loop._run_one(block, lambda name: "ask", lambda q: "y",
                                        lambda n, a: tools.run_tool(n, a))
        self.assertEqual(outcome, "error")
        self.assertIn(".py", result["content"])
        self.assertFalse(marker.exists())

    # The page runs run_python here directly (so Stop can end it), not through tools.run_tool: the check for a
    # hidden extra part of a file ("notes.txt:s.py", which Rewind can't see) must be here too
    def test_a_hidden_stream_never_runs(self):
        with self.assertRaisesRegex(ValueError, "':'"):
            run_code.run_python(path="notes.txt:s.py")

    def test_a_path_outside_the_workspace_counts_as_outside(self):
        self.assertFalse(tools.outside_workspace("run_python", {"path": "scripts/hi.py"}))
        self.assertTrue(tools.outside_workspace("run_python", {"path": "../elsewhere.py"}))
        self.assertFalse(tools.outside_workspace("run_python", {"code": "print(1)"}))
        rule, outside = loop.effective_rule(lambda name: "allow", "run_python", {"path": "../elsewhere.py"})
        self.assertEqual((rule, outside), ("ask", True))  # allowed, but outside the workspace it asks

    def test_secret_looking_variables_are_left_out(self):
        env = {"MY_API_KEY": "k", "GITHUB_TOKEN": "t", "DB_PASSWORD": "p", "client_secret": "s", "HARMLESS": "ok",
               "SMTP_PASS": "p", "AWS_CREDENTIALS": "c", "PROXY_AUTH": "a", "SITE_COOKIE": "c", "SESSION_ID": "s",
               "Db_Passwd": "p"}
        with mock.patch.dict(os.environ, env):
            wanted = sorted(n.upper() for n in env)  # (Windows keeps variable names in capitals)
            out = run_code.run_python(code=f"import os\nprint(sorted(k for k in os.environ if k.upper() in {wanted!r}))")
        self.assertIn("['HARMLESS']", out)
        kept = run_code.environment()
        for name in ("PATH", "SYSTEMROOT", "TEMP", "PWD", "HOME", "USERPROFILE"):  # what programs need stays
            self.assertFalse(any(w in name for w in run_code.SECRET_WORDS), name)
        self.assertEqual(kept["PYTHONIOENCODING"], "utf-8")

    def test_the_script_the_model_wrote_is_not_left_anywhere(self):
        before = set(pathlib.Path(tempfile.gettempdir()).glob("run_python-*"))
        out = run_code.run_python(code="import pathlib, sys\nprint(pathlib.Path(sys.argv[0]).parent)")
        folder = pathlib.Path(out.split("Output:\n")[1].strip())
        self.assertFalse(folder.is_relative_to(self.work))  # outside the workspace
        self.assertFalse(folder.exists())                   # and removed afterwards
        self.assertEqual(list(self.work.iterdir()), [])
        self.assertEqual(set(pathlib.Path(tempfile.gettempdir()).glob("run_python-*")), before)

    def test_exactly_one_of_code_and_path(self):
        for args in ({}, {"code": "print(1)", "path": "a.py"}):
            with self.subTest(args=args), self.assertRaises(ValueError):
                run_code.run_python(**args)

    def test_the_harness_runs_it_when_the_model_asks(self):
        self.assertIn("Output:\n3", tools.run_tool("run_python", {"code": "print(1 + 2)"}))


class ScriptShownTests(unittest.TestCase):
    """F388: a script run by path is shown before you allow it, as code the model wrote is."""

    def setUp(self):
        self.script = pathlib.Path(tools.WORKSPACE) / "shown_script.py"
        self.script.write_text("print('from the file')\n", encoding="utf-8")
        self.addCleanup(self.script.unlink, missing_ok=True)

    def test_the_file_text_is_read_and_long_ones_cut(self):
        self.assertEqual(run_code.script_text("shown_script.py"), {"text": "print('from the file')\n", "cut": False})
        self.script.write_text("x" * (run_code.SHOW_LIMIT + 5), encoding="utf-8")
        shown = run_code.script_text("shown_script.py")
        self.assertEqual((len(shown["text"]), shown["cut"]), (run_code.SHOW_LIMIT, True))
        self.assertIn("can't be read", run_code.script_text("no_such_script.py")["error"])

    def test_only_a_py_file_inside_the_workspace_is_opened(self):
        # The model can name any file; nothing else is read (or shown and saved) before you decide
        secret = pathlib.Path(tools.WORKSPACE) / "shown.env"
        secret.write_text("API_KEY=real-looking", encoding="utf-8")
        self.addCleanup(secret.unlink, missing_ok=True)
        outside = pathlib.Path(__file__).resolve()  # a real .py file; the test workspace is the temp folder
        self.assertTrue(tools.outside_workspace("run_python", {"path": str(outside)}))
        for path, why in (("shown.env", "isn't a .py script"), (str(outside), "outside the workspace")):
            with self.subTest(path=path):
                shown = run_code.script_text(path)
                self.assertEqual(set(shown), {"error"})
                self.assertIn(why, shown["error"])
                self.assertNotIn("real-looking", loop.ask_text("run_python", {"path": path}))

    def test_a_file_that_changes_while_you_decide_does_not_run(self):
        ran = []

        def confirm(question):  # you are shown the file; meanwhile something rewrites it
            self.script.write_text("print('something else')\n", encoding="utf-8")
            return "y"
        block = NS(id="t1", name="run_python", input={"path": "shown_script.py"})
        result, outcome = loop._run_one(block, lambda name: "ask", confirm, lambda n, a: ran.append(a) or "ran")
        self.assertEqual(outcome, "error")
        self.assertIn("changed after it was shown", result["content"])
        self.assertEqual(ran, [])

    def test_an_unchanged_file_runs_once_allowed(self):
        block = NS(id="t1", name="run_python", input={"path": "shown_script.py"})
        _, outcome = loop._run_one(block, lambda name: "ask", lambda q: "y", lambda n, a: "ran")
        self.assertEqual(outcome, "ran")

    def test_the_terminal_question_shows_the_file(self):
        question = loop.ask_text("run_python", {"path": "shown_script.py"})
        self.assertIn("    print('from the file')", question)
        self.assertIn("could still change", question)
        self.assertIn("(the file can't be read", loop.ask_text("run_python", {"path": "no_such_script.py"}))

    def test_the_page_gets_the_file_with_the_approval(self):
        path = pathlib.Path(tempfile.mkdtemp()) / "lab_settings.json"
        lab_settings.save({"run_code": {"enabled": True}}, loop.SYSTEM, tools.TOOLS, loop.default_permission, path)
        replies = [NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id="r1", name="run_python",
                                                                      input={"path": "shown_script.py"})]),
                   NS(stop_reason="end_turn", content=[TextBlock(type="text", text="Not run.")])]
        client = NS(messages=NS(create=lambda **kw: replies.pop(0)))
        s = web_server.Session(client, "test", settings_path=path)
        s.start("run it")
        end = time.time() + 5
        while not any(e["kind"] == "approval" for e in s.snapshot(0)["events"]) and time.time() < end:
            time.sleep(0.01)
        [approval] = [e for e in s.snapshot(0)["events"] if e["kind"] == "approval"]
        self.assertEqual(approval["script"], {"text": "print('from the file')\n", "cut": False})
        self.assertTrue(s.decide(approval["id"], False))  # decline it, so nothing runs
        while s.running and time.time() < end + 5:
            time.sleep(0.01)


class WiringTests(unittest.TestCase):
    def clean(self, changes):
        return lab_settings.clean(changes, loop.SYSTEM, tools.TOOLS, loop.default_permission)

    def test_it_asks_first_and_shows_the_code(self):
        self.assertEqual(loop.default_permission("run_python"), "ask")
        question = loop.ask_text("run_python", {"code": "print('hello')\nprint('bye')"})
        self.assertIn("    print('hello')\n    print('bye')", question)
        self.assertIn("scripts", loop.ask_text("run_python", {"path": "scripts/totals.py"}))

    def test_it_never_runs_alongside_other_tools(self):
        self.assertIn("run_python", lab_settings.ALONE)
        self.assertFalse(lab_settings.at_once({"tools_at_once": {"enabled": True}})("run_python"))

    def test_the_setting_is_off_by_default(self):
        self.assertEqual(self.clean({"run_code": {"enabled": True}})["run_code"], {"enabled": True})
        self.assertIsNone(self.clean({"run_code": {"enabled": False}})["run_code"])
        self.assertIsNone(self.clean({})["run_code"])
        with self.assertRaises(ValueError):
            self.clean({"run_code": "yes"})
        on = self.clean({"run_code": {"enabled": True}})
        self.assertTrue(lab_settings.run_code(on))
        self.assertFalse(lab_settings.run_code({}))
        self.assertIn("run code on", lab_settings.what_changed(on))
        self.assertIn("run code", lab_settings.badges({"model": "m", "run_code": {"enabled": True}}))

    def test_it_is_offered_only_when_run_code_is_on(self):
        names = lambda settings: [t["name"] for t in lab_settings.offered_tools(settings, tools.TOOLS)]  # noqa: E731
        self.assertIn("run_python", [t["name"] for t in tools.TOOLS])  # always listed (Settings → Tools)
        self.assertNotIn("run_python", names({}))
        self.assertIn("run_python", names({"run_code": {"enabled": True}}))
        self.assertEqual([n for n in names({"run_code": {"enabled": True}}) if n != "run_python"], names({}))
        self.assertNotIn("run_python", subagents.READ_ONLY)  # helpers and the workflow's gathering step never get it

    def test_the_chat_offers_it_only_when_on(self):
        for setting, offered in ((None, False), ({"enabled": True}, True)):
            with self.subTest(run_code=setting):
                path = pathlib.Path(tempfile.mkdtemp()) / "lab_settings.json"
                lab_settings.save({"run_code": setting}, loop.SYSTEM, tools.TOOLS, loop.default_permission, path)
                calls = []
                client = NS(messages=NS(create=lambda **kw: (calls.append(kw), NS(
                    stop_reason="end_turn", content=[TextBlock(type="text", text="ok")]))[1]))
                s = web_server.Session(client, "test", settings_path=path)
                s.start("hi")
                end = time.time() + 5
                while s.running and time.time() < end:
                    time.sleep(0.01)
                self.assertEqual("run_python" in [t["name"] for t in calls[0]["tools"]], offered)
                request = next(e for e in s.snapshot(0)["events"] if e["kind"] == "request")
                self.assertEqual("run_python" in [t["name"] for t in request["tools"]], offered)
                self.assertEqual(request["config"]["run_code"], setting)


MAKE_FILE = {"code": "open('made.txt', 'w').write('ran')"}


class OffMeansOffTests(Workspace):
    """With Run code off, run_python never runs, even when your rule for it is Allow and the model asks for it
    anyway (a name it saw earlier, or one a file told it to call): the loop refuses a tool it didn't offer."""

    def setUp(self):
        super().setUp()
        self.path = pathlib.Path(tempfile.mkdtemp()) / "lab_settings.json"

    def settings(self, **changes):
        lab_settings.save({"permissions": {"run_python": "allow"}, **changes}, loop.SYSTEM, tools.TOOLS,
                          loop.default_permission, self.path)

    def session(self, *replies):
        replies = list(replies)
        self.sent = []
        client = NS(messages=NS(create=lambda **kw: (self.sent.append(kw), replies.pop(0))[1]))
        return web_server.Session(client, "test", settings_path=self.path)

    def send(self, s, text="go"):
        s.start(text)
        end = time.time() + 10
        while s.running and time.time() < end:
            time.sleep(0.01)
        return [e for e in s.snapshot(0)["events"] if e["kind"] == "tool_result"]

    def run_python_call(self, id="r1"):
        return NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id=id, name="run_python", input=MAKE_FILE)])

    def answer(self, text="ok"):
        return NS(stop_reason="end_turn", content=[TextBlock(type="text", text=text)])

    def test_with_it_on_and_allowed_it_runs(self):  # (so the tests below show the switch, not a broken script)
        self.settings(run_code={"enabled": True})
        [result] = self.send(self.session(self.run_python_call(), self.answer()))
        self.assertEqual(result["outcome"], "ran")
        self.assertTrue((self.work / "made.txt").exists())

    def test_in_the_chat_it_is_not_run(self):
        self.settings()
        [result] = self.send(self.session(self.run_python_call(), self.answer()))
        self.assertEqual(result["outcome"], "not_run")
        self.assertTrue(result["result"]["is_error"])
        self.assertIn("run_python wasn't offered to you", result["result"]["content"])
        self.assertFalse((self.work / "made.txt").exists())

    def test_in_the_workflow_s_gathering_step_it_is_not_run(self):
        self.settings(workflow={"enabled": True})
        s = self.session(self.run_python_call(), self.answer("notes"), self.answer("draft"), self.answer("PASS"))
        [result] = self.send(s)
        self.assertEqual(result["outcome"], "not_run")
        self.assertFalse((self.work / "made.txt").exists())
        self.assertEqual(s.messages[-1]["content"], "draft")  # the chain went on to the answer

    def test_turned_off_mid_conversation_it_leaves_even_a_kept_start(self):
        self.settings(run_code={"enabled": True}, apply="conversation")
        s = self.session(self.answer(), self.run_python_call(), self.answer())
        self.send(s, "hello")
        self.assertIn("run_python", [t["name"] for t in self.sent[0]["tools"]])  # kept in the start
        self.settings(apply="conversation")  # Run code off
        [result] = self.send(s)
        self.assertNotIn("run_python", [t["name"] for t in self.sent[1]["tools"]])
        self.assertEqual(result["outcome"], "not_run")
        self.assertFalse((self.work / "made.txt").exists())


class SettingsHttpTests(unittest.TestCase):
    def setUp(self):
        self.path = pathlib.Path(tempfile.mkdtemp()) / "lab_settings.json"
        self.session = web_server.Session(NS(messages=None), "test", settings_path=self.path)
        self.server = web_server.make_server(self.session, 0)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def call(self, path, body=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        conn.request("POST" if body is not None else "GET", path, body=json.dumps(body) if body is not None else None,
                     headers={"Host": "127.0.0.1", "Content-Type": "application/json"})
        r = conn.getresponse()
        data = json.loads(r.read())
        conn.close()
        return data

    def rule(self, data):
        return next(t for t in data["tools"] if t["name"] == "run_python")["permission"]

    def test_settings_list_it_with_the_switch_off(self):
        data = self.call("/settings")
        self.assertEqual(data["run_code"], {"enabled": False})
        row = next(t for t in data["tools"] if t["name"] == "run_python")
        self.assertEqual((row["permission"], row["default_permission"]), ("ask", "ask"))

    def test_your_rule_for_it_survives_turning_it_off_and_on(self):
        self.call("/settings", {"run_code": {"enabled": True}, "permissions": {"run_python": "allow"}})
        self.call("/settings", {"run_code": {"enabled": False}})
        data = self.call("/settings", {"permissions": {"roll_dice": "block"}})  # another setting, saved while off
        self.assertEqual(self.rule(data), "allow")
        data = self.call("/settings", {"run_code": {"enabled": True}})
        self.assertEqual((data["run_code"], self.rule(data)), ({"enabled": True}, "allow"))


if __name__ == "__main__":
    unittest.main()
