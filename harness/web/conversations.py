"""Saved conversations: one JSON file each in the conversations folder.

Each file keeps the history the model is sent (messages) and the list of
steps the web page draws (events), so a conversation can be reopened
exactly as it was and continued.
"""
import json
import pathlib
import re
import time
import uuid

from harness import paths
from harness.features import lab_settings

DIR = paths.DATA / "conversations"
_ID = re.compile(r"^[0-9a-z-]{8,40}$")  # what new_id() makes; anything else is refused


def new_id():
    return time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]


def _file(conv_id):
    if not isinstance(conv_id, str) or not _ID.match(conv_id):
        raise ValueError("not a conversation id")  # also stops paths like ../../somewhere
    return DIR / f"{conv_id}.json"


def save(conv_id, title, messages, events, frozen=None, kind=None, origin=None, checkpoints=None):
    """`frozen`: the system prompt and tools this conversation keeps, when edits apply per conversation.
    `checkpoints`: the workspace's files before each message ({"1": manifest, ..., "after": manifest}),
    so Rewind can undo them (features/checkpoints.py)."""
    DIR.mkdir(parents=True, exist_ok=True)  # data/ may not exist yet
    path = _file(conv_id)
    created = time.time()
    if path.exists():
        created = json.loads(path.read_text(encoding="utf-8")).get("created", created)
    data = {"id": conv_id, "title": title, "created": created, "updated": time.time(),
            "runs": runs(events), "messages": messages, "events": events}
    if frozen:
        data["frozen"] = frozen
    if kind:
        data["kind"] = kind  # e.g. "compare": one side of a comparison, kept for inspecting
    if origin:
        data["origin"] = origin  # e.g. {"comparison": id, "side": "A"}: where it came from
    if checkpoints:
        data["checkpoints"] = checkpoints
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)  # write-then-rename, so a crash can't leave a half-written file


def load(conv_id):
    return json.loads(_file(conv_id).read_text(encoding="utf-8"))


def delete(conv_id):
    """Move it aside (to .deleted/), so Undo can bring it back; it no longer lists."""
    path = _file(conv_id)
    if not path.exists():
        return
    trash = DIR / ".deleted"
    trash.mkdir(parents=True, exist_ok=True)
    path.replace(trash / path.name)


def purge_deleted(days=7, now=None):
    """Remove deleted conversations older than `days` for good. Returns how many went."""
    trash = DIR / ".deleted"
    if not trash.exists():
        return 0
    cutoff = (now or time.time()) - days * 86400
    removed = 0
    for path in trash.glob("*.json"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
                removed += 1
        except OSError:
            continue
    return removed


def all_checkpoints():
    """Every checkpoint manifest kept by any conversation, the deleted ones (.deleted/) too, for
    checkpoints.purge. A file that can't be read raises (ValueError or OSError): better to keep every copy
    than to delete one a damaged file still needs."""
    found = []
    for path in [*DIR.glob("*.json"), *(DIR / ".deleted").glob("*.json")] if DIR.exists() else []:
        kept = json.loads(path.read_text(encoding="utf-8")).get("checkpoints") or {}
        if not isinstance(kept, dict):
            raise ValueError(f"{path.name}: checkpoints is not an object")
        found.extend(kept.values())
    return found


def restore(conv_id):
    """Undo a delete. False if there is nothing to bring back."""
    try:
        path = _file(conv_id)
    except ValueError:
        return False
    kept = DIR / ".deleted" / path.name
    if not kept.exists():
        return False
    kept.replace(path)
    return True


def runs(events):
    """One entry per message you sent: when, what, and the settings its first call used.

    The settings (`config`) come from the request event, minus the system prompt itself
    (kept in the events already); None for files saved before requests carried them.
    """
    out = []
    for e in events:
        if e.get("kind") == "user":
            out.append({"seq": e["seq"], "time": e["time"], "text": e.get("text", "")[:80], "config": None})
        elif e.get("kind") == "request" and out and out[-1]["config"] is None and e.get("config"):
            out[-1]["config"] = {k: v for k, v in e["config"].items() if k != "system"}
    return out


def list_all():
    """Newest first: id, title, when it was last used, how many messages, and the setup it last used."""
    items = []
    for path in DIR.glob("*.json") if DIR.exists() else []:
        try:
            d = json.loads(path.read_text(encoding="utf-8"))
            rs = d.get("runs") or runs(d.get("events", []))  # older files: work it out
            last = next((r["config"] for r in reversed(rs) if r.get("config")), None)
            items.append({"id": d["id"], "title": d["title"], "updated": d["updated"], "messages": len(d["messages"]),
                          "runs": len(rs), "provider": (last or {}).get("provider"), "model": (last or {}).get("model"),
                          "badge": lab_settings.badges(last), "kind": d.get("kind")})
        except (ValueError, KeyError, TypeError):
            continue  # skip a damaged file rather than break the list
    return sorted(items, key=lambda c: c["updated"], reverse=True)


def _user_event(data, seq):
    e = next((e for e in data.get("events", []) if e.get("kind") == "user" and e.get("seq") == seq), None)
    if e is None:
        raise KeyError(f"no message with seq {seq}")
    return e


def history_before(data, seq):
    """The history the model had just before the message with this seq, or None if it's gone.

    Found by the message's text (the n-th time that text was sent, for repeats). It's gone when
    summarising replaced it with a summary.
    """
    e = _user_event(data, seq)
    nth = sum(1 for x in data["events"] if x.get("kind") == "user" and x["seq"] < seq and x.get("text") == e["text"])
    seen = 0
    for i, m in enumerate(data.get("messages", [])):
        if m.get("role") == "user" and m.get("content") == e["text"]:
            if seen == nth:
                return data["messages"][:i]
            seen += 1
    return None


def run_stats(data, seq):
    """What the saved run for one message did, shaped like one side of a comparison."""
    e = _user_event(data, seq)
    events = data["events"]
    start = events.index(e)
    end = next((i for i in range(start + 1, len(events)) if events[i].get("kind") == "user"), len(events))
    tools, calls, read, wrote, spent, priced = [], [], 0, 0, 0.0, False
    approved, asked_at, waited = [], {}, 0.0  # tools you allowed, and how long the run waited for you
    out = {"label": "Saved run", "conversation": data.get("id"), "provider": None, "model": None, "config": None}
    began = {}
    for x in events[start:end]:
        kind = x.get("kind")
        step = x.get("step") if kind == "sub" else kind
        sub = kind == "sub"
        if kind == "request" and out["config"] is None:
            out["config"] = x.get("config") and {**x["config"], "system": x.get("system", ""), "tools": x.get("tools")}
            out["model"] = x.get("model")
            out["provider"] = (x.get("config") or {}).get("provider")
        if step == "request":
            began[sub] = x["time"]
        elif step == "response":
            u = x.get("usage") or {}
            read += ((u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0)
                     + (u.get("cache_creation_input_tokens") or 0))
            wrote += u.get("output_tokens") or 0
            if x.get("cost") is not None:
                spent += x["cost"]
                priced = True
            calls.append({"turn": x.get("turn"), "sub": sub, "input_tokens": u.get("input_tokens") or 0,
                          "cache_read": u.get("cache_read_input_tokens") or 0, "output_tokens": u.get("output_tokens") or 0,
                          "cost": x.get("cost"), "seconds": round(x["time"] - began.get(sub, x["time"]), 1)})
        elif kind == "tool_call":
            tools.append({"id": x.get("id"), "name": x["name"], "input": x.get("input", {})})
        elif kind == "tool_result" and x.get("outcome") in ("blocked", "declined", "hook_blocked"):
            for t in tools:
                if t["id"] == x["result"].get("tool_use_id"):
                    t["blocked"] = True
        elif kind == "approval":
            asked_at[x["id"]] = (x["time"], x.get("tool"))
        elif kind == "decision" and x["id"] in asked_at:
            when, tool = asked_at[x["id"]]
            waited += x["time"] - when
            if x.get("allowed") and tool:
                approved.append(tool)
        elif kind == "answer":
            out["answer"] = x["text"]
        elif kind == "error":
            out["error"] = x["message"]
        elif kind == "stopped":
            out["error"] = "You stopped this message before it finished."
        elif kind == "done":
            out["seconds"] = round(x["time"] - e["time"] - waited, 1)  # without the time spent waiting for you
    for t in tools:
        t.pop("id", None)
    out.update(tools=tools, calls=calls, tokens_read=read, tokens_written=wrote, cost=spent if priced else None,
               approved=approved, waited=round(waited, 1))
    out.setdefault("seconds", 0)
    return out
