"""Tests for Rewind: checkpoints of the workspace's files (features/checkpoints.py) and going back to before a
message in the web server's Session, files and all.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import http.client
import json
import os
import pathlib
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace as NS
from unittest import mock

from anthropic.types import TextBlock, ToolUseBlock

from harness.core import loop, tools
from harness.features import checkpoints, lab_settings
from harness.web import conversations
from harness.web import server as web_server


def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def files(folder):
    """Every file under a folder, with its text: what a test expects the workspace to hold."""
    root = pathlib.Path(folder)
    return {p.relative_to(root).as_posix(): p.read_text(encoding="utf-8") for p in sorted(root.rglob("*")) if p.is_file()}


class Copies(unittest.TestCase):
    """A fresh workspace and a fresh folder for the copies, for each test."""

    def setUp(self):
        self.work = pathlib.Path(tempfile.mkdtemp())
        self.store = pathlib.Path(tempfile.mkdtemp())
        for name, value in (("DIR", self.store), ("ON", True)):
            patcher = mock.patch.object(checkpoints, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = mock.patch.object(tools, "WORKSPACE", self.work)
        patcher.start()
        self.addCleanup(patcher.stop)

    def blobs(self):
        folder = self.store / "blobs"
        return sorted(p.name for p in folder.iterdir()) if folder.exists() else []


class CheckpointTests(Copies):
    def test_take_change_restore_puts_every_file_back(self):
        write(self.work / "notes.md", "# Notes\n")
        write(self.work / "keep.txt", "unchanged")
        write(self.work / "old" / "deep" / "gone.txt", "removed later")
        before = files(self.work)
        manifest = checkpoints.take(self.work)
        self.assertEqual(sorted(manifest), ["keep.txt", "notes.md", "old/deep/gone.txt"])

        write(self.work / "notes.md", "# Notes\nRewind test\n")             # changed
        (self.work / "old" / "deep" / "gone.txt").unlink()                  # deleted
        write(self.work / "new" / "inner" / "added.txt", "added")           # added, in new folders
        write(self.work / "added.md", "added too")
        self.assertEqual(checkpoints.changes(manifest, self.work),
                         {"restore": ["notes.md", "old/deep/gone.txt"], "delete": ["added.md", "new/inner/added.txt"]})

        done = checkpoints.restore(manifest, self.work)
        self.assertEqual(done["delete"], ["added.md", "new/inner/added.txt"])
        self.assertEqual(files(self.work), before)
        self.assertFalse((self.work / "new").exists())  # the folders left empty went too
        self.assertTrue(self.work.is_dir())             # never the workspace itself
        self.assertEqual(checkpoints.changes(manifest, self.work), {"restore": [], "delete": []})

    def test_contents_are_kept_once(self):
        write(self.work / "a.txt", "same")
        write(self.work / "b.txt", "same")
        write(self.work / "c.txt", "other")
        first = checkpoints.take(self.work)
        self.assertEqual(len(self.blobs()), 2)       # two different contents
        self.assertEqual(first["a.txt"], first["b.txt"])
        checkpoints.take(self.work)
        self.assertEqual(len(self.blobs()), 2)       # nothing new the second time
        write(self.work / "a.txt", "changed")
        checkpoints.take(self.work)
        self.assertEqual(len(self.blobs()), 3)       # only the new contents

    def test_store_false_only_notes_the_hashes(self):
        write(self.work / "a.txt", "a")
        self.assertEqual(sorted(checkpoints.take(self.work, store=False)), ["a.txt"])
        self.assertEqual(self.blobs(), [])

    def test_python_caches_are_skipped(self):
        write(self.work / "scripts" / "totals.py", "print(1)")
        write(self.work / "scripts" / "__pycache__" / "totals.cpython-314.pyc", "cache")
        write(self.work / "stray.pyc", "cache")
        manifest = checkpoints.take(self.work)
        self.assertEqual(sorted(manifest), ["scripts/totals.py"])
        write(self.work / "scripts" / "__pycache__" / "more.pyc", "cache")
        self.assertEqual(checkpoints.changes(manifest, self.work)["delete"], [])  # never deleted either

    def test_a_workspace_too_big_to_keep(self):
        for i in range(4):
            write(self.work / f"f{i}.txt", "x" * 10)
        with mock.patch.object(checkpoints, "MAX_FILES", 3):
            self.assertIsNone(checkpoints.take(self.work))
        with mock.patch.object(checkpoints, "MAX_BYTES", 25):
            self.assertIsNone(checkpoints.take(self.work))
        with mock.patch.object(checkpoints, "MAX_FILES", 4), mock.patch.object(checkpoints, "MAX_BYTES", 40):
            self.assertEqual(len(checkpoints.take(self.work)), 4)  # at the limits is fine

    def test_it_stops_reading_once_past_a_limit(self):
        for i in range(10):
            write(self.work / f"f{i}.txt", str(i))
        read = []
        real = pathlib.Path.read_bytes
        with mock.patch.object(checkpoints, "MAX_FILES", 2), \
                mock.patch.object(pathlib.Path, "read_bytes", lambda p: (read.append(p.name), real(p))[1]):
            self.assertIsNone(checkpoints.take(self.work))
        self.assertEqual(len(read), 2)

    def test_a_file_it_cannot_read_is_listed_and_left_alone(self):
        write(self.work / "ok.txt", "ok")
        write(self.work / "locked.txt", "secret")
        real = pathlib.Path.read_bytes

        def read_bytes(p):
            if p.name == "locked.txt":
                raise PermissionError("in use")
            return real(p)
        with mock.patch.object(pathlib.Path, "read_bytes", read_bytes):
            manifest = checkpoints.take(self.work)
        self.assertIsNone(manifest["locked.txt"])
        self.assertIsNotNone(manifest["ok.txt"])
        write(self.work / "locked.txt", "changed since")
        self.assertEqual(checkpoints.changes(manifest, self.work), {"restore": [], "delete": []})
        checkpoints.restore(manifest, self.work)
        self.assertEqual((self.work / "locked.txt").read_text(encoding="utf-8"), "changed since")  # not deleted

    def test_a_missing_copy_changes_nothing(self):
        write(self.work / "a.txt", "a")
        manifest = checkpoints.take(self.work)
        write(self.work / "a.txt", "changed")
        write(self.work / "added.txt", "added")
        for blob in (self.store / "blobs").iterdir():
            blob.unlink()
        with self.assertRaises(FileNotFoundError):
            checkpoints.restore(manifest, self.work)
        self.assertEqual(files(self.work), {"a.txt": "changed", "added.txt": "added"})

    def test_a_path_outside_the_workspace_changes_nothing(self):
        write(self.work / "a.txt", "a")
        manifest = checkpoints.take(self.work)
        write(self.work / "added.txt", "added")
        damaged = {**manifest, "../escape.txt": manifest["a.txt"]}
        with self.assertRaisesRegex(ValueError, "not inside the workspace"):
            checkpoints.restore(damaged, self.work)
        self.assertEqual(files(self.work), {"a.txt": "a", "added.txt": "added"})  # checked before the first delete
        self.assertFalse((self.work.parent / "escape.txt").exists())

    def test_a_copy_name_that_is_not_a_hash_is_never_used(self):
        outside = pathlib.Path(tempfile.mkdtemp()) / "secret.txt"
        write(outside, "not a saved copy")
        write(self.work / "a.txt", "a")
        manifest = {"a.txt": f"../../{outside.parent.name}/secret.txt", "b.txt": "ABC"}
        self.assertEqual(checkpoints.readable(manifest), {"a.txt": None, "b.txt": None})
        self.assertEqual(checkpoints.changes(manifest, self.work), {"restore": [], "delete": []})
        checkpoints.restore(manifest, self.work)
        self.assertEqual(files(self.work), {"a.txt": "a"})  # left as it is, like a file that couldn't be read
        with self.assertRaises(ValueError):
            checkpoints._blob("../x")

    def test_a_hard_link_is_replaced_not_written_through(self):
        write(self.work / "notes.md", "old notes")
        manifest = checkpoints.take(self.work)
        outside = pathlib.Path(tempfile.mkdtemp()) / "elsewhere.txt"
        write(outside, "a file outside the workspace")
        (self.work / "notes.md").unlink()
        os.link(outside, self.work / "notes.md")  # the same file under two names
        checkpoints.restore(manifest, self.work)
        self.assertEqual(outside.read_text(encoding="utf-8"), "a file outside the workspace")
        self.assertEqual(files(self.work), {"notes.md": "old notes"})

    def test_a_file_that_cannot_be_changed_stops_it_and_trying_again_finishes(self):
        write(self.work / "a.txt", "a")
        write(self.work / "b.txt", "b")
        manifest = checkpoints.take(self.work)
        write(self.work / "a.txt", "changed")
        write(self.work / "b.txt", "changed")
        write(self.work / "added.txt", "added")
        real = os.replace

        def locked(src, dst):  # b.txt is open in another program
            if pathlib.Path(dst).name == "b.txt":
                raise PermissionError(13, "The process cannot access the file because it is being used by another process")
            return real(src, dst)
        with mock.patch.object(checkpoints.os, "replace", locked):
            with self.assertRaises(checkpoints.RestoreError) as caught:
                checkpoints.restore(manifest, self.work)
        self.assertEqual(caught.exception.rel, "b.txt")
        self.assertEqual(files(self.work), {"a.txt": "a", "b.txt": "changed"})  # no temporary file left behind
        done = checkpoints.restore(manifest, self.work)  # closed: again, and it finishes the job
        self.assertEqual(done, {"restore": ["b.txt"], "delete": []})
        self.assertEqual(files(self.work), {"a.txt": "a", "b.txt": "b"})

    def test_purge_keeps_the_copies_a_manifest_points_to(self):
        write(self.work / "a.txt", "kept")
        kept = checkpoints.take(self.work)
        write(self.work / "a.txt", "dropped")
        checkpoints.take(self.work)
        (self.store / "blobs" / "abc.1234.tmp").write_text("left by a crash", encoding="utf-8")
        self.assertEqual(len(self.blobs()), 3)
        self.assertEqual(checkpoints.purge([kept, None, {"x.txt": None}]), 2)
        self.assertEqual(self.blobs(), [kept["a.txt"]])

    def test_purge_counts_deleted_conversations(self):
        old_dir = conversations.DIR
        conversations.DIR = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(setattr, conversations, "DIR", old_dir)
        write(self.work / "a.txt", "in a deleted conversation")
        gone = checkpoints.take(self.work)
        write(self.work / "a.txt", "in a live one")
        live = checkpoints.take(self.work)
        write(self.work / "a.txt", "in none")
        checkpoints.take(self.work)
        conversations.save("20260101-000000-aaaaaa", "deleted", [], [], checkpoints={"1": gone})
        conversations.delete("20260101-000000-aaaaaa")
        conversations.save("20260101-000000-bbbbbb", "live", [], [], checkpoints={"1": live, "after": None})
        conversations.save("20260101-000000-cccccc", "older", [], [])  # saved before Rewind: no checkpoints
        self.assertEqual(checkpoints.purge(conversations.all_checkpoints()), 1)
        self.assertEqual(self.blobs(), sorted([gone["a.txt"], live["a.txt"]]))
        # A damaged file stops the purge rather than lose copies it may need
        (conversations.DIR / "20260101-000000-dddddd.json").write_text("{not json", encoding="utf-8")
        with self.assertRaises(ValueError):
            conversations.all_checkpoints()


# --- Session: going back to before a message -------------------------------------------------------------

def text(t):
    return TextBlock(type="text", text=t)


def tool_use(id, name, **input):
    return ToolUseBlock(type="tool_use", id=id, name=name, input=input)


def reply(stop_reason, *content):
    return NS(stop_reason=stop_reason, content=list(content))


class FakeClient:
    def __init__(self, *replies, gate=None):
        self.replies = list(replies)
        self.gate = gate
        self.sent = []  # each call's request
        self.messages = self

    def create(self, **kwargs):
        if self.gate:
            self.gate.wait(5)
        self.sent.append(kwargs)
        return self.replies.pop(0)


class RewindBase(Copies):
    def setUp(self):
        super().setUp()
        here = pathlib.Path(tempfile.mkdtemp())
        self.settings = here / "lab_settings.json"
        lab_settings.save({"run_code": {"enabled": True},
                           "permissions": {"write_file": "allow", "run_python": "allow", "remember_fact": "allow"}},
                          loop.SYSTEM, tools.TOOLS, loop.default_permission, self.settings)
        self.profile = here / "profile.json"
        write(self.work / "notes.md", "# Notes\n- launch on 15 October\n")

    def session(self, *replies, gate=None):
        return web_server.Session(FakeClient(*replies, gate=gate), "test", settings_path=self.settings,
                                  profile_path=self.profile)

    def send(self, s, message):
        """Send a message and allow anything that asks (a write outside the workspace asks first)."""
        self.assertTrue(s.start(message))
        end = time.time() + 15
        while s.running and time.time() < end:
            events = s.snapshot(0)["events"]
            decided = {e["id"] for e in events if e["kind"] == "decision"}
            for a in [e for e in events if e["kind"] == "approval" and e["id"] not in decided]:
                s.decide(a["id"], True)
            time.sleep(0.01)
        self.assertFalse(s.running, f"{message!r} did not finish")

    def seq_of(self, s, n):
        return [e["seq"] for e in s.events if e["kind"] == "user"][n - 1]

    def two_messages(self):
        s = self.session(reply("end_turn", text("Hello.")),
                         reply("tool_use", tool_use("w1", "write_file", path="notes.md", content="# Notes\nRewind test\n")),
                         reply("end_turn", text("Added.")))
        self.send(s, "hi")
        self.send(s, "Add the line 'Rewind test' to the end of notes.md")
        return s


class RewindTests(RewindBase):
    def test_a_rewind_puts_the_file_back_and_cuts_the_conversation(self):
        s = self.two_messages()
        self.assertEqual(files(self.work)["notes.md"], "# Notes\nRewind test\n")
        self.assertEqual(sorted(s.checkpoints), ["1", "2", "after"])
        self.assertEqual(s.snapshot(0)["rewindable"], [self.seq_of(s, 1), self.seq_of(s, 2)])
        seq = self.seq_of(s, 2)
        history_then = s.messages[:2]  # message 1 and its answer
        gen = s.generation

        preview = s.rewind_preview(seq)
        self.assertEqual((preview["message"], preview["messages"], preview["text"]),
                         (2, 1, "Add the line 'Rewind test' to the end of notes.md"))
        self.assertEqual(preview["files"], {"restore": ["notes.md"], "delete": []})
        self.assertEqual((preview["edited"], preview["cannot_undo"], preview["unreadable"]), ([], [], []))
        self.assertEqual(files(self.work)["notes.md"], "# Notes\nRewind test\n")  # a preview changes nothing

        done = s.rewind(seq)
        self.assertEqual(done, {"text": "Add the line 'Rewind test' to the end of notes.md", "files": True,
                                "restored": 1, "deleted": 0})
        self.assertEqual(files(self.work)["notes.md"], "# Notes\n- launch on 15 October\n")
        self.assertEqual(s.messages, history_then)
        self.assertEqual([e["kind"] for e in s.events], ["user", "request", "response", "answer", "done"])
        self.assertEqual(len(s.events), seq)
        self.assertEqual((s.msg, s.generation), (1, gen + 1))  # the page throws away what it holds
        self.assertEqual(sorted(s.checkpoints), ["1", "after"])
        self.assertEqual(s.checkpoints["after"], checkpoints.take(self.work, store=False))
        saved = conversations.load(s.conv_id)  # saved at once
        self.assertEqual(len(saved["events"]), seq)
        self.assertEqual(len(saved["messages"]), 2)
        self.assertEqual(sorted(saved["checkpoints"]), ["1", "after"])

        # The next message is number 2 again, with a checkpoint of its own
        s.client.replies = [reply("end_turn", text("Again."))]
        self.send(s, "something else")
        self.assertEqual(s.events[-1]["msg"], 2)
        self.assertEqual(sorted(s.checkpoints), ["1", "2", "after"])

    def test_a_file_that_cannot_be_changed_is_refused_in_words_and_trying_again_finishes(self):
        s = self.two_messages()
        seq = self.seq_of(s, 2)
        before = (list(s.messages), list(s.events), s.msg, dict(s.checkpoints))
        real = os.replace

        def locked(src, dst):  # notes.md is open in another program
            if pathlib.Path(dst).name == "notes.md":
                raise PermissionError(13, "The process cannot access the file because it is being used by another process")
            return real(src, dst)
        with mock.patch.object(checkpoints.os, "replace", locked):
            with self.assertRaises(web_server.CannotRewind) as caught:
                s.rewind(seq)
        self.assertIn("Couldn't change notes.md", str(caught.exception))
        self.assertIn("close it and press Rewind again", str(caught.exception))
        self.assertEqual((s.messages, s.events, s.msg, s.checkpoints), before)  # the conversation isn't cut
        self.assertEqual(files(self.work), {"notes.md": "# Notes\nRewind test\n"})
        done = s.rewind(seq)  # closed now: the same rewind again
        self.assertEqual((done["restored"], done["deleted"]), (1, 0))
        self.assertEqual(files(self.work), {"notes.md": "# Notes\n- launch on 15 October\n"})
        self.assertEqual(s.msg, 1)

    def test_a_path_that_now_leads_outside_is_refused_in_words(self):
        s = self.two_messages()  # (a link needs extra rights on Windows: the check itself is tested above)
        before = (list(s.messages), s.msg)
        with mock.patch.object(checkpoints, "_inside", side_effect=ValueError("notes.md is not inside the workspace")):
            with self.assertRaises(web_server.CannotRewind) as caught:
                s.rewind(self.seq_of(s, 2))
        self.assertIn("notes.md is not inside the workspace", str(caught.exception))
        self.assertIn("nothing was changed. Remove the link and try again", str(caught.exception))
        self.assertEqual((s.messages, s.msg), before)

    def test_a_rewind_drops_the_tools_the_removed_messages_found(self):
        lab_settings.save({"extra_tools": {"enabled": True, "mode": "find"}}, loop.SYSTEM, tools.TOOLS,
                          loop.default_permission, self.settings)
        book = {"room": "B", "date": "2026-10-14", "start_time": "15:00", "people": 4}
        s = self.session(reply("end_turn", text("Hello.")),
                         reply("tool_use", tool_use("f1", "find_tool", query="book a meeting room")),
                         reply("tool_use", tool_use("b1", "book_room", **book)),
                         reply("end_turn", text("Booked.")))
        self.send(s, "hi")
        self.send(s, "Book meeting room B for 3pm tomorrow for 4 people.")
        self.assertIn("book_room", s._toolbox.loaded)
        s.rewind(self.seq_of(s, 2))
        s.client.replies = [reply("end_turn", text("Sure."))]
        self.send(s, "Book meeting room B for 3pm tomorrow for 4 people.")
        names = [t["name"] for t in s.client.sent[-1]["tools"]]
        self.assertIn("find_tool", names)
        self.assertNotIn("book_room", names)  # message 2's first call is as it was the first time

    def test_a_reopened_conversation_can_be_rewound(self):
        s = self.two_messages()
        other = self.session()
        self.assertTrue(other.open(s.conv_id))
        self.assertEqual(sorted(other.checkpoints), ["1", "2", "after"])
        self.assertEqual(other.rewind(self.seq_of(other, 2))["restored"], 1)
        self.assertEqual(files(self.work)["notes.md"], "# Notes\n- launch on 15 October\n")
        self.assertTrue(other.reset())
        self.assertEqual(other.checkpoints, {})

    def test_refused_while_a_message_runs(self):
        s = self.two_messages()
        gate = threading.Event()
        s.client = FakeClient(reply("end_turn", text("slow")), gate=gate)
        s.start("third")
        try:
            for go in (s.rewind_preview, s.rewind):
                with self.assertRaises(web_server.CannotRewind) as caught:
                    go(self.seq_of(s, 2))
                self.assertIn("Wait for the current message to finish", str(caught.exception))
        finally:
            gate.set()
        end = time.time() + 5
        while s.running and time.time() < end:
            time.sleep(0.01)
        self.assertEqual(files(self.work)["notes.md"], "# Notes\nRewind test\n")  # untouched

    def test_refused_when_a_summary_replaced_the_history(self):
        s = self.two_messages()
        # what summarising does: the older messages give way to a summary
        s.messages[:2] = [{"role": "user", "content": "[Summary of the conversation so far] They said hi."},
                          {"role": "assistant", "content": "Understood."}]
        with self.assertRaises(web_server.CannotRewind) as caught:
            s.rewind_preview(self.seq_of(s, 1))
        self.assertIn("summary", str(caught.exception))
        s.rewind_preview(self.seq_of(s, 2))  # (a later message is still there to go back to)

    def test_refused_for_a_conversation_saved_before_rewind(self):
        cid = conversations.new_id()
        conversations.save(cid, "old", [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "Hello."}],
                           [{"seq": 0, "kind": "user", "time": 1, "msg": 1, "text": "hi"},
                            {"seq": 1, "kind": "done", "time": 2, "msg": 1}])
        s = self.session()
        s.open(cid)
        self.assertEqual(s.snapshot(0)["rewindable"], [])
        with self.assertRaises(web_server.CannotRewind) as caught:
            s.rewind_preview(0)
        self.assertIn("no checkpoint", str(caught.exception))
        with self.assertRaises(KeyError):
            s.rewind_preview(1)  # not one of your messages

    def test_your_own_edits_since_the_last_reply_are_named(self):
        s = self.two_messages()
        write(self.work / "notes.md", "# Notes\nRewind test\nand a line I typed\n")
        write(self.work / "mine.txt", "I made this")
        write(self.work / "other.txt", "")
        preview = s.rewind_preview(self.seq_of(s, 2))
        self.assertEqual(preview["files"], {"restore": ["notes.md"], "delete": ["mine.txt", "other.txt"]})
        self.assertEqual(preview["edited"], ["mine.txt", "notes.md", "other.txt"])

    def test_what_cannot_be_undone(self):
        elsewhere = pathlib.Path(tempfile.mkdtemp()) / "out.txt"
        s = self.session(
            reply("tool_use", tool_use("g1", "get_weather", city="Paris"),
                  tool_use("m1", "remember_fact", label="City", value="Paris"),
                  tool_use("o1", "write_file", path=str(elsewhere), content="outside"),
                  tool_use("p1", "run_python", code="print(1)"),
                  tool_use("c1", "calculate", expression="1+1")),
            reply("end_turn", text("Done.")))
        with mock.patch.object(s, "tool_source", lambda name: "demo server" if name == "calculate" else "built in"):
            self.send(s, "do it all")
            preview = s.rewind_preview(self.seq_of(s, 1))
        self.assertEqual([x["tool"] for x in preview["cannot_undo"]],
                         ["get_weather", "remember_fact", "write_file", "run_python", "calculate"])
        why = {x["tool"]: x["why"] for x in preview["cannot_undo"]}
        self.assertIn("web request", why["get_weather"])
        self.assertIn('"City" stays in Memory', why["remember_fact"])
        self.assertIn(str(elsewhere), why["write_file"])
        self.assertIn("outside the workspace", why["run_python"])
        self.assertIn("MCP", why["calculate"])
        self.assertTrue(elsewhere.exists())

    def test_a_tool_that_never_ran_is_not_listed(self):
        s = self.session(reply("tool_use", tool_use("g1", "get_weather", city="Paris")), reply("end_turn", text("No.")))
        lab_settings.save({"permissions": {"get_weather": "block"}}, loop.SYSTEM, tools.TOOLS, loop.default_permission,
                          self.settings)
        self.send(s, "weather?")
        self.assertEqual(s.rewind_preview(self.seq_of(s, 1))["cannot_undo"], [])

    def test_a_file_run_python_made_is_deleted(self):
        code = ("import pathlib\n"
                "pathlib.Path('made').mkdir()\n"
                "pathlib.Path('made/by_code.txt').write_text('from a script')\n")
        s = self.session(reply("tool_use", tool_use("p1", "run_python", code=code)), reply("end_turn", text("Made it.")))
        self.send(s, "make a file with code")
        self.assertEqual(files(self.work).get("made/by_code.txt"), "from a script")
        preview = s.rewind_preview(self.seq_of(s, 1))
        self.assertEqual(preview["files"], {"restore": [], "delete": ["made/by_code.txt"]})
        self.assertEqual(s.rewind(self.seq_of(s, 1)), {"text": "make a file with code", "files": True,
                                                       "restored": 0, "deleted": 1})
        self.assertEqual(files(self.work), {"notes.md": "# Notes\n- launch on 15 October\n"})
        self.assertFalse((self.work / "made").exists())
        self.assertEqual((s.messages, s.events, s.msg), ([], [], 0))

    def test_a_workspace_too_big_still_rewinds_the_messages(self):
        with mock.patch.object(checkpoints, "MAX_FILES", 0):
            s = self.two_messages()
        self.assertIsNone(s.checkpoints["2"])
        self.assertEqual(s.snapshot(0)["rewindable"], [self.seq_of(s, 1), self.seq_of(s, 2)])
        preview = s.rewind_preview(self.seq_of(s, 2))
        self.assertIsNone(preview["files"])
        done = s.rewind(self.seq_of(s, 2))
        self.assertEqual((done["files"], done["restored"]), (False, 0))
        self.assertEqual(files(self.work)["notes.md"], "# Notes\nRewind test\n")  # left as it was
        self.assertEqual(s.msg, 1)
        self.assertNotIn("after", s.checkpoints)

    def test_with_checkpoints_off_nothing_is_kept(self):
        with mock.patch.object(checkpoints, "ON", False):
            s = self.two_messages()
        self.assertEqual(s.checkpoints, {})
        self.assertNotIn("checkpoints", conversations.load(s.conv_id))


class RewindHttpTests(RewindBase):
    def call(self, port, path, body):
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
        conn.request("POST", path, body=json.dumps(body),
                     headers={"Host": f"localhost:{port}", "Content-Type": "application/json"})
        r = conn.getresponse()
        data = json.loads(r.read())
        conn.close()
        return r.status, data

    def test_the_routes(self):
        s = self.two_messages()
        server = web_server.make_server(s, 0)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        port = server.server_port
        seq = self.seq_of(s, 2)
        self.assertEqual(self.call(port, "/rewind/preview", {})[0], 400)
        self.assertEqual(self.call(port, "/rewind/preview", {"seq": 999})[0], 404)
        status, preview = self.call(port, "/rewind/preview", {"seq": seq})
        self.assertEqual((status, preview["files"]["restore"]), (200, ["notes.md"]))
        status, done = self.call(port, "/rewind", {"seq": seq})
        self.assertEqual((status, done["restored"], done["text"]),
                         (200, 1, "Add the line 'Rewind test' to the end of notes.md"))
        status, refused = self.call(port, "/rewind", {"seq": seq})  # that message is gone now
        self.assertEqual(status, 404)
        with mock.patch.object(checkpoints, "restore", side_effect=checkpoints.RestoreError(
                "budget.csv", PermissionError(13, "Access is denied"))):
            status, refused = self.call(port, "/rewind", {"seq": self.seq_of(s, 1)})
        self.assertEqual(status, 409)  # in words, not "the server hit an error"
        self.assertIn("Couldn't change budget.csv (Access is denied)", refused["error"])
        s.messages.clear()  # as if a summary had replaced everything
        status, refused = self.call(port, "/rewind", {"seq": self.seq_of(s, 1)})
        self.assertEqual(status, 409)
        self.assertIn("summary", refused["error"])


if __name__ == "__main__":
    unittest.main()
