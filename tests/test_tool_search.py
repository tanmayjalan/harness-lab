"""Tests for too many tools (core/office_tools.py, features/tool_search.py): 40 office tools, sent on every
call or found on demand with find_tool. A fake model replays scripted replies, so no API key or cost.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import pathlib
import tempfile
import time
import unittest
from types import SimpleNamespace as NS

from anthropic.types import TextBlock, ToolUseBlock

from harness import cli, evals
from harness.core import loop, office_tools, tools
from harness.features import lab_settings, subagents, tool_search, workflow
from harness.web import compare, conversations
from harness.web import server as web_server

BOOK = {"room": "B", "date": "2026-10-14", "start_time": "15:00", "people": 4}


def answer(text="Done."):
    return NS(stop_reason="end_turn", content=[TextBlock(type="text", text=text)])


def call(id, name, **input):
    return NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id=id, name=name, input=input)])


class Client:
    """Answers from a script and keeps the names of the tools sent on every call."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.tools = []
        self.messages = self

    def create(self, **kwargs):
        self.tools.append([t["name"] for t in kwargs.get("tools", [])])
        return self.replies.pop(0)


def names(tool_list):
    return [t["name"] for t in tool_list]


def clean(changes):
    return lab_settings.clean(changes, loop.SYSTEM, tools.TOOLS, loop.default_permission)


class OfficeToolsTests(unittest.TestCase):
    def test_forty_tools_each_with_its_handler(self):
        self.assertEqual(len(office_tools.TOOLS), 40)
        self.assertEqual(names(office_tools.TOOLS), list(office_tools.HANDLERS))
        self.assertEqual(len(set(office_tools.HANDLERS)), 40)
        for t in office_tools.TOOLS:
            self.assertTrue(t["description"] and t["input_schema"]["type"] == "object", t["name"])
            self.assertNotIn("strict", t)

    def test_they_are_allowed_and_do_not_clash_with_the_usual_tools(self):
        self.assertFalse(set(office_tools.HANDLERS) & set(names(tools.TOOLS)))
        self.assertNotIn("find_tool", names(tools.TOOLS) + names(office_tools.TOOLS))
        for name in office_tools.HANDLERS:
            self.assertEqual(loop.default_permission(name), "allow", name)

    def test_a_handler_answers_with_canned_text_and_checks_its_input(self):
        out = office_tools.HANDLERS["book_room"](**BOOK)
        self.assertIn("Booked room B on 2026-10-14 at 15:00 for 4 people", out)
        self.assertIn("Practice only", out)
        with self.assertRaisesRegex(ValueError, "missing people"):
            office_tools.HANDLERS["book_room"](room="B", date="2026-10-14", start_time="15:00")
        with self.assertRaisesRegex(ValueError, "no such field: colour"):
            office_tools.HANDLERS["check_parking"](date="2026-10-14", colour="red")

    def test_office_tools_stay_out_of_settings(self):
        self.assertFalse(set(office_tools.HANDLERS) & set(names(web_server.Session(None, "t").base_tools)))


class FindTests(unittest.TestCase):
    def test_find_scores_names_and_descriptions_and_loads_the_best_few(self):
        box = tool_search.Toolbox(tools.TOOLS, "find")
        found = box.find("Book meeting room B for 3pm tomorrow")
        self.assertEqual(found[0], {"name": "book_room", "description": office_tools.TOOLS[0]["description"]})
        self.assertLessEqual(len(found), 5)
        self.assertEqual(box.loaded, names(found))
        self.assertEqual(box.find("Is there free parking?")[0]["name"], "check_parking")  # (case and "?" don't count)
        self.assertEqual(box.find("xylophone"), [])

    def test_what_the_model_gets_back(self):
        box = tool_search.Toolbox([], "find")
        text = box.run(None)("find_tool", {"query": "leave"})
        self.assertTrue(text.startswith("Found "))
        self.assertIn("- request_leave: ", text)
        self.assertIn("next step", text)
        self.assertIn("No tools match", box.run(None)("find_tool", {"query": "xylophone"}))

    def test_find_mode_sends_find_tool_and_adds_what_it_found_at_the_end(self):
        box = tool_search.Toolbox(tools.TOOLS, "find")
        self.assertEqual(names(box.now()), names(tools.TOOLS) + ["find_tool"])
        box.find("book a meeting room")
        sent = box.now()
        self.assertEqual(names(sent)[:len(tools.TOOLS) + 1], names(tools.TOOLS) + ["find_tool"])  # the start stays
        self.assertEqual(names(sent)[len(tools.TOOLS) + 1], "book_room")
        box.find("parking")  # found later: added after, never re-sorted
        self.assertEqual(names(box.now())[:len(sent)], names(sent))

    def test_all_mode_sends_every_office_tool_and_finding_changes_nothing(self):
        box = tool_search.Toolbox(tools.TOOLS, "all")
        self.assertEqual(names(box.now()), names(tools.TOOLS) + names(office_tools.TOOLS))
        box.find("book a meeting room")
        self.assertEqual(len(box.now()), len(tools.TOOLS) + 40)

    def test_a_kept_start_that_already_holds_them_sends_each_name_once(self):
        for mode in ("find", "all"):
            kept = tool_search.start(tools.TOOLS, mode)
            box = tool_search.Toolbox(kept, mode)
            box.find("book a meeting room")
            sent = names(box.now())
            self.assertEqual(len(sent), len(set(sent)), mode)
            self.assertEqual(sent[:len(kept)], names(kept), mode)

    def test_an_office_tool_that_was_not_loaded_is_refused_with_a_clear_error(self):
        box = tool_search.Toolbox(tools.TOOLS, "find")
        run = box.run(lambda name, args: "usual tool")
        with self.assertRaisesRegex(ValueError, "book_room isn't loaded. Use find_tool first"):
            run("book_room", BOOK)
        run("find_tool", {"query": "book a meeting room"})
        self.assertIn("Booked room B", run("book_room", BOOK))
        self.assertEqual(run("calculate", {"expression": "1+1"}), "usual tool")
        self.assertIn("Booked room B", tool_search.Toolbox(tools.TOOLS, "all").run(None)("book_room", BOOK))

    def test_the_history_says_what_was_loaded(self):
        found = tool_search.found_text("room", [{"name": "book_room", "description": "x"},
                                                {"name": "list_free_rooms", "description": "y"}])
        history = [
            {"role": "user", "content": "book a room"},
            {"role": "assistant", "content": [ToolUseBlock(type="tool_use", id="f1", name="find_tool", input={"query": "room"})]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "f1", "content": found}]},
            {"role": "assistant", "content": [{"type": "tool_use", "id": "b1", "name": "book_room", "input": BOOK},
                                              {"type": "tool_use", "id": "c1", "name": "calculate", "input": {}}]},
        ]
        self.assertEqual(tool_search.used_in(history), ["book_room", "list_free_rooms"])
        self.assertEqual(tool_search.Toolbox([], "find", tool_search.used_in(history)).loaded,
                         ["book_room", "list_free_rooms"])
        self.assertEqual(tool_search.used_in([]), [])


class LoopTests(unittest.TestCase):
    def run_loop(self, mode, *replies):
        client = Client(*replies)
        box = tool_search.Toolbox(tools.TOOLS, mode)
        messages = [{"role": "user", "content": "Book meeting room B for 3pm tomorrow for 4 people."}]
        loop.agent(messages, client, tools=box.now, run=box.run(tools.run_tool), confirm=None)
        return client, messages

    def test_the_list_grows_only_in_find_mode_and_only_from_the_next_call(self):
        client, _ = self.run_loop("find", call("f1", "find_tool", query="book a meeting room"),
                                  call("b1", "book_room", **BOOK), answer())
        first, second, third = client.tools
        self.assertIn("find_tool", first)
        self.assertNotIn("book_room", first)
        self.assertEqual(second[:len(first)], first)  # what was sent stays at the start
        self.assertIn("book_room", second)
        self.assertEqual(third, second)
        client, _ = self.run_loop("all", call("b1", "book_room", **BOOK), answer())
        self.assertEqual(client.tools[0], client.tools[1])
        self.assertIn("book_room", client.tools[0])
        self.assertNotIn("find_tool", client.tools[0])

    def test_the_model_is_told_to_use_find_tool_first(self):
        client, messages = self.run_loop("find", call("b1", "book_room", **BOOK), answer())
        [result] = messages[2]["content"]
        self.assertTrue(result["is_error"])
        self.assertIn("Use find_tool first", result["content"])


class SettingTests(unittest.TestCase):
    def test_it_is_a_setting_off_by_default_with_two_modes(self):
        self.assertEqual(clean({"extra_tools": {"enabled": True, "mode": "all"}})["extra_tools"],
                         {"enabled": True, "mode": "all"})
        self.assertEqual(clean({"extra_tools": {"enabled": True}})["extra_tools"], {"enabled": True, "mode": "find"})
        self.assertIsNone(clean({"extra_tools": {"enabled": False, "mode": "all"}})["extra_tools"])
        self.assertIsNone(clean({})["extra_tools"])
        for bad in ("yes", {"enabled": True, "mode": "some"}):
            with self.assertRaises(ValueError):
                clean({"extra_tools": bad})
        self.assertIsNone(lab_settings.extra_tools({}))
        self.assertEqual(lab_settings.extra_tools(clean({"extra_tools": {"enabled": True, "mode": "all"}})), "all")

    def test_what_changed_snapshot_and_badges(self):
        find = clean({"extra_tools": {"enabled": True, "mode": "find"}})
        self.assertIn("extra tools: found on demand", lab_settings.what_changed(find))
        self.assertIn("extra tools: all sent", lab_settings.what_changed(clean({"extra_tools": {"enabled": True, "mode": "all"}})))
        snap = lab_settings.snapshot(find, provider="mock", label="M", model="m", system="S", facts_shared=0, tools=[],
                                     permission=loop.default_permission, source=lambda n: "built in")
        self.assertEqual(snap["extra_tools"], {"enabled": True, "mode": "find"})
        self.assertIn("40 tools on demand", lab_settings.badges(snap))

    def test_find_tool_never_runs_alongside_others(self):
        self.assertIn("find_tool", lab_settings.ALONE)
        self.assertFalse(lab_settings.at_once({"tools_at_once": {"enabled": True}})("find_tool"))
        self.assertTrue(lab_settings.at_once({"tools_at_once": {"enabled": True}})("check_parking"))

    def test_helpers_and_the_workflow_never_get_them(self):
        sent = tool_search.start(tools.TOOLS, "all") + [tool_search.FIND_TOOL]
        self.assertEqual(subagents.helper_tools(sent), subagents.helper_tools(tools.TOOLS))
        self.assertEqual(workflow.read_only(sent), workflow.read_only(tools.TOOLS))


class SessionTests(unittest.TestCase):
    """The page's conversation: one Toolbox for the whole conversation."""

    def session(self, client, **settings):
        path = pathlib.Path(tempfile.mkdtemp()) / "lab_settings.json"
        lab_settings.save(settings, loop.SYSTEM, tools.TOOLS, loop.default_permission, path)
        return web_server.Session(client, "test", provider="mock", settings_path=path)

    def send(self, s, text):
        s.start(text)
        end = time.time() + 5
        while s.running and time.time() < end:
            time.sleep(0.01)
        self.assertFalse(s.running)

    def requests(self, s):
        return [e for e in s.snapshot(0)["events"] if e["kind"] == "request"]

    def test_loaded_stays_loaded_for_the_next_message(self):
        client = Client(call("f1", "find_tool", query="book a meeting room"), call("b1", "book_room", **BOOK), answer(),
                        call("b2", "book_room", **{**BOOK, "room": "C"}), answer())
        s = self.session(client, extra_tools={"enabled": True, "mode": "find"})
        self.send(s, "Book meeting room B for 3pm tomorrow for 4 people.")
        self.send(s, "And room C too.")
        self.assertNotIn("book_room", client.tools[0])
        self.assertIn("book_room", client.tools[1])
        self.assertIn("book_room", client.tools[3])  # message 2 still offers it
        results = [e for e in s.snapshot(0)["events"] if e["kind"] == "tool_result"]
        self.assertEqual([e["outcome"] for e in results], ["ran", "ran", "ran"])
        # The Inspector gets the list each call really sent, and sees the start change when book_room is loaded
        req = self.requests(s)
        self.assertEqual([names(r["tools"]) for r in req], client.tools)
        self.assertEqual([r["start_changed"] for r in req], [False, True, False, False, False])
        self.assertEqual(req[0]["config"]["extra_tools"], {"enabled": True, "mode": "find"})

    def test_all_mode_sends_every_office_tool_from_the_first_call(self):
        client = Client(call("b1", "book_room", **BOOK), answer())
        s = self.session(client, extra_tools={"enabled": True, "mode": "all"})
        self.send(s, "Book meeting room B for 3pm tomorrow for 4 people.")
        self.assertEqual(len(client.tools[0]), len(tools.TOOLS) - 1 + 40)  # (run_python only with Run code on)
        self.assertEqual(client.tools[0], client.tools[1])
        self.assertEqual([r["start_changed"] for r in self.requests(s)], [False, False])

    def test_off_sends_none_of_them(self):
        client = Client(answer())
        self.send(self.session(client), "hi")
        self.assertFalse(set(client.tools[0]) & (set(office_tools.HANDLERS) | {"find_tool"}))

    def test_a_new_conversation_starts_empty_and_a_reopened_one_from_its_history(self):
        client = Client(call("f1", "find_tool", query="book a meeting room"), answer(), answer(), answer())
        s = self.session(client, extra_tools={"enabled": True, "mode": "find"})
        self.send(s, "Find me the room tool.")
        conv = s.conv_id
        self.assertTrue(s.reset())
        self.send(s, "hi")
        self.assertNotIn("book_room", client.tools[2])
        self.assertTrue(s.open(conv))
        self.send(s, "Now book it.")
        self.assertIn("book_room", client.tools[3])

    def test_a_kept_start_keeps_find_tool_and_found_tools_go_after_it(self):
        client = Client(call("f1", "find_tool", query="book a meeting room"), answer(), answer())
        s = self.session(client, extra_tools={"enabled": True, "mode": "find"}, apply="conversation")
        self.send(s, "Find me the room tool.")
        kept = names(s.frozen["tools"])
        self.assertEqual(kept[-1], "find_tool")
        self.assertEqual(client.tools[0], kept)
        self.assertEqual(client.tools[1][:len(kept)], kept)
        self.assertIn("book_room", client.tools[1])
        self.send(s, "again")
        self.assertEqual(client.tools[2], client.tools[1])

    def test_the_settings_page_has_the_switch(self):
        path = pathlib.Path(tempfile.mkdtemp()) / "lab_settings.json"
        session = web_server.Session(NS(messages=None), "test", settings_path=path)
        server = web_server.make_server(session, 0)
        self.addCleanup(server.server_close)
        captured = {}

        class Fake(web_server.Handler):
            def __init__(self):
                self.server = server

            def send_json(self, status, body):
                captured.update(body)
        Fake().send_settings()
        self.assertEqual(captured["extra_tools"], {"enabled": False, "mode": "find"})
        self.assertFalse(set(office_tools.HANDLERS) & set(names(captured["tools"])))


class CompareAndOtherPlacesTests(unittest.TestCase):
    def side(self, client, mode, **extra):
        return {"label": "A", "model": "m", "client": client, "system": "S", "tools": tools.TOOLS,
                "permission": loop.default_permission, "extra_tools": mode,
                "config": {"tools": [{"name": t["name"], "source": "built in"} for t in tools.TOOLS]}, **extra}

    def test_run_one_with_the_setting_finds_and_records_what_each_call_sent(self):
        client = Client(call("f1", "find_tool", query="book a meeting room"), call("b1", "book_room", **BOOK), answer())
        result = compare.run_one(client, "m", "Book meeting room B", system="S", tools=tools.TOOLS,
                                 permission=loop.default_permission, extra_tools="find",
                                 config={"tools": []})
        self.assertEqual([t["name"] for t in result["tools"]], ["find_tool", "book_room"])
        self.assertNotIn("blocked", result["tools"][1])
        self.assertNotIn("failed", result["tools"][1])
        requests = [e for e in result["events"] if e["kind"] == "request"]
        self.assertEqual([names(r["tools"]) for r in requests], client.tools)
        self.assertIn("book_room", client.tools[1])

    def test_a_compare_side_with_the_setting_goes_through_the_server(self):
        import http.client
        import json
        import threading
        client = Client(call("f1", "find_tool", query="book a meeting room"), answer())
        path = pathlib.Path(tempfile.mkdtemp())
        session = web_server.Session(Client(), "test", provider="mock", settings_path=path / "settings.json",
                                     profile_path=path / "profile.json")
        server = web_server.make_server(session, 0, NS(get=lambda name: client))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=10)
        conn.request("POST", "/compare", body=json.dumps({"text": "Find the room tool", "sides": [
            {"provider": "mock", "settings": {"extra_tools": {"enabled": True, "mode": "find"}}}]}),
            headers={"Host": "127.0.0.1", "Content-Type": "application/json"})
        r = conn.getresponse()
        data = json.loads(r.read())
        conn.close()
        self.assertEqual(r.status, 200, data)
        [side] = data["results"]
        self.assertEqual(side["config"]["extra_tools"], {"enabled": True, "mode": "find"})
        self.assertIn("find_tool", client.tools[0])
        self.assertIn("book_room", client.tools[1])

    def test_each_run_of_a_side_starts_its_own_toolbox(self):
        client = Client(call("f1", "find_tool", query="book a meeting room"), answer(),
                        call("f2", "find_tool", query="book a meeting room"), answer())
        [result] = compare.compare([self.side(client, "find")], "Find the room tool", repeat=2, save=False)
        self.assertEqual(result["stats"]["runs"], 2)
        self.assertNotIn("book_room", client.tools[2])  # run 2's first call: nothing carried over from run 1

    def test_a_rerun_starts_from_what_its_history_loaded(self):
        history = [{"role": "user", "content": "book a room"},
                   {"role": "assistant", "content": [{"type": "tool_use", "id": "b1", "name": "book_room", "input": BOOK}]},
                   {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "b1", "content": "Booked."}]},
                   {"role": "assistant", "content": [{"type": "text", "text": "Booked."}]}]
        client = Client(answer())
        compare.run_one(client, "m", "again", system="S", tools=tools.TOOLS, permission=loop.default_permission,
                        extra_tools="find", history=history)
        self.assertIn("book_room", client.tools[0])

    def test_the_terminal_and_evals_pass_the_setting(self):
        client = Client(call("f1", "find_tool", query="book a meeting room"), answer(), answer())
        settings = clean({"extra_tools": {"enabled": True, "mode": "find"}})
        messages = [{"role": "user", "content": "Find me the room tool."}]
        cli.one_message(messages, client, "mock", "m", settings, [], say=lambda *a: None)
        messages.append({"role": "user", "content": "Book it."})
        cli.one_message(messages, client, "mock", "m", settings, [], say=lambda *a: None)
        self.assertIn("find_tool", client.tools[0])
        self.assertIn("book_room", client.tools[2])  # the next message's Toolbox started from the history
        seen = []
        real = compare.run_one
        compare.run_one = lambda *a, **kw: (seen.append(kw.get("extra_tools")), {"answer": "ok", "tools": []})[1]
        try:
            evals.run("mock", [{"question": "q"}], clients=NS(get=lambda name: None))
        finally:
            compare.run_one = real
        self.assertEqual(seen, [None])  # defaults: off, so the evals' pass rate is unchanged


if __name__ == "__main__":
    unittest.main()
