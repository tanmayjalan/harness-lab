"""Checkpoints: a saved copy of the workspace's files before each message, so a rewind can undo them.

Going back to before message N means two things. Cutting the conversation is the easy part: drop the
messages from N on. But the tools changed files on the way, and those changes are real. So before
each message the harness notes every file in the workspace and keeps a copy of its contents. Going
back puts those files back as they were, and deletes the files that were added since.

A checkpoint is a manifest, {relative path: sha256 of the contents}. The contents themselves are kept
once each, named by their hash, in DIR/blobs/: a file that doesn't change between messages costs
nothing more. A file that couldn't be read is listed with None: a rewind leaves it as it is.

What a checkpoint can't undo: anything outside the workspace. A web request already sent, a fact
saved in Memory, a tool in another program (MCP), a script that wrote elsewhere: those stay done.
"""
import hashlib
import os
import pathlib
import re
import stat
import uuid

from harness import paths

DIR = paths.DATA / "checkpoints"
ON = True                    # tests turn it off (their workspace is the whole temp folder); see tests/isolate.py
MAX_FILES = 5_000            # a workspace bigger than this isn't copied: a rewind then can't undo its files
MAX_BYTES = 50 * 1024 * 1024
SKIP_FOLDERS = {"__pycache__"}  # Python's own caches: made again whenever they're needed
SKIP_SUFFIXES = {".pyc"}


LINK_TAGS = (stat.IO_REPARSE_TAG_SYMLINK, stat.IO_REPARSE_TAG_MOUNT_POINT)  # Windows' marks for a link, a junction


def _is_link(path):
    """A shortcut to somewhere else (a symbolic link, or a Windows junction): never followed or changed.
    Read from the file system's own mark, so it works on Python 3.10 too, which has no os.path.isjunction and
    doesn't call a junction a link."""
    try:
        st = os.lstat(path)
    except OSError:
        return False
    return stat.S_ISLNK(st.st_mode) or getattr(st, "st_reparse_tag", 0) in LINK_TAGS


def files(workspace):
    """Each file to keep, as (relative path with / separators, full path), in a fixed order. Shortcuts
    (links and junctions) are skipped, so nothing outside the workspace is reached. search_files uses it too."""
    root = pathlib.Path(workspace)
    for folder, dirs, names in os.walk(root):  # (os.walk doesn't go into linked folders)
        here = pathlib.Path(folder)
        dirs[:] = sorted(d for d in dirs if d not in SKIP_FOLDERS and not _is_link(here / d))
        for name in sorted(names):
            path = here / name
            if path.suffix in SKIP_SUFFIXES or _is_link(path):
                continue
            yield path.relative_to(root).as_posix(), path


def _valid(digest):
    """A copy's name: exactly 64 hex characters (a sha256). Anything else, from a damaged or edited
    conversation file, could point outside the copies' folder, so it is never used."""
    return isinstance(digest, str) and re.fullmatch(r"[0-9a-f]{64}", digest) is not None


def _blob(digest):
    if not _valid(digest):
        raise ValueError(f"{digest!r} isn't the name of a saved copy")
    return DIR / "blobs" / digest


def readable(manifest):
    """The manifest with every copy name checked: a name that isn't a sha256 counts as unreadable (None),
    so the file is left as it is, like a file that couldn't be read when it was saved."""
    return {rel: digest if _valid(digest) else None for rel, digest in manifest.items()}


def _keep(digest, data):
    path = _blob(digest)
    if path.exists():
        return  # the same contents are already kept
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{digest}.{uuid.uuid4().hex[:8]}.tmp")
    tmp.write_bytes(data)
    tmp.replace(path)  # write-then-rename, so a crash can't leave half a copy under the real name


def _scan(workspace, store, capped):
    """The manifest of the workspace as it is now. With `capped`, None once it passes either limit."""
    manifest, count, size = {}, 0, 0
    for rel, path in files(workspace):
        try:
            count += 1
            size += path.stat().st_size
            if capped and (count > MAX_FILES or size > MAX_BYTES):
                return None  # stop at once: no point reading the rest
            data = path.read_bytes()
        except OSError:
            manifest[rel] = None  # couldn't read it: listed, and left as it is
            continue
        digest = hashlib.sha256(data).hexdigest()
        if store:
            _keep(digest, data)
        manifest[rel] = digest
    return manifest


def take(workspace, store=True):
    """Note every file in the workspace and keep a copy of any contents not kept yet.

    Returns {relative path: sha256}, or None when the workspace is too big to keep (over MAX_FILES files
    or MAX_BYTES bytes). `store=False` only notes the hashes (to spot changes later, nothing to restore)."""
    return _scan(workspace, store=store, capped=True)


def changes(manifest, workspace):
    """What going back to `manifest` would do: {"restore": [changed or removed files], "delete": [added files]}."""
    manifest = readable(manifest)  # (a damaged copy name: the file is left as it is)
    now = _scan(workspace, store=False, capped=False)
    return {"restore": sorted(rel for rel, digest in manifest.items() if digest is not None and now.get(rel) != digest),
            "delete": sorted(rel for rel in now if rel not in manifest)}


def _inside(root, rel):
    path = (root / rel).resolve()
    if path == root or not path.is_relative_to(root):
        raise ValueError(f"{rel} is not inside the workspace")  # never write or delete anywhere else
    return path


class RestoreError(Exception):
    """A file in the workspace couldn't be changed (open in another program, say). `rel` names it and
    `error` is the system's reason. The files before it are already done; restore() again finishes the job."""

    def __init__(self, rel, error):
        super().__init__(f"{rel}: {error}")
        self.rel, self.error = rel, error


def _put_back(path, data):
    """Write a file's old contents: to a temporary name next to it, then renamed over it. So a hard link
    to a file elsewhere is replaced, never written through, and a file is never left half written."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.rewind")
    try:
        tmp.write_bytes(data)
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)  # (or it would show up as a file added since)
        raise


def restore(manifest, workspace):
    """Put the workspace back as `manifest` says: changed and removed files get their old contents back,
    added files are deleted, and folders left empty by those deletions are removed.

    Everything is checked before anything changes: every kept copy is there (FileNotFoundError) and every
    path is inside the workspace (ValueError). Then a file that can't be changed stops it with RestoreError,
    naming the file. Running it again is safe and finishes the job: it only does what is still different.
    Returns what it did, like changes()."""
    root = pathlib.Path(workspace).resolve()
    manifest = readable(manifest)
    todo = changes(manifest, workspace)
    missing = [rel for rel in todo["restore"] if not _blob(manifest[rel]).is_file()]
    if missing:
        raise FileNotFoundError(f"the saved copy of {', '.join(missing)} is missing")
    deletes = [(rel, _inside(root, rel)) for rel in todo["delete"]]
    restores = [(rel, _inside(root, rel)) for rel in todo["restore"]]
    emptied = set()
    for rel, path in deletes:  # deletions first: a folder may stand where a file has to go back
        try:
            path.unlink(missing_ok=True)
        except OSError as e:
            raise RestoreError(rel, e) from e
        emptied.add(path.parent)
    for folder in sorted(emptied, key=lambda p: len(p.parts), reverse=True):  # deepest first
        try:
            while folder != root and folder.is_relative_to(root) and folder.is_dir() and not any(folder.iterdir()):
                folder.rmdir()
                folder = folder.parent
        except OSError:
            continue  # an empty folder left behind does no harm
    for rel, path in restores:
        try:
            _put_back(path, _blob(manifest[rel]).read_bytes())
        except OSError as e:
            raise RestoreError(rel, e) from e
    return todo


def purge(referenced):
    """Delete the kept copies no manifest points to. `referenced`: every manifest still kept (each
    conversation's checkpoints, deleted ones too, so Undo on a delete still has its copies).
    Returns how many went."""
    keep = {digest for manifest in referenced if manifest for digest in manifest.values() if digest}
    blobs = DIR / "blobs"
    if not blobs.is_dir():
        return 0
    removed = 0
    for path in blobs.iterdir():
        if path.name not in keep:  # (also a .tmp left by a crash)
            try:
                path.unlink()
                removed += 1
            except OSError:
                continue
    return removed
