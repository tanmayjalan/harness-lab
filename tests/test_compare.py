"""Offline tests for compare.py: the same question to two providers at once.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import pathlib
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace as NS
from unittest import mock

from anthropic.types import TextBlock, ToolUseBlock

from harness.web import compare
from harness.core import loop, tools


class ScriptedClient:
    def __init__(self, *replies, delay=0):
        self.replies = list(replies)
        self.delay = delay
        self.systems = []
        self.busy = []  # (start, end) of each call, to see whether two sides overlapped
        self.messages = self

    def create(self, **kwargs):
        self.systems.append(kwargs["system"])
        start = time.monotonic()
        time.sleep(self.delay)
        self.busy.append((start, time.monotonic()))
        return self.replies.pop(0)


def answer(text, usage=None):
    r = NS(stop_reason="end_turn", content=[TextBlock(type="text", text=text)])
    if usage:
        r.usage = NS(model_dump=lambda **kw: usage)
    return r


def side(label, client, **extra):
    return {"label": label, "model": f"{label}-model", "client": client, "system": "SYS",
            "tools": tools.TOOLS, "permission": loop.default_permission, **extra}


class CompareTests(unittest.TestCase):
    def test_both_sides_run_at_the_same_time(self):
        a = ScriptedClient(answer("from A"), delay=0.5)
        b = ScriptedClient(answer("from B", {"input_tokens": 100, "output_tokens": 10}), delay=0.5)
        results = compare.compare([side("A", a), side("B", b, cost=lambda u: 0.01)], "hi")
        # In parallel: each side's call was still running when the other's began. (Not a stopwatch: a slow CI
        # machine can take seconds to start the threads, which says nothing about whether they overlapped.)
        [(a_start, a_end)], [(b_start, b_end)] = a.busy, b.busy
        self.assertTrue(a_start < b_end and b_start < a_end, (a.busy, b.busy))
        self.assertEqual([r["answer"] for r in results], ["from A", "from B"])
        self.assertEqual((results[1]["tokens_read"], results[1]["tokens_written"], results[1]["cost"]), (100, 10, 0.01))
        self.assertIsNone(results[0]["cost"])

    def test_writes_are_blocked(self):
        target = pathlib.Path(tempfile.mkdtemp()) / "out.txt"
        client = ScriptedClient(
            NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id="t1", name="write_file",
                                                            input={"path": str(target), "content": "x"})]),
            answer("couldn't write"))
        [result] = compare.compare([side("A", client)], "write it")
        self.assertFalse(target.exists())
        self.assertEqual([t["name"] for t in result["tools"]], ["write_file"])

    def test_one_side_failing_does_not_stop_the_other(self):
        class Broken:
            messages = NS(create=lambda **kw: (_ for _ in ()).throw(RuntimeError("down")))
        results = compare.compare([side("A", Broken()), side("B", ScriptedClient(answer("fine")))], "hi")
        self.assertIn("down", results[0]["error"])
        self.assertEqual(results[1]["answer"], "fine")


class CompareHttpTests(unittest.TestCase):
    def test_profile_only_when_asked(self):
        import http.client
        import json
        from harness.features import memory
        from harness.web import server as web_server

        profile = pathlib.Path(tempfile.mkdtemp()) / "profile.json"
        memory.save([{"label": "Name", "value": "Asha", "share": True}], profile)
        made = {}

        class Clients:
            def get(self, name):
                made[name] = ScriptedClient(answer(f"from {name}"))
                return made[name]

        session = web_server.Session(ScriptedClient(), "test", profile_path=profile)
        server = web_server.make_server(session, 0, Clients())
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            for include in (False, True):
                conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=10)
                conn.request("POST", "/compare", body=json.dumps({"text": "hi", "providers": ["mock", "deepseek"],
                                                                  "include_profile": include}),
                             headers={"Host": "127.0.0.1", "Content-Type": "application/json"})
                r = conn.getresponse()
                data = json.loads(r.read())
                conn.close()
                self.assertEqual(r.status, 200)
                self.assertEqual([x["answer"] for x in data["results"]], ["from mock", "from deepseek"])
                self.assertEqual("Asha" in made["mock"].systems[0], include)
        finally:
            server.shutdown()
            server.server_close()


def call_tool(id, name, **input):
    return NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id=id, name=name, input=input)])


class Recorder:
    """A fake set of providers: each client made answers from the script given for its provider."""

    def __init__(self, delay=0, **scripts):
        self.scripts = scripts
        self.delay = delay
        self.made = {}

    def get(self, name):
        self.made.setdefault(name, []).append(ScriptedClient(*self.scripts[name], delay=self.delay))
        return self.made[name][-1]


class SidesAndRerunHttpTests(unittest.TestCase):
    def setUp(self):
        from harness.web import server as web_server
        self.web_server = web_server
        self.dir = pathlib.Path(tempfile.mkdtemp())

    def start(self, clients, session_client=None):
        self.session = self.web_server.Session(session_client or ScriptedClient(), "test", provider="mock",
                                               settings_path=self.dir / "settings.json",
                                               profile_path=self.dir / "profile.json")
        self.server = self.web_server.make_server(self.session, 0, clients)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def post(self, path, body):
        import http.client
        import json
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=10)
        conn.request("POST", path, body=json.dumps(body),
                     headers={"Host": "127.0.0.1", "Content-Type": "application/json"})
        r = conn.getresponse()
        data = json.loads(r.read())
        conn.close()
        return r.status, data

    def get(self, path):
        import http.client
        import json
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=10)
        conn.request("GET", path, headers={"Host": "127.0.0.1"})
        r = conn.getresponse()
        data = json.loads(r.read())
        conn.close()
        return r.status, data

    def test_a_comparison_is_kept_and_can_be_opened_again(self):
        # F023
        clients = Recorder(mock=[answer("Paris.")])
        self.start(clients)
        status, data = self.post("/compare", {"text": "capital?", "look_for": "Paris?", "sides": [{"provider": "mock"}]})
        self.assertEqual(status, 200, data)
        self.assertTrue(data["id"])
        status, listed = self.get("/compare/history")
        self.assertEqual(listed["items"][0]["id"], data["id"])
        status, loaded = self.get(f"/compare/get?id={data['id']}")
        self.assertEqual(loaded["sides"][0]["answer"], "Paris.")
        self.assertEqual(loaded["look_for"], "Paris?")

    def test_status_says_when_nothing_is_running_and_stop_needs_a_run(self):
        # F024
        self.start(Recorder(mock=[]))
        self.assertEqual(self.get("/compare/status")[1], {"running": False})
        self.assertEqual(self.post("/compare/stop", {})[0], 409)

    def test_an_opened_side_says_where_it_came_from(self):
        # F022: opening a side as a conversation carries its comparison and side letter
        clients = Recorder(mock=[answer("Paris.")])
        self.start(clients)
        status, data = self.post("/compare", {"text": "capital?", "sides": [{"provider": "mock"}]})
        conv = data["results"][0]["conversation"]
        self.assertEqual(self.post("/conversations/open", {"id": conv})[0], 200)
        self.assertEqual(self.session.snapshot(0)["origin"], {"comparison": data["id"], "side": "A"})
        self.session.reset()
        self.assertIsNone(self.session.snapshot(0)["origin"])

    def run_message(self, text):
        self.session.start(text)
        end = time.time() + 5
        while self.session.running and time.time() < end:
            time.sleep(0.01)

    def test_each_side_can_change_settings(self):
        clients = Recorder(mock=[call_tool("t1", "roll_dice", sides=6), answer("rolled or not")])
        self.start(clients)
        status, data = self.post("/compare", {"text": "hi", "sides": [
            {"provider": "mock", "settings": {"system": "You are a pirate.", "permissions": {"roll_dice": "block"}}}]})
        self.assertEqual(status, 200, data)
        [side] = data["results"]
        self.assertTrue(side["config"]["system_edited"])
        self.assertEqual(side["config"]["permissions"], {"roll_dice": "block"})
        self.assertIn("pirate", clients.made["mock"][0].systems[0])
        self.assertEqual(side["tools"], [{"name": "roll_dice", "input": {"sides": 6}, "blocked": True, "outcome": "blocked"}])
        self.assertEqual([c["turn"] for c in side["calls"]], [1, 2])
        # the saved settings themselves didn't change
        self.assertNotIn("pirate", self.post("/settings", {})[1]["system"])

    def test_a_side_with_the_practice_switch_on_tries_again(self):
        self.start(Recorder(mock=[answer("fine")]))
        with mock.patch.object(loop, "retry_wait", lambda e, attempt: 0.01):
            status, data = self.post("/compare", {"text": "hi", "sides": [
                {"provider": "mock"}, {"provider": "mock", "settings": {"faults": {"busy": True}}}]})
        self.assertEqual(status, 200, data)
        calm, busy = data["results"]

        def retries(side):  # from the side's saved conversation, as the page opens it
            self.assertEqual(self.post("/conversations/open", {"id": side["conversation"]})[0], 200)
            return [e for e in self.session.snapshot(0)["events"] if e["kind"] == "retry"]
        self.assertEqual(retries(calm), [])
        [retry] = retries(busy)
        self.assertEqual((retry["status"], retry["simulated"]), (529, True))
        self.assertEqual(busy["config"]["faults"], {"busy": True})
        self.assertEqual(busy["answer"], "fine")

    def test_the_same_provider_twice_gets_told_apart(self):
        self.start(Recorder(mock=[answer("same")]))
        status, data = self.post("/compare", {"text": "hi", "sides": [{"provider": "mock"}, {"provider": "mock"}]})
        self.assertEqual(status, 200, data)
        self.assertEqual([r["label"] for r in data["results"]],
                         ["Mock: replies from claude -p (A)", "Mock: replies from claude -p (B)"])
        self.assertEqual([r["config"]["system_edited"] for r in data["results"]], [False, False])

    def test_a_sides_own_name_is_not_its_provider(self):
        self.start(Recorder(mock=[answer("a"), answer("b")]))
        status, data = self.post("/compare", {"text": "hi", "sides": [{"provider": "mock", "label": "Allowed"},
                                                                    {"provider": "mock", "label": "Blocked"}]})
        self.assertEqual(status, 200, data)
        self.assertEqual([r["label"] for r in data["results"]], ["Allowed", "Blocked"])
        self.assertEqual({r["config"]["label"] for r in data["results"]}, {"Mock: replies from claude -p"})

    def test_each_side_can_pick_a_model(self):
        clients = Recorder(mock=[answer("big"), answer("small")])
        self.start(clients)
        status, data = self.post("/compare", {"text": "hi", "sides": [
            {"provider": "mock"}, {"provider": "mock", "model": "claude-haiku-4-5-20251001"}]})
        self.assertEqual(status, 200, data)
        self.assertEqual([r["model"] for r in data["results"]], ["claude-opus-5-5", "claude-haiku-4-5-20251001"])
        self.assertEqual(data["results"][1]["config"]["model"], "claude-haiku-4-5-20251001")
        self.assertEqual(self.post("/compare", {"text": "hi", "sides": [{"provider": "mock", "model": "gpt-9"}]})[0], 400)

    def test_ask_first_tools_can_be_let_through_for_a_comparison(self):
        clients = Recorder(mock=[call_tool("t1", "roll_dice", sides=6), answer("rolled"),
                                 call_tool("t2", "roll_dice", sides=6), answer("rolled")])
        self.start(clients)
        for allow in (False, True):
            status, data = self.post("/compare", {"text": "roll", "sides": [
                {"provider": "mock", "allow_ask": allow, "settings": {"permissions": {"roll_dice": "ask"}}}]})
            self.assertEqual(status, 200, data)
            [side] = data["results"]
            self.assertEqual(side["tools"][0].get("blocked", False), not allow)
            self.assertEqual(side["allow_ask"], allow)

    def test_bad_sides_are_refused(self):
        self.start(Recorder(mock=[]))
        self.assertEqual(self.post("/compare", {"text": "hi", "sides": [{"provider": "mock"}] * 4})[0], 400)
        self.assertEqual(self.post("/compare", {"text": "hi", "sides": [{"provider": "nope"}]})[0], 400)
        self.assertEqual(self.post("/compare", {"text": "hi", "sides": [
            {"provider": "mock", "settings": {"permissions": {"roll_dice": "sometimes"}}}]})[0], 400)

    def test_rerun_sends_the_same_history_with_current_settings(self):
        clients = Recorder(mock=[answer("again, differently")])
        self.start(clients, ScriptedClient(answer("first answer"), answer("second answer")))
        self.run_message("first question")
        self.run_message("second question")
        conv = self.session.conv_id
        second = [e for e in self.session.snapshot(0)["events"] if e["kind"] == "user"][1]["seq"]
        self.post("/settings", {"system": "Answer in French."})
        status, data = self.post("/rerun", {"conversation_id": conv, "message_seq": second})
        self.assertEqual(status, 200, data)
        self.assertEqual(data["text"], "second question")
        self.assertEqual(data["baseline"]["answer"], "second answer")
        self.assertFalse(data["baseline"]["config"]["system_edited"])
        self.assertEqual(data["rerun"]["answer"], "again, differently")
        self.assertTrue(data["rerun"]["config"]["system_edited"])
        self.assertEqual((data["rerun"]["label"], data["rerun"]["config"]["label"]), ("Current settings", "Mock: replies from claude -p"))
        self.assertIn("French", clients.made["mock"][0].systems[0])

    def test_rerun_cannot_write_files(self):
        target = self.dir / "out.txt"
        clients = Recorder(mock=[call_tool("w1", "write_file", path=str(target), content="x"), answer("couldn't")])
        self.start(clients, ScriptedClient(answer("ok")))
        self.run_message("write it")
        first = self.session.snapshot(0)["events"][0]["seq"]
        status, data = self.post("/rerun", {"conversation_id": self.session.conv_id, "message_seq": first})
        self.assertEqual(status, 200, data)
        self.assertFalse(target.exists())
        self.assertTrue(data["rerun"]["tools"][0]["blocked"])

    # F261, F267: a re-run is kept with the comparisons, and its new run knows where it came from
    def test_a_rerun_is_kept_and_its_new_run_leads_back_to_it(self):
        from harness.web import conversations
        self.start(Recorder(mock=[answer("again")]), ScriptedClient(answer("first")))
        self.run_message("hello")
        seq = self.session.snapshot(0)["events"][0]["seq"]
        status, data = self.post("/rerun", {"conversation_id": self.session.conv_id, "message_seq": seq})
        self.assertEqual(status, 200, data)
        self.assertTrue(data["id"])
        listed = self.get("/compare/history")[1]["items"][0]
        self.assertEqual((listed["id"], listed["kind"]), (data["id"], "rerun"))
        loaded = self.get(f"/compare/get?id={data['id']}")[1]
        self.assertEqual((loaded["kind"], loaded["conversation"], loaded["seq"]), ("rerun", self.session.conv_id, seq))
        self.assertEqual([s["label"] for s in loaded["sides"]], ["Saved run", "Current settings"])
        saved = conversations.load(data["rerun"]["conversation"])
        self.assertEqual(saved["origin"], {"comparison": data["id"], "side": "Current settings", "kind": "rerun"})
        self.assertIn("claude-opus-5-5", saved["title"])  # the model, not "Now"
        self.assertNotIn("Now", saved["title"])

    # F262: a re-run shows as running and can be stopped, like a comparison
    def test_a_rerun_can_be_stopped(self):
        clients = Recorder(delay=0.3, mock=[call_tool("t1", "roll_dice", sides=6), answer("rolled")])
        self.start(clients, ScriptedClient(answer("first")))
        self.run_message("roll")
        seq = self.session.snapshot(0)["events"][0]["seq"]
        self.server.compare_cancel.set()  # left over from an earlier stopped comparison: must not stop this one
        out = {}
        worker = threading.Thread(target=lambda: out.update(r=self.post("/rerun", {"conversation_id": self.session.conv_id,
                                                                                 "message_seq": seq})))
        worker.start()
        end = time.time() + 3
        while not self.get("/compare/status")[1].get("running") and time.time() < end:
            time.sleep(0.02)
        self.assertTrue(self.get("/compare/status")[1]["running"])
        self.assertEqual(self.post("/compare/stop", {})[0], 200)
        worker.join(5)
        status, data = out["r"]
        self.assertEqual(status, 200, data)
        self.assertTrue(data["rerun"]["stopped"])
        self.assertEqual(len(clients.made["mock"][0].systems), 1)  # stopped before the second call
        self.assertEqual(self.get("/compare/status")[1], {"running": False})

    def test_rerun_errors(self):
        self.start(Recorder(mock=[]), ScriptedClient(answer("ok")))
        self.run_message("hello")
        self.assertEqual(self.post("/rerun", {"conversation_id": "../x", "message_seq": 0})[0], 404)
        self.assertEqual(self.post("/rerun", {"conversation_id": self.session.conv_id, "message_seq": 999})[0], 404)


class HistoryTests(unittest.TestCase):
    def test_history_before_finds_repeated_messages_and_notices_summaries(self):
        from harness.web import conversations
        events = [{"seq": 0, "kind": "user", "time": 0, "text": "hi"}, {"seq": 3, "kind": "user", "time": 1, "text": "hi"}]
        msgs = [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "a"},
                {"role": "user", "content": "hi"}, {"role": "assistant", "content": "b"}]
        data = {"events": events, "messages": msgs}
        self.assertEqual(conversations.history_before(data, 0), [])
        self.assertEqual(conversations.history_before(data, 3), msgs[:2])
        summarised = {"events": events, "messages": [{"role": "user", "content": "[Summary of ...] hi"}, msgs[3]]}
        self.assertIsNone(conversations.history_before(summarised, 0))

    def test_run_stats_from_saved_events(self):
        from harness.web import conversations
        events = [
            {"seq": 0, "kind": "user", "time": 10.0, "text": "q"},
            {"seq": 1, "kind": "request", "time": 10.1, "turn": 1, "model": "m", "system": "S",
             "config": {"provider": "mock", "model": "m"}, "tools": []},
            {"seq": 2, "kind": "response", "time": 11.1, "turn": 1,
             "usage": {"input_tokens": 50, "output_tokens": 5}, "cost": None},
            {"seq": 3, "kind": "tool_call", "time": 11.2, "id": "t1", "name": "write_file", "input": {}},
            {"seq": 4, "kind": "tool_result", "time": 11.3, "result": {"tool_use_id": "t1", "content": "no"},
             "outcome": "declined"},
            {"seq": 5, "kind": "answer", "time": 12.0, "text": "done"},
            {"seq": 6, "kind": "done", "time": 12.5},
        ]
        s = conversations.run_stats({"id": "c", "events": events, "messages": []}, 0)
        self.assertEqual((s["answer"], s["seconds"], s["tokens_read"], s["model"], s["provider"]),
                         ("done", 2.5, 50, "m", "mock"))
        self.assertEqual(s["tools"], [{"name": "write_file", "input": {}, "blocked": True}])
        self.assertEqual((s["approved"], s["waited"]), ([], 0))
        self.assertEqual(s["config"]["system"], "S")
        self.assertEqual(s["calls"][0]["seconds"], 1.0)


class SavedSidesAndRepeatsTests(unittest.TestCase):
    def test_each_side_is_saved_as_a_conversation_you_can_open(self):
        from harness.web import conversations
        client = ScriptedClient(NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id="t1", name="roll_dice",
                                                                                  input={"sides": 6})]),
                                answer("You rolled."))
        [result] = compare.compare([side("A", client)], "roll a die")
        saved = conversations.load(result["conversation"])
        self.assertEqual(saved["kind"], "compare")
        self.assertTrue(saved["title"].startswith("Compare · A · roll a die"))
        self.assertEqual([e["kind"] for e in saved["events"]],
                         ["user", "request", "response", "tool_call", "tool_result", "request", "response", "answer", "done"])
        self.assertEqual(saved["events"][1]["provider"], "A")
        self.assertEqual([m["role"] for m in saved["messages"]], ["user", "assistant", "user", "assistant"])
        self.assertNotIn("events", result)  # the page gets the summary; the details are in the saved file
        listed = next(c for c in conversations.list_all() if c["id"] == result["conversation"])
        self.assertEqual(listed["kind"], "compare")

    def test_saved_sides_are_told_apart_by_time_and_runs(self):
        # F196: the same question compared twice gives titles you can tell apart
        from harness.web import conversations
        client = ScriptedClient(answer("a"), answer("b"), answer("c"))
        [result] = compare.compare([side("A", client)], "roll a die", repeat=3)
        title = conversations.load(result["conversation"])["title"]
        self.assertRegex(title, r"^Compare · A · roll a die · \d\d:\d\d · run 1 of 3$")

    def test_several_runs_give_a_middle_a_range_and_agreement(self):
        client = ScriptedClient(answer("It is 4."), answer("it is 4"), answer("Five."))
        [result] = compare.compare([side("A", client)], "2+2?", repeat=3, save=False)
        stats = result["stats"]
        self.assertEqual((stats["runs"], stats["same_answer"]), (3, 2))  # "It is 4." and "it is 4" count as the same
        self.assertEqual(len(stats["answers"]), 3)  # every run's answer, to read side by side
        self.assertEqual(set(stats["seconds"]), {"median", "min", "max"})
        self.assertEqual(result["answer"], "It is 4.")  # the card shows the first run
        self.assertNotIn("conversation", result)


class CompareProgressTests(unittest.TestCase):
    # F024: each side says how far it has got, and Stop ends the remaining runs
    def test_progress_is_reported_after_each_run_and_stop_ends_the_rest(self):
        client = ScriptedClient(answer("one"), answer("two"), answer("three"))
        seen = []
        stop = threading.Event()

        def progress(i, done, total):
            seen.append((i, done, total))
            stop.set()  # stop after the first run

        [result] = compare.compare([side("A", client)], "q", repeat=3, save=False, progress=progress, cancel=stop)
        self.assertEqual(seen, [(0, 1, 3)])
        self.assertEqual(result["stats"]["runs"], 1)
        self.assertTrue(result["stopped"])

    # Deferred M5: with one run per side, Stop still ends the run at the next step
    def test_stop_ends_a_single_run_between_steps(self):
        client = ScriptedClient(
            NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id="t1", name="roll_dice", input={"sides": 6})]),
            answer("You rolled."), delay=0.2)
        stop = threading.Event()
        threading.Timer(0.1, stop.set).start()  # pressed while the first call is out
        [result] = compare.compare([side("A", client)], "roll", repeat=1, save=False, cancel=stop)
        self.assertTrue(result["stopped"])
        self.assertNotIn("answer", result)
        self.assertEqual(len(client.systems), 1)  # the second call was never made

    # F032: failed runs don't count as agreeing; tool choices are compared too
    def test_agreement_leaves_out_failed_runs_and_counts_tool_choices(self):
        runs = [{"answer": "4", "seconds": 1, "tokens_read": 1, "tokens_written": 1, "tools": [{"name": "calculate"}]},
                {"answer": "4", "seconds": 1, "tokens_read": 1, "tokens_written": 1, "tools": [{"name": "calculate"}]},
                {"error": "boom", "seconds": 1, "tokens_read": 0, "tokens_written": 0, "tools": []},
                {"error": "boom", "seconds": 1, "tokens_read": 0, "tokens_written": 0, "tools": []}]
        stats = compare.summary(runs)
        self.assertEqual(stats["same_answer"], 2)
        self.assertEqual(stats["answered"], 2)
        self.assertEqual(stats["errors"], 2)
        self.assertEqual(stats["same_tools"], 2)

    # F246: a run cut short by Stop isn't an answer: it doesn't agree, and its time isn't in the range
    def test_a_stopped_run_is_not_counted_as_answered(self):
        runs = [{"answer": "4", "seconds": 10, "tokens_read": 100, "tokens_written": 5, "tools": [{"name": "calculate"}]},
                {"answer": "4", "seconds": 12, "tokens_read": 120, "tokens_written": 6, "tools": [{"name": "calculate"}]},
                {"stopped": True, "seconds": 1, "tokens_read": 10, "tokens_written": 0, "tools": []}]
        stats = compare.summary(runs)
        self.assertEqual((stats["runs"], stats["answered"], stats["stopped"], stats["errors"]), (3, 2, 1, 0))
        self.assertEqual(stats["seconds"], {"median": 11, "min": 10, "max": 12})
        self.assertEqual(stats["tokens_read"]["min"], 100)
        self.assertEqual(stats["same_tools"], 2)
        self.assertEqual(stats["answers"], ["4", "4"])

    # F247: failed runs aren't in "Same tools", the ranges or the answers; their errors are listed apart
    def test_failed_runs_are_kept_out_of_tools_ranges_and_answers(self):
        ok = {"answer": "Sunny.", "seconds": 5, "tokens_read": 50, "tokens_written": 5, "tools": [{"name": "get_weather"}]}
        bad = {"error": "Could not reach the service.", "seconds": 0.5, "tokens_read": 0, "tokens_written": 0, "tools": []}
        stats = compare.summary([ok, bad, bad, bad, bad])
        self.assertEqual((stats["answered"], stats["errors"], stats["same_tools"]), (1, 4, 1))
        self.assertEqual(stats["tools"], [["get_weather"]])
        self.assertEqual(stats["seconds"], {"median": 5, "min": 5, "max": 5})
        self.assertEqual(stats["answers"], ["Sunny."])
        self.assertEqual(stats["failures"], ["Could not reach the service."] * 4)
        none = compare.summary([bad, bad])
        self.assertEqual((none["answered"], none["same_tools"], none["seconds"]), (0, 0, None))

    # F246: Stop pressed during a side's last run marks the side stopped, though every run started
    def test_stop_during_the_last_run_marks_the_side_stopped(self):
        tool = lambda: NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id="t1", name="roll_dice", input={"sides": 6})])
        client = ScriptedClient(answer("first"), tool(), answer("second"), delay=0.2)
        stop = threading.Event()

        def progress(i, done, total):
            if done == 1:
                threading.Timer(0.1, stop.set).start()  # pressed while run 2's first call is out

        [result] = compare.compare([side("A", client)], "q", repeat=2, save=False, progress=progress, cancel=stop)
        self.assertEqual(result["stats"]["runs"], 2)
        self.assertEqual(result["stats"]["stopped"], 1)
        self.assertTrue(result["stopped"])

    # F031: a refused tool says why
    def test_a_refused_tool_carries_its_outcome(self):
        target = pathlib.Path(tempfile.mkdtemp()) / "out.txt"
        client = ScriptedClient(
            NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id="t1", name="write_file",
                                                            input={"path": str(target), "content": "x"})]),
            answer("couldn't"))
        [result] = compare.compare([side("A", client)], "write it", save=False)
        # F298: write_file is set to Ask first, and nobody can be asked: that's the reason, not "blocked"
        self.assertEqual(result["tools"][0]["outcome"], "unattended")
        self.assertTrue(result["tools"][0]["blocked"])

    # F298: the saved side records the rule as Ask first, and the model is told nobody could be asked
    def test_an_ask_first_tool_is_recorded_as_ask_first(self):
        from harness.web import conversations
        target = pathlib.Path(tempfile.mkdtemp()) / "out.txt"
        client = ScriptedClient(
            NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id="t1", name="write_file",
                                                            input={"path": str(target), "content": "x"})]),
            answer("couldn't"))
        [result] = compare.compare([side("A", client)], "write it", cid=compare.new_id())
        events = conversations.load(result["conversation"])["events"]
        call = next(e for e in events if e["kind"] == "tool_call")
        done = next(e for e in events if e["kind"] == "tool_result")
        self.assertEqual((call["permission"], done["outcome"]), ("ask", "unattended"))
        self.assertIn("nobody can be asked", done["result"]["content"])


class CompareHistoryTests(unittest.TestCase):
    # F023: a comparison is kept, with its sides, and can be listed and opened again
    def test_a_comparison_is_saved_listed_and_loaded(self):
        client = ScriptedClient(answer("Paris."))
        cid = compare.new_id()
        results = compare.compare([side("A", client)], "capital of France?", cid=cid)
        compare.save_comparison(cid, "capital of France?", results, look_for="Did it say Paris?", repeat=1)
        listed = compare.list_comparisons()
        self.assertEqual(listed[0]["id"], cid)
        self.assertEqual(listed[0]["text"], "capital of France?")
        loaded = compare.load_comparison(cid)
        self.assertEqual(loaded["sides"][0]["answer"], "Paris.")
        self.assertEqual(loaded["look_for"], "Did it say Paris?")

    # F022: a side opened as a conversation knows which comparison and which side it was
    def test_each_saved_side_knows_its_comparison(self):
        from harness.web import conversations
        client = ScriptedClient(answer("Paris."))
        cid = compare.new_id()
        [result] = compare.compare([side("A", client)], "capital?", cid=cid)
        saved = conversations.load(result["conversation"])
        self.assertEqual(saved["origin"], {"comparison": cid, "side": "A"})


if __name__ == "__main__":
    unittest.main()
