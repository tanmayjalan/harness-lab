"""Offline tests for saving.py: saving a file safely, and what happens to one that can't be read.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import pathlib
import tempfile
import threading
import unittest

from harness import saving
from harness.features import lab_settings, memory


def tmp(name):
    return pathlib.Path(tempfile.mkdtemp()) / name


class InsideTests(unittest.TestCase):
    # A saved file named from a request (a conversation's id, say) can only ever be one of its folder's own
    # files: anything that would lead out of the folder is refused
    def test_a_name_can_only_lead_to_a_file_in_the_folder(self):
        folder = pathlib.Path(tempfile.mkdtemp())
        self.assertEqual(saving.inside(folder, "20261023-120000-abc123.json"), folder / "20261023-120000-abc123.json")
        for name in ["../x.json", "a/../../x.json", "..\\x.json", "C:\\Windows\\win.ini", "\\\\host\\share\\x",
                     "/etc/passwd", "", "."]:
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    saving.inside(folder, name)


class SavingTests(unittest.TestCase):
    def setUp(self):
        saving.DAMAGED.clear()
        self.addCleanup(saving.DAMAGED.clear)

    # Two loads at the same moment (Compare's sides, say) both find the file damaged: the first moves it aside,
    # and the second must not fail because it has already gone
    def test_a_file_already_moved_aside_is_not_an_error(self):
        self.assertIsNone(saving.set_aside(tmp("gone.json"), "test"))

    def test_two_loads_of_a_damaged_file_at_once_both_get_the_defaults(self):
        path = tmp("profile.json")
        path.write_text("{ broken", encoding="utf-8")
        results, errors = [], []

        def load():
            try:
                results.append(memory.load(path))
            except Exception as e:  # noqa: BLE001  (any failure is the bug)
                errors.append(repr(e))
        threads = [threading.Thread(target=load) for _ in range(2)]
        with saving.lock_for(path):  # both wait here, then run one after the other
            for t in threads:
                t.start()
        for t in threads:
            t.join()
        self.assertEqual(errors, [])
        self.assertEqual(len(results), 2)
        self.assertEqual(len(list(path.parent.glob("profile.damaged-*.json"))), 1)
        self.assertEqual(len(saving.notes()), 1)

    # Once the file is saved again, the note about it goes: it would say "the defaults are used" for ever
    def test_the_note_goes_once_the_file_is_saved_again(self):
        path = tmp("lab_settings.json")
        path.write_text("{ broken", encoding="utf-8")
        lab_settings.load(path)
        self.assertEqual(len(saving.notes()), 1)
        saving.write_text(path, "{}")
        self.assertEqual(saving.notes(), [])

    def test_a_file_damaged_twice_has_one_note(self):
        path = tmp("lab_settings.json")
        for _ in range(2):
            path.write_text("{ broken", encoding="utf-8")
            lab_settings.load(path)
        self.assertEqual(len(saving.notes()), 1)

    # Each file has its own lock: one file being saved (or retried, while a virus scanner holds it) must not
    # hold up reading another
    def test_one_file_being_saved_does_not_hold_up_another(self):
        a, b = tmp("a.json"), tmp("profile.json")
        done = threading.Event()
        with saving.lock_for(a):
            threading.Thread(target=lambda: (memory.load(b), done.set())).start()
            self.assertTrue(done.wait(5))
