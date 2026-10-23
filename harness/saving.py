"""Saving a file safely, even when two saves happen at the same moment (Compare and evals run questions
side by side, and a Settings change can land while a reply is saving).

Each save writes a temporary file with its own name, then renames it over the real one, so a crash can't
leave half a file and two saves never write into the same temporary file. Each file has its own lock
(lock_for): a read, change and save (load the facts, add one, save them) holds it, so no change is lost,
and a slow save of one file never holds up another.
"""
import os
import pathlib
import threading
import time
import uuid

_locks = {}
_locks_lock = threading.Lock()
DAMAGED = {}  # file → what set_aside did to it, in words, for the page to show (until it is saved again)


def _key(path):
    return os.path.normcase(os.path.abspath(path))


def lock_for(path):
    """The lock for one file. Re-entrant: a save inside a locked read-change-save takes it again."""
    with _locks_lock:
        return _locks.setdefault(_key(path), threading.RLock())


def notes():
    """What happened to each saved file that couldn't be read, in words."""
    return list(DAMAGED.values())


def inside(folder, name):
    """folder/name, for a saved file named from a request (a conversation's id, say). Refused (ValueError) if
    the name would lead anywhere but a file of that folder: "..", a slash, a drive or another computer."""
    base = os.path.normpath(os.path.abspath(folder))
    path = os.path.normpath(os.path.join(base, name))
    if not path.startswith(base + os.sep) or os.path.dirname(path) != base:
        raise ValueError(f"{name!r} isn't a file in {folder}")
    return pathlib.Path(path)


def read_text(path):
    """A saved file's text (not while a save is renaming it into place). FileNotFoundError if there's none."""
    with lock_for(path):
        return pathlib.Path(path).read_text(encoding="utf-8")


def set_aside(path, why):
    """A saved file that can't be read: move it aside (kept, so you can fix it or copy from it) instead of
    failing every message, or letting the next save overwrite it. The caller then uses the defaults.
    Returns where it went, or None if it was already gone (moved aside by a load at the same moment)."""
    path = pathlib.Path(path)
    aside = path.with_name(f"{path.stem}.damaged-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:4]}{path.suffix}")
    with lock_for(path):
        try:
            os.replace(path, aside)
        except FileNotFoundError:
            return None
    note = f"{path.name} couldn't be read ({why}), so it was moved to {aside.name} and the defaults are used."
    DAMAGED[_key(path)] = note
    print(f"  !! {note}")
    return aside


def settled(path):
    """The file is fine again (saved, or removed to go back to the defaults): drop its note."""
    DAMAGED.pop(_key(path), None)


def write_text(path, text):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)  # data/ may not exist yet
    tmp = path.with_name(f"{path.name}.{uuid.uuid4().hex[:8]}.tmp")
    try:
        tmp.write_text(text, encoding="utf-8")
        with lock_for(path):
            for attempt in range(20):
                try:
                    os.replace(tmp, path)
                    break
                except PermissionError:  # Windows: another program (a virus scanner, say) has the file open
                    if attempt == 19:
                        raise
                    time.sleep(0.05)
        settled(path)
    finally:
        tmp.unlink(missing_ok=True)  # (already gone once renamed)
