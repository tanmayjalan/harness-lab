"""Offline tests for evals.py's scoring (no model calls).

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import json
import pathlib
import unittest
import unittest.mock

from harness.core import loop, tools
from harness import evals, paths


def result(tools=(), answer="", **extra):
    return {"tools": [{"name": t, "input": {}} for t in tools], "answer": answer, **extra}


class CheckTests(unittest.TestCase):
    def test_pass_needs_the_tools_and_the_answer(self):
        case = {"tools": ["calculate"], "answer_has": ["416.5"]}
        self.assertEqual(evals.check(case, result(["calculate"], "It's 416.5")), [])
        self.assertEqual(evals.check(case, result([], "It's 416.5")), ["didn't use: calculate"])
        self.assertEqual(evals.check(case, result(["calculate"], "about 400")),
                         ["answer doesn't mention '416.5'"])

    def test_any_listed_answer_counts_and_case_is_ignored(self):
        case = {"tools": [], "answer_has": ["87.8", "88"]}
        self.assertEqual(evals.check(case, result([], "roughly 88 °F")), [])
        self.assertEqual(evals.check({"tools": [], "answer_has": ["Paris"]}, result([], "paris")), [])

    def test_empty_tool_list_means_no_tools(self):
        problems = evals.check({"tools": []}, result(["list_files"], "Paris"))
        self.assertEqual(problems, ["used tools it didn't need: list_files"])

    def test_a_blocked_tool_call_does_not_count_as_used(self):
        blocked = {"tools": [{"name": "calculate", "input": {}, "blocked": True}], "answer": "416.5"}
        self.assertEqual(evals.check({"tools": ["calculate"]}, blocked), ["didn't use: calculate"])

    def test_repeated_runs_report_a_pass_rate(self):
        import contextlib
        import io
        case = {"question": "q", "tools": ["calculate"]}
        runs = [result(["calculate"]), result([]), result(["calculate"]), result(["calculate"]), result(["calculate"]),
                result(["calculate"])]
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            passed = evals.report("mock", [case, case], runs, repeat=3)
        self.assertEqual(passed, 5)
        self.assertIn("MIXED 2/3", out.getvalue())
        self.assertIn("PASS  3/3", out.getvalue())
        self.assertIn("Pass rate: 5 of 6 runs (83%)", out.getvalue())  # F293: the page's words
        self.assertIn("didn't use: calculate (run 2)", out.getvalue())  # which run had the problem

    def test_a_tool_that_only_failed_does_not_count(self):
        case = {"tools": ["roll_dice"]}
        failed = {"name": "roll_dice", "input": {}, "failed": True}
        self.assertEqual(evals.check(case, {"tools": [failed, failed], "answer": "7"}),
                         ["roll_dice failed every time it ran"])
        self.assertEqual(evals.check(case, {"tools": [failed, {"name": "roll_dice", "input": {}}], "answer": "7"}), [])

    def test_where_failing_is_the_point_trying_the_tool_counts(self):
        case = {"tools": ["read_file"], "tool_may_not_work": True}
        failed = {"name": "read_file", "input": {}, "failed": True}
        refused = {"name": "read_file", "input": {}, "blocked": True}
        self.assertEqual(evals.check(case, {"tools": [failed], "answer": "It doesn't exist."}), [])
        self.assertEqual(evals.check(case, {"tools": [refused], "answer": "I wasn't allowed."}), [])
        self.assertEqual(evals.check(case, {"tools": [], "answer": "It says hello."}), ["didn't use: read_file"])

    def test_the_real_cases_can_pass(self):
        """Every question in config/evals.json has some result that passes it (no case is a FAIL by design)."""
        cases = json.loads((paths.CONFIG / "evals.json").read_text(encoding="utf-8"))["cases"]
        for case in cases:
            with self.subTest(case=case["question"]):
                outcome = {"failed": True} if case.get("tool_may_not_work") else {}
                tools_used = [{"name": t, "input": {}, **outcome} for t in case["tools"]]
                answer = " ".join(case.get("answer_has") or ["ok"])
                self.assertEqual(evals.check(case, {"tools": tools_used, "answer": answer}), [])

    def test_errors_fail(self):
        self.assertEqual(evals.check({"tools": []}, result(error="APIError: down")), ["APIError: down"])

    # F234: a reply that is neither PASS nor FAIL means the run couldn't be judged (None), not that it failed
    # F243: the reason is everything after the verdict word, hyphens and all
    def test_judge_reads_pass_fail_and_anything_else_is_not_judged(self):
        from types import SimpleNamespace as NS
        from unittest import mock
        from anthropic.types import TextBlock

        case = {"question": "q", "judge": "be good"}
        for said, expect in [("PASS - meets the criteria", (True, "meets the criteria")),
                             ("**FAIL** - wrong number", (False, "wrong number")),
                             ("FAIL: says twenty-two degrees", (False, "says twenty-two degrees")),
                             ("PASS — gives °F as asked", (True, "gives °F as asked")),
                             ("Passable, I suppose", (None, "the judge's reply wasn't PASS or FAIL: 'Passable, I suppose'")),
                             ("I think it's fine", (None, "the judge's reply wasn't PASS or FAIL: \"I think it's fine\"")),
                             ("", (None, "the judge's reply wasn't PASS or FAIL: ''"))]:
            with self.subTest(said=said):
                client = NS(messages=NS(create=lambda **kw: NS(content=[TextBlock(type="text", text=said)])))
                with mock.patch.object(evals, "client_for", return_value=client):
                    self.assertEqual(evals.judge(case, {"answer": "a"}, "mock"), expect)

    def test_every_case_names_real_tools(self):
        names = {t["name"] for t in tools.TOOLS}
        cases = json.loads((paths.CONFIG / "evals.json").read_text(encoding="utf-8"))["cases"]
        for case in cases:
            with self.subTest(case=case["question"]):
                self.assertTrue(set(case["tools"]) <= names)



class Answers:
    """A fake provider: every call answers with the next text in turn (and never asks for tools)."""

    def __init__(self, *texts, delay=0):
        from types import SimpleNamespace as NS
        from anthropic.types import TextBlock
        import itertools
        import time as _time
        self.messages = self
        self._next = itertools.cycle(texts)
        self._reply = lambda t: NS(stop_reason="end_turn", content=[TextBlock(type="text", text=t)])
        self._sleep = lambda: _time.sleep(delay)

    def create(self, **kw):
        self._sleep()
        return self._reply(next(self._next))


class Clients:
    def __init__(self, client):
        self.client = client

    def get(self, name):
        return self.client


class SuiteTests(unittest.TestCase):
    def test_pass_rates_per_question_and_saved_history(self):
        cases = [{"question": "What is 2+2?", "tools": [], "answer_has": ["4"]}]
        seen = []
        result = evals.run_suite("mock", cases, repeat=3, clients=Clients(Answers("It's 4.", "It's 5.", "4")),
                                 on_progress=lambda done, total: seen.append((done, total)))
        [row] = result["cases"]
        self.assertEqual((row["passed"], row["runs"], row["verdict"]), (2, 3, "MIXED"))
        self.assertEqual((result["passed"], result["total"]), (2, 3))
        self.assertEqual(seen[-1], (3, 3))
        run_id = evals.save_result(result)
        self.assertEqual([r["id"] for r in evals.history()][-1], run_id)
        self.assertEqual(evals.load_result(run_id)["cases"][0]["verdict"], "MIXED")
        with self.assertRaises(ValueError):
            evals.load_result("../x")


class SuiteDetailTests(unittest.TestCase):
    # F233: each run keeps its own problems and the judge's verdict, so a MIXED row can say which run failed
    def test_each_run_keeps_its_own_verdict(self):
        cases = [{"question": "What is 2+2?", "tools": [], "answer_has": ["4"], "judge": "Says 4."}]
        says = {"It's 4.": (True, "says 4"), "It's 5.": (False, "says 5")}
        with unittest.mock.patch.object(evals, "judge", lambda case, result, *a, **k: says[result["answer"]]):
            result = evals.run_suite("mock", cases, repeat=3, judge_with="mock",
                                     clients=Clients(Answers("It's 4.", "It's 5.", "It's 4.")))
        [row] = result["cases"]
        # runs happen three at a time, so check each run against its own answer
        for answer, problems, verdict in zip(row["answers"], row["run_problems"], row["judge_verdicts"]):
            wrong = answer == "It's 5."
            self.assertEqual(problems, ["answer doesn't mention '4'", "judge: says 5"] if wrong else [])
            self.assertEqual(verdict, "FAIL" if wrong else "PASS")
        self.assertEqual((row["passed"], row["runs"], row["verdict"]), (2, 3, "MIXED"))

    # F234: when the judge itself fails, the run is left out of the counts instead of failing the model
    def test_a_run_the_judge_could_not_grade_is_left_out(self):
        cases = [{"question": "Say hi", "tools": [], "judge": "Says hello."}]
        says = {"hello": (True, "fine"), "hi": (None, "the judge couldn't grade this: APIConnectionError: down")}
        with unittest.mock.patch.object(evals, "judge", lambda case, result, *a, **k: says[result["answer"]]):
            result = evals.run_suite("mock", cases, repeat=3, judge_with="mock", clients=Clients(Answers("hello", "hi", "hello")))
        [row] = result["cases"]
        self.assertEqual((row["passed"], row["runs"], row["ran"], row["unjudged"], row["verdict"]), (2, 2, 3, 1, "PASS"))
        self.assertEqual((result["passed"], result["total"], result["unjudged"]), (2, 2, 1))
        self.assertEqual(sorted(row["judge_verdicts"]), ["PASS", "PASS", "UNJUDGED"])

    # F240: an error is kept apart from the answers, in plain words
    def test_an_error_is_not_listed_as_the_answer(self):
        class Fails:
            messages = None

            def __init__(self):
                self.messages = self

            def create(self, **kw):
                raise RuntimeError("Stopped: hit max_turns (20)")

        cases = [{"question": "Roll until 6", "tools": ["roll_dice"]}]
        result = evals.run_suite("mock", cases, clients=Clients(Fails()))
        [row] = result["cases"]
        self.assertEqual(row["answers"], [None])
        self.assertEqual(row["errors"], ["Stopped after 20 model calls: the most allowed for one message."])

    # F050: a row says what was checked, for a PASS as well as a FAIL
    def test_each_question_says_what_was_checked(self):
        cases = [{"question": "What is 2+2?", "tools": ["calculate"], "answer_has": ["4"]},
                 {"question": "Say hi", "tools": [], "judge": "Says hello."}]
        result = evals.run_suite("mock", cases, clients=Clients(Answers("4")))
        first, second = result["cases"]
        self.assertEqual(first["checked"], ["uses calculate", "answer mentions '4'"])
        # F244: with the judge off, the criteria weren't used, and the row says so
        self.assertEqual(second["checked"], ["uses no tools", "judged when the judge is on: Says hello."])
        with unittest.mock.patch.object(evals, "judge", lambda *a, **k: (True, "fine")):
            judged = evals.run_suite("mock", cases[1:], judge_with="mock", clients=Clients(Answers("hello")))
        self.assertEqual(judged["cases"][0]["checked"], ["uses no tools", "judged against: Says hello."])

    # F234: the chart's history keeps how many runs the judge couldn't grade
    def test_history_keeps_the_runs_that_could_not_be_judged(self):
        cases = [{"question": "Say hi", "tools": [], "judge": "Says hello."}]
        says = {"hello": (True, "fine"), "hi": (None, "the judge couldn't grade this")}
        with unittest.mock.patch.object(evals, "judge", lambda case, result, *a, **k: says[result["answer"]]):
            result = evals.run_suite("mock", cases, repeat=2, judge_with="mock", clients=Clients(Answers("hello", "hi")))
        run_id = evals.save_result(result)
        [point] = [r for r in evals.history() if r["id"] == run_id]
        self.assertEqual(point["unjudged"], 1)

    # F149: each run is kept as a conversation, tagged "eval", so a row can be opened
    def test_each_run_is_saved_as_a_conversation(self):
        from harness.web import conversations
        cases = [{"question": "What is 2+2?", "tools": [], "answer_has": ["4"]}]
        result = evals.run_suite("mock", cases, repeat=2, clients=Clients(Answers("4")))
        ids = result["cases"][0]["conversations"]
        self.assertEqual(len(ids), 2)
        saved = conversations.load(ids[0])
        self.assertEqual(saved["kind"], "eval")
        self.assertTrue(saved["title"].startswith("Eval · What is 2+2?"))

    # F349h: an eval conversation knows where it came from
    def test_an_eval_conversation_carries_its_round_question_and_attempt(self):
        from harness.web import conversations
        cases = [{"question": "What is 2+2?", "tools": [], "answer_has": ["4"]}]
        result = evals.run_suite("mock", cases, repeat=2, clients=Clients(Answers("4")), run_id="20261007-101010-001")
        ids = result["cases"][0]["conversations"]
        origins = sorted((conversations.load(i)["origin"] for i in ids), key=lambda o: o["attempt"])
        self.assertEqual(origins, [{"kind": "eval", "round": "20261007-101010-001", "question": "What is 2+2?", "attempt": n}
                                   for n in (1, 2)])

    # F048: Stop ends the run; what finished is kept, marked incomplete
    def test_a_stopped_run_keeps_what_finished(self):
        import threading
        stop = threading.Event()
        cases = [{"question": f"Q{i}", "tools": [], "answer_has": ["4"]} for i in range(6)]

        def progress(done, total):
            if done >= 1:
                stop.set()

        result = evals.run_suite("mock", cases, clients=Clients(Answers("4", delay=0.05)), on_progress=progress, cancel=stop)
        self.assertTrue(result["incomplete"])
        self.assertLess(result["total"], 6)
        self.assertEqual(result["total"], sum(r["runs"] for r in result["cases"]))

    # F150: the filter used is part of the result
    def test_the_filter_is_recorded(self):
        cases = [{"question": "What is 2+2?", "tools": [], "answer_has": ["4"]}]
        result = evals.run_suite("mock", cases, clients=Clients(Answers("4")), only="2+2")
        self.assertEqual(result["only"], "2+2")
        run_id = evals.save_result(result)
        self.assertEqual(next(r for r in evals.history() if r["id"] == run_id)["only"], "2+2")


class EvalRetentionTests(unittest.TestCase):
    # Deferred M7: only the last 10 runs keep their conversations; the score history stays whole
    def test_only_the_last_ten_runs_keep_their_conversations(self):
        import pathlib
        import tempfile
        from harness.web import conversations
        saved_history = evals.HISTORY
        evals.HISTORY = pathlib.Path(tempfile.mkdtemp()) / "evals"
        self.addCleanup(setattr, evals, "HISTORY", saved_history)
        ids = []
        for i in range(12):
            cid = conversations.new_id()
            conversations.save(cid, f"Eval · run {i}", [], [], kind="eval")
            ids.append(cid)
            result = {"cases": [{"question": "q", "conversations": [cid]}], "passed": 1, "total": 1}
            evals.save_result(result, when=1_790_000_000 + i * 60)
        self.assertEqual(len(evals.history()), 12)
        for cid in ids[:2]:
            with self.assertRaises(FileNotFoundError):
                conversations.load(cid)
        for cid in ids[2:]:
            self.assertEqual(conversations.load(cid)["kind"], "eval")
        oldest = evals.load_result(evals.history()[0]["id"])
        self.assertEqual(oldest["cases"][0]["conversations"], [])  # no Inspect link to nothing


class EvalsHttpTests(unittest.TestCase):
    def start(self, client):
        import threading
        from harness.web import server as web_server
        session = web_server.Session(Answers("x"), "test", provider="mock")
        self.server = web_server.make_server(session, 0, Clients(client))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def call(self, method, path, body=None):
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=10)
        conn.request(method, path, body=json.dumps(body) if body is not None else None,
                     headers={"Host": "127.0.0.1", "Content-Type": "application/json"})
        r = conn.getresponse()
        data = json.loads(r.read())
        conn.close()
        return r.status, data

    def test_run_in_the_background_then_read_the_result(self):
        import time
        self.start(Answers("4", delay=0.05))
        status, data = self.call("POST", "/evals", {"provider": "mock", "repeat": 1, "only": "Roll two", "judge": False})
        self.assertEqual(status, 202, data)
        self.assertEqual(self.call("POST", "/evals", {"provider": "mock", "only": "Roll two"})[0], 409)  # one at a time
        end = time.time() + 10
        while self.call("GET", "/evals/status")[1]["running"] and time.time() < end:
            time.sleep(0.05)
        status = self.call("GET", "/evals/status")[1]
        self.assertEqual(status["done"], status["total"])
        self.assertIn("cases", status["result"])
        runs = self.call("GET", "/evals/history")[1]["runs"]
        self.assertEqual(runs[-1]["id"], status["result"]["id"])
        self.assertEqual(self.call("GET", f"/evals/get?id={runs[-1]['id']}")[0], 200)
        self.assertEqual(self.call("GET", "/evals/get?id=../nope")[0], 404)

    def test_the_questions_can_be_listed(self):
        # F044
        self.start(Answers("x"))
        status, data = self.call("GET", "/evals/cases")
        self.assertEqual(status, 200)
        self.assertEqual(len(data["cases"]), len(evals.cases_from_config()))
        self.assertIn("question", data["cases"][0])
        self.assertEqual(self.call("GET", "/evals/cases?only=Roll%20two")[1]["cases"][0]["question"][:8], "Roll two")

    def test_stop_needs_a_running_suite(self):
        # F048
        self.start(Answers("x"))
        self.assertEqual(self.call("POST", "/evals/stop", {})[0], 409)

    def test_bad_requests_are_refused(self):
        self.start(Answers("x"))
        self.assertEqual(self.call("POST", "/evals", {"provider": "nope"})[0], 400)
        self.assertEqual(self.call("POST", "/evals", {"provider": "mock", "repeat": 9})[0], 400)
        self.assertEqual(self.call("POST", "/evals", {"provider": "mock", "only": "zebra"})[0], 400)


if __name__ == "__main__":
    unittest.main()


class ReportTests(unittest.TestCase):
    # F293: the terminal report uses the page's words and rounding
    def test_pass_rate_reads_like_the_page(self):
        self.assertEqual(evals.pass_rate(2, 3), "Pass rate: 2 of 3 runs (67%)")
        self.assertEqual(evals.pass_rate(1, 1), "Pass rate: 1 of 1 run (100%)")
        self.assertEqual(evals.pass_rate(0, 0), "Pass rate: 0 of 0 runs (0%)")

    # F293: halves round up, as the page's Math.round does (Python's round() would give 62% and 12%)
    def test_halves_round_up_like_the_page(self):
        self.assertEqual(evals.pass_rate(10, 16), "Pass rate: 10 of 16 runs (63%)")
        self.assertEqual(evals.pass_rate(2, 16), "Pass rate: 2 of 16 runs (13%)")

    def printed(self, *args, **kw):
        import contextlib
        import io
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            evals.report(*args, **kw)
        return out.getvalue()

    # F293: one run per question marks blocked and failed tools, and names repeated calls the page's way
    def test_a_single_run_marks_blocked_and_failed_tools(self):
        case = {"question": "q", "tools": ["read_file"]}
        run = {"tools": [{"name": "read_file", "input": {}, "blocked": True},
                         {"name": "roll_dice", "input": {}}, {"name": "roll_dice", "input": {}}],
               "answer": "", "seconds": 1, "tokens_read": 0, "tokens_written": 0}
        out = self.printed("mock", [case], [run])
        self.assertIn("[read_file (blocked) → roll_dice ×2]", out)

    # F293: the repeat report lists each tool path with how many runs took it, marks included
    def test_repeated_runs_list_their_tool_paths(self):
        case = {"question": "q", "tools": ["calculate"]}
        failed = {"name": "calculate", "input": {}, "failed": True}
        runs = [result(["calculate"]), result(["calculate"]), {"tools": [failed], "answer": ""}]
        out = self.printed("mock", [case], runs, repeat=3)
        self.assertIn("tools: calculate · in 2 runs", out)
        self.assertIn("tools: calculate (failed) · in 1 run", out)

    # F293: the MIXED note only when something is MIXED
    def test_the_mixed_note_only_when_something_is_mixed(self):
        case = {"question": "q", "tools": ["calculate"]}
        same = self.printed("mock", [case], [result(["calculate"])] * 2, repeat=2)
        self.assertNotIn("MIXED", same)
        mixed = self.printed("mock", [case], [result(["calculate"]), result([])], repeat=2)
        self.assertIn("MIXED: the same question passed some runs and failed others.", mixed)

    def run_main(self, *argv):
        import contextlib
        import io
        import sys
        out = io.StringIO()
        with unittest.mock.patch.object(sys, "argv", ["evals", *argv]), \
                unittest.mock.patch.object(evals, "run", lambda provider, cases, *a, **k: [result() for _ in cases]), \
                unittest.mock.patch.object(evals, "report", lambda *a, **k: 0), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            try:
                evals.main()
                code = 0
            except SystemExit as e:
                code = e.code
        return code, out.getvalue()

    # F293: --only that matches nothing stops with a message instead of running nothing
    def test_only_with_no_match_stops(self):
        code, out = self.run_main("--provider", "mock", "--only", "zebra-no-such-question")
        self.assertEqual(code, 1)
        self.assertIn("No question contains 'zebra-no-such-question'.", out)

    # F293: "1 question", not "1 questions"
    def test_one_question_is_singular(self):
        cases = json.loads((paths.CONFIG / "evals.json").read_text(encoding="utf-8"))["cases"]
        word = cases[0]["question"]
        only = [c for c in cases if word.lower() in c["question"].lower()]
        self.assertEqual(len(only), 1)
        _, out = self.run_main("--provider", "mock", "--only", word, "--judge", "none")
        self.assertIn("1 question;", out)

    # F242: the warning goes by the model being tested, as on the page, whatever the provider
    def test_the_judge_warning_goes_by_model(self):
        judge_model = evals.providers.PROVIDERS["mock"]["model"]
        self.assertTrue(evals.judge_is_tested("mock", "mock", None))
        self.assertTrue(evals.judge_is_tested("mock", "anthropic", judge_model))
        self.assertFalse(evals.judge_is_tested("mock", "mock", "claude-haiku-4-5-20251001"))
        self.assertFalse(evals.judge_is_tested(None, "mock", None))
        if evals.providers.PROVIDERS["anthropic"]["model"] == judge_model:
            cases = json.loads((paths.CONFIG / "evals.json").read_text(encoding="utf-8"))["cases"]
            _, out = self.run_main("--provider", "anthropic", "--only", cases[0]["question"], "--judge", "mock")
            self.assertIn("the judge is the same model as the one being tested", out)

