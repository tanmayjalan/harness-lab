"""Ask the same question with two (or three) setups at the same time and line up what each did.

A setup is a provider plus any settings you change for it (prompt, tool descriptions,
permissions, trimming). Each side starts from a fresh conversation, or from a saved
conversation's history for a re-run. Tools that need approval are blocked here (nobody
is asked), so a comparison can't change your files or your profile.
"""
import json
import re
import statistics
import threading
import time
import uuid

from harness import paths
from harness.core import loop, providers, tools
from harness.features import subagents, tool_search, workflow
from harness.web import conversations
from harness.web.jsonify import to_json

HISTORY = paths.DATA / "compare"  # every comparison you ran, to look at again


def run_one(client, model, text, system, tools, permission, cost=lambda usage: None, run=tools.run_tool,
            hooks=None, history=(), prepare=None, thinking=None, cache=False, allow_ask=False,
            max_tokens=loop.MAX_TOKENS, max_turns=20, label=None, config=None, should_stop=lambda: False,
            at_once=None, busy=False, workflow_on=False, extra_tools=None):
    """One conversation: fresh, or carrying on from `history` (for a re-run). Returns what the page shows.
    `busy`: the practice switch, for this side and its helpers. `workflow_on`: answer with the fixed chain of
    agents (features/workflow.py) instead of one agent. `extra_tools`: "all" or "find" adds the 40 office tools
    (features/tool_search.py), with a Toolbox of this run's own, started from what `history` loaded.

    `calls` lists every model call (helpers' too, marked sub) with its tokens and time, and a tool
    the harness refused (blocked, or needing an approval nobody can give here) is marked blocked.
    """
    started = time.time()
    used, calls, read, wrote, spent = [], [], 0, 0, 0.0
    priced = False
    began = {}
    # The same events a conversation in the page records, so a side can be opened and inspected
    events = []
    helper = {"id": None, "call": 0}
    sources = {t["name"]: t.get("source", "built in") for t in (config or {}).get("tools") or []}
    box = None  # with the 40 office tools on (not for a workflow: its steps get read-only tools only)
    if extra_tools and not workflow_on:
        box = tool_search.Toolbox(tools, extra_tools, tool_search.used_in(history))

    def record(kind, **data):
        events.append({"seq": len(events), "kind": kind, "time": time.time(), "msg": 1, **to_json(data)})

    record("user", text=text)

    def watch(kind, sub=False, **data):
        nonlocal read, wrote, spent, priced
        extra = {}
        if kind == "request" and not sub:
            cfg = config or {}
            extra = {"provider": cfg.get("label") or label, "model": model, "facts": cfg.get("facts_shared", 0),
                     "edited": cfg.get("edited", []), "trimmed": None,
                     "tools": workflow.offered(cfg["tools"], data) if cfg.get("tools") is not None else None,
                     "config": {k: v for k, v in cfg.items() if k != "tools"} or None,
                     "hooks": hooks.describe() if hooks else None}
            if box:  # the list can grow during the run (find_tool): what this call really sent
                extra["tools"] = [{"name": t["name"], "description": t.get("description", ""),
                                   "source": sources.get(t["name"], "built in"), "permission": permission(t["name"])}
                                  for t in box.now()]
        if kind == "tool_call" and not sub:
            extra = {"source": sources.get(data["name"], "built in")}
            if data["name"] == "delegate":
                helper.update(id=data.get("id"), call=0)
        if sub and kind == "request":
            helper["call"] += 1
        if kind == "request":
            began[sub] = time.time()
        if kind == "tool_call" and not sub:
            used.append({"id": data.get("id"), "name": data["name"], "input": data["input"]})
        if kind == "tool_result" and not sub and data.get("outcome") in ("blocked", "unattended", "declined", "hook_blocked",
                                                                   "not_run", "error"):
            for t in used:
                if t["id"] == (data.get("result") or {}).get("tool_use_id"):
                    t["failed" if data["outcome"] == "error" else "blocked"] = True
                    if data["outcome"] == "unattended":
                        t["unattended"] = True  # nobody to ask: shown as "(not run)", scored as before
                    t["outcome"] = data["outcome"]  # why: blocked, unattended, declined, hook_blocked, not_run or error
        if kind == "response":
            u = data.get("usage")
            u = {} if u is None else u if isinstance(u, dict) else u.model_dump()
            read += ((u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0)
                     + (u.get("cache_creation_input_tokens") or 0))
            wrote += u.get("output_tokens") or 0
            c = cost(u) if u else None
            if c is not None:
                spent += c
                priced = True
            calls.append({"turn": data.get("turn"), "sub": sub, "input_tokens": u.get("input_tokens") or 0,
                          "cache_read": u.get("cache_read_input_tokens") or 0, "output_tokens": u.get("output_tokens") or 0,
                          "cost": c, "seconds": round(time.time() - began.get(sub, started), 1)})
            extra = {**extra, "cost": c}
        if sub:
            record("sub", step=kind, helper=helper["id"], call=helper["call"], **data, **extra)
        else:
            data.pop("step_tools", None)  # (recorded as the call's "tools" above)
            record(kind, **data, **extra)

    out = {"tools": used}
    # Nobody can be asked during a comparison: "Ask first" tools aren't run (the loop says why), unless you
    # chose to let them run
    rule = (lambda name: "allow" if permission(name) == "ask" else permission(name)) if allow_ask else permission
    run = subagents.with_delegate(run, client, model, tools, hooks=hooks,  # helpers count too, with your rules
                                  on_event=lambda kind, **data: watch(kind, sub=True, **data),
                                  permission=rule, thinking=thinking, cache=cache, busy=busy)
    if box:  # find_tool and the office tools are run here
        run = box.run(run)
    messages = [*history, {"role": "user", "content": text}]
    shared = dict(model=model, tools=tools, permission=rule, run=run, hooks=hooks, confirm=None, on_event=watch,
                  prepare=prepare or (lambda msgs: msgs), thinking=thinking, cache=cache, max_tokens=max_tokens,
                  max_turns=max_turns, should_stop=should_stop, at_once=at_once, busy=busy)
    if box:
        shared["tools"] = box.now  # read by the loop before each call: it grows as find_tool loads tools
    try:
        if workflow_on:
            out["answer"] = workflow.run(messages, client, **shared)
        else:
            out["answer"] = loop.agent(messages, client, system=system, **shared)
        record("answer", text=out["answer"], provider=(config or {}).get("label") or label, model=model)
    except loop.Stopped:  # Stop pressed: the run ends at the next step, like a stopped message
        out["stopped"] = True
        record("stopped")
    except Exception as e:
        err = providers.error_event(e)
        out["error"] = err["message"]
        record("error", **err)
    record("done")
    out["events"], out["messages"] = events, to_json(messages)
    for t in used:
        t.pop("id", None)
    out.update(seconds=round(time.time() - started, 1), tokens_read=read, tokens_written=wrote,
               cost=spent if priced else None, calls=calls, allow_ask=allow_ask)
    return out


def _spread(values):
    values = [v for v in values if v is not None]
    if not values:
        return None
    return {"median": statistics.median(values), "min": min(values), "max": max(values)}


def _same(answer):
    """An answer reduced to its words, so small differences in punctuation or case don't count."""
    return " ".join(re.findall(r"[a-z0-9]+(?:\.[0-9]+)?", (answer or "").lower()))  # (416.5 stays whole)


def summary(runs):
    """Several runs of one side: the middle and the range of each figure, and how often they agreed.

    Everything counts only the runs that answered: a run that failed or was cut short by Stop isn't
    "the same answer", its tools aren't a choice the model finished, and its time would drag the
    range down. `same_tools` is how many answered runs used the most common sequence of tools. The
    failed runs' errors are listed apart, in `failures`."""
    answered = [r for r in runs if "error" not in r and not r.get("stopped")]
    failed = [r for r in runs if "error" in r]
    answers = [_same(r.get("answer")) for r in answered]
    top = max((answers.count(a) for a in set(answers)), default=0)
    sequences = [tuple(t["name"] for t in r["tools"]) for r in answered]
    same_tools = max((sequences.count(s) for s in set(sequences)), default=0)
    return {"runs": len(runs), "seconds": _spread([r["seconds"] for r in answered]),
            "tokens_read": _spread([r["tokens_read"] for r in answered]),
            "tokens_written": _spread([r["tokens_written"] for r in answered]),
            "cost": _spread([r.get("cost") for r in answered]), "same_answer": top, "answered": len(answered),
            "same_tools": same_tools, "tools": [list(s) for s in sequences], "errors": len(failed),
            "stopped": sum(1 for r in runs if r.get("stopped")),
            "answers": [r.get("answer") for r in answered], "failures": [r["error"] for r in failed]}


def save_side(result, text, prefix="Compare", origin=None, repeat=1, name=None):
    """Keep one side as a conversation (tagged "compare"), so it can be opened and inspected.
    `origin`: which comparison and side it came from, so the page can lead back to it. The title
    carries the side's `name` (its label unless given), the time and, with several runs, which run is
    kept, so repeats can be told apart."""
    conv_id = conversations.new_id()
    title = f"{prefix} · {name or result['label']} · {text[:50]} · {time.strftime('%H:%M')}"
    if repeat > 1:
        title += f" · run 1 of {repeat}"
    conversations.save(conv_id, title, result.pop("messages"), result.pop("events"), kind="compare", origin=origin)
    return conv_id


def new_id():
    return time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]


def save_comparison(cid, text, results, look_for="", repeat=1, kind="compare", conversation=None, seq=None):
    """Keep a comparison (question, sides, figures, the conversation behind each side) to open later.
    A re-run (`kind="rerun"`) also keeps which conversation and message it sent again."""
    HISTORY.mkdir(parents=True, exist_ok=True)
    data = {"id": cid, "time": time.time(), "text": text, "look_for": look_for or "", "repeat": repeat,
            "kind": kind, "sides": to_json(results)}
    if kind == "rerun":
        data.update(conversation=conversation, seq=seq)
    path = HISTORY / f"{cid}.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def list_comparisons():
    """Newest first: id, time, question, labels of the sides, runs per side."""
    out = []
    for f in HISTORY.glob("*.json") if HISTORY.exists() else []:
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        out.append({"id": d["id"], "time": d["time"], "text": d["text"], "repeat": d.get("repeat", 1),
                    "kind": d.get("kind", "compare"), "sides": [s.get("label") for s in d.get("sides", [])]})
    return sorted(out, key=lambda c: c["time"], reverse=True)


def load_comparison(cid):
    if not re.fullmatch(r"[0-9A-Za-z_-]+", str(cid)):
        raise FileNotFoundError(cid)
    return json.loads((HISTORY / f"{cid}.json").read_text(encoding="utf-8"))


def compare(sides, text, repeat=1, save=True, prefix="Compare", progress=None, cancel=None, cid=None):
    """sides: a list of dicts with the arguments for run_one plus a "label". Runs them in parallel.
    A side may also carry `origin` (what its saved conversation says it was, instead of side A, B or
    C of this comparison) and `name` (for the saved conversation's title, instead of its label).

    With repeat > 1 each side runs that many times (one after another); the card shows the first
    run, and `stats` the median and range over all of them. The first run is saved for inspection.
    `progress(side, done, total)` is called after each run; once `cancel` (an Event) is set, each run
    stops at its next step and no side starts another. `cid`: the comparison's id, recorded in each
    saved side."""
    results = [None] * len(sides)
    total = max(1, repeat)

    def work(i, side):
        args = {k: v for k, v in side.items() if k not in ("provider", "origin", "name")}
        args["label"] = side["label"]
        runs = []
        for _ in range(total):
            if runs and cancel is not None and cancel.is_set():
                break
            runs.append(run_one(text=text, **args, should_stop=cancel.is_set if cancel is not None else (lambda: False)))
            if progress:
                progress(i, len(runs), total)
        first = runs[0]
        result = {"label": side["label"], "provider": side.get("provider"), "model": side["model"],
                  "config": side.get("config"), **first}
        if len(runs) < total or any(r.get("stopped") for r in runs):
            result["stopped"] = True
        if repeat > 1:
            result["stats"] = summary(runs)
        for r in runs[1:]:
            r.pop("events", None)
            r.pop("messages", None)
        if save:
            origin = {"comparison": cid, **(side.get("origin") or {"side": "ABC"[i]})} if cid else None
            result["conversation"] = save_side(result, text, prefix, origin, repeat=total, name=side.get("name"))
        else:
            result.pop("events", None)
            result.pop("messages", None)
        results[i] = result

    threads = [threading.Thread(target=work, args=(i, s), daemon=True) for i, s in enumerate(sides)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return results
