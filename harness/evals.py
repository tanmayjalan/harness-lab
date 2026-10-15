r"""Score providers on a fixed set of questions (evals.json).

    .venv\Scripts\python -m harness.evals --provider mock
    .venv\Scripts\python -m harness.evals --provider mock --provider deepseek
    .venv\Scripts\python -m harness.evals --provider mock --only weather    # questions mentioning "weather"
    .venv\Scripts\python -m harness.evals --provider mock --use-my-settings # with all your settings and hooks
    .venv\Scripts\python -m harness.evals --provider mock --judge none      # skip the judge (fewer calls)
    .venv\Scripts\python -m harness.evals --provider mock --repeat 3        # each question 3 times: pass rates
    .venv\Scripts\python -m harness.evals --provider mock --model claude-haiku-4-5-20251001   # another model

The questions are in config/evals.json.

Each question gets a fresh conversation, set up exactly as Compare sets up a side (compare.setup): with
--use-my-settings, every setting applies (thinking, caching, limits, skills, the workflow...) and your hooks
run; with the defaults, neither does. It passes if the model used the
tools it should (and only those, when the list is empty), where the
answer is fixed the answer contains the expected text, and where an
answer has no single right text, a second model (the judge, by default
the mock) agrees it meets the question's criteria. Facts about you are
left out, and tools that need approval are blocked (nobody is asked), so
the eval never writes files.

Run it before and after changing a prompt or tool description, and compare
pass rates over several runs (--repeat), not a single score: a model can pass
a question one time and fail it the next, so one run can mislead.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import time
from concurrent.futures import ThreadPoolExecutor

from harness.web import compare, conversations
from harness.core import loop, tools
from harness.features import lab_settings
from harness import paths
from harness.words import plural
from harness.core import providers



# Goes up when the checking itself changes, so rounds checked differently aren't joined on the chart
# (2: answer_has matches a whole word or number, not any piece of text)
CHECKS_VERSION = 2


def mentions(answer, expected):
    """Whether the answer has `expected` as a whole word or number, ignoring case: "30" is in "30 days" but not in
    "300", "2030" or "30.5"; a decimal may carry trailing zeros ("38.5" is in "38.50")."""
    zeros = "0*" if re.fullmatch(r"\d+\.\d+", expected) else ""
    return re.search(rf"(?<![\w.]){re.escape(expected)}{zeros}(?![.,]?\d)(?!\w)", answer or "", re.IGNORECASE) is not None


def check(case, result):
    """Returns a list of reasons it failed (empty means it passed)."""
    if "error" in result:
        return [result["error"]]
    problems = []
    # A refused call doesn't count as using the tool, and one that only failed didn't help the answer;
    # except where failing or being refused is the point of the question ("tool_may_not_work")
    may_not_work = case.get("tool_may_not_work", False)
    used = {t["name"] for t in result["tools"] if may_not_work or not t.get("blocked")}
    worked = {t["name"] for t in result["tools"] if may_not_work or not (t.get("blocked") or t.get("failed"))}
    wanted = set(case["tools"])
    if not wanted and used:
        problems.append(f"used tools it didn't need: {', '.join(sorted(used))}")
    missing = wanted - used
    if missing:
        problems.append(f"didn't use: {', '.join(sorted(missing))}")
    only_failed = (wanted & used) - worked
    if only_failed:  # so whatever the answer says, it didn't come from the tool
        problems.append(f"{', '.join(sorted(only_failed))} failed every time it ran")
    expected = case.get("answer_has")
    if expected and not any(mentions(result.get("answer"), e) for e in expected):
        problems.append(f"answer doesn't mention {' or '.join(repr(e) for e in expected)}")
    return problems


_clients = {}


def client_for(provider, clients=None):
    if clients is not None:  # the web page's own clients (it already runs a mock server)
        return clients.get(provider)
    if provider not in _clients:
        if provider == "mock":
            from harness.web import server as web_server
            _clients[provider] = web_server.start_mock()  # its own mock server, so nothing else needs to be running
        else:
            _clients[provider] = providers.make_client(provider)
    return _clients[provider]


JUDGE_PROMPT = (
    "You grade an AI assistant's answer against criteria. Be strict and literal: the answer must meet every "
    "criterion. Reply with exactly one line: PASS or FAIL, then ' - ' and a short reason."
)


def judge(case, result, provider, clients=None):
    """Ask a second model whether the answer meets the case's criteria. Returns (passed, reason), where
    passed is None when the judge's reply was neither PASS nor FAIL: that run couldn't be judged."""
    reply = providers.with_quiet_retries(client_for(provider, clients)).messages.create(
        model=providers.default_model(provider), max_tokens=300, system=JUDGE_PROMPT,
        messages=[{"role": "user", "content": f"Question: {case['question']}\n\nCriteria: {case['judge']}\n\n"
                                              f"Answer:\n{result.get('answer') or '(no answer)'}"}])
    line = "".join(b.text for b in reply.content if b.type == "text").strip()
    m = re.match(r"[\W_]*(PASS|FAIL)\b[\W_]*(.*)", line, re.IGNORECASE | re.DOTALL)
    if not m:
        return None, f"the judge's reply wasn't PASS or FAIL: {line[:80]!r}"  # unclear: not judged
    return m.group(1).upper() == "PASS", m.group(2).strip() or line


def side_for(provider, model=None, use_my_settings=False, settings_path=None, clients=None):
    """How every question of a round is run: compare.setup, as for a side of a comparison. With your settings,
    all of them apply and your hooks run; with the defaults, neither. (The web page passes its own `side`, with
    its MCP tools; this one is for the command line, which has only the built-in tools.)"""
    model = model or providers.default_model(provider)
    settings = lab_settings.load(settings_path) if use_my_settings else lab_settings.empty()
    settings = lab_settings.clean(settings, loop.SYSTEM, tools.TOOLS, loop.default_permission)
    return compare.setup(provider, model, settings, client=client_for(provider, clients), use_hooks=use_my_settings)


def setup_words(side, settings_changed):
    """What a round's setup was, for its label: your setting changes, plus your hooks and any tools from MCP
    programs, which the settings list doesn't know about."""
    out = list(settings_changed)
    names = side["hooks"].names() if side.get("hooks") else []
    if names:
        out.append(f"your hooks ({', '.join(names)})")
    mcp = [t for t in (side.get("config") or {}).get("tools") or [] if t.get("source", "built in") != "built in"]
    if mcp:
        out.append(plural(len(mcp), "tool") + " from MCP programs")
    return out


def run(provider, cases, use_my_settings=False, workers=3, judge_with=None, model=None, settings_path=None,
        clients=None, on_result=None, cancel=None, save=False, run_id=None, side=None):
    """Each case in a fresh conversation, a few at a time. `on_result(index, result)` is told as each finishes.
    Once `cancel` (an Event) is set, cases not yet started are skipped ({"skipped": True}). With `save`, each
    run is kept as a conversation tagged "eval", so it can be opened in the page. With `run_id` (the round's id), each
    also remembers its round, its question and which attempt it was, so the page can link back. `side`: how each
    question runs (compare.setup); by default side_for's."""
    side = side or side_for(provider, model, use_my_settings, settings_path, clients)
    args = {k: v for k, v in side.items() if k != "provider"}

    def one(item):
        index, case = item
        if cancel is not None and cancel.is_set():
            return {"skipped": True}
        result = compare.run_one(text=case["question"], **args)
        events, messages = result.pop("events", None), result.pop("messages", None)
        if save and events is not None:
            conv_id = conversations.new_id()
            where = {}
            if run_id:
                where["origin"] = {"kind": "eval", "round": run_id, "question": case["question"][:80],
                                   "attempt": case.get("_attempt", 1)}
            conversations.save(conv_id, f"Eval · {case['question'][:50]}", messages, events, kind="eval", **where)
            result["conversation"] = conv_id
        if case.get("judge") and judge_with and "error" not in result:
            try:
                result["judged"] = judge(case, result, judge_with, clients)
            except Exception as e:
                result["judged"] = (None, f"the judge couldn't grade this: {type(e).__name__}: {e}")
        if on_result:
            on_result(index, result)
        return result

    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(one, enumerate(cases)))


# ---- the same, for the web page: structured results, kept in data/evals/ ----

HISTORY = paths.DATA / "evals"


def cases_from_config(only=None):
    cases = json.loads((paths.CONFIG / "evals.json").read_text(encoding="utf-8"))["cases"]
    return [c for c in cases if not only or only.lower() in c["question"].lower()]


def checked(case, judge_on=True):
    """What a case checks, in words: shown for every question, passed or not. With the judge off, the
    criteria weren't used, so they're shown as such."""
    out = [f"uses {', '.join(case['tools'])}" if case["tools"] else "uses no tools"]
    if case.get("tool_may_not_work"):
        out.append("trying the tool counts (it may fail or be refused)")
    if case.get("answer_has"):
        out.append(f"answer mentions {' or '.join(repr(e) for e in case['answer_has'])}")
    if case.get("judge"):
        out.append(f"judged against: {case['judge']}" if judge_on else f"judged when the judge is on: {case['judge']}")
    return out


def questions_hash(cases):
    """A short fingerprint of a question set and what each question checks: rounds are comparable only when it
    matches (CHECKS_VERSION goes up when the checking itself changes)."""
    keep = [{k: c.get(k) for k in ("question", "tools", "answer_has", "judge", "tool_may_not_work")} for c in cases]
    text = json.dumps([CHECKS_VERSION, keep], sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def run_suite(provider, cases, model=None, repeat=1, use_my_settings=False, judge_with=None, settings_path=None,
              clients=None, on_progress=None, cancel=None, only=None, run_id=None, side=None, settings_changed=None):
    """Every case `repeat` times. Returns per-question pass rates, reasons and figures, plus the setup.
    Stopped part-way (`cancel` set), it returns what finished, marked `incomplete`. `side`: how each question
    runs (compare.setup), with `settings_changed` its settings in words; by default side_for's."""
    model = model or providers.default_model(provider)
    if side is None:
        side = side_for(provider, model, use_my_settings, settings_path, clients)
        settings = lab_settings.load(settings_path) if use_my_settings else lab_settings.empty()
        settings_changed = lab_settings.what_changed(settings) if use_my_settings else []
    repeated = [{**c, "_attempt": n + 1} for c in cases for n in range(repeat)]
    done = [0]

    def progress(_index, _result):
        done[0] += 1
        if on_progress:
            on_progress(done[0], len(repeated))

    results = run(provider, repeated, use_my_settings, judge_with=judge_with, model=model, settings_path=settings_path,
                  clients=clients, on_result=progress, cancel=cancel, save=True, run_id=run_id, side=side)
    rows = []
    for i, case in enumerate(cases):
        runs = [r for r in results[i * repeat:(i + 1) * repeat] if not r.get("skipped")]
        if not runs:
            continue
        problems = [failures(case, r) for r in runs]
        scored = [p for p, r in zip(problems, runs) if not unjudged(r)]
        passed = sum(not p for p in scored)
        rows.append({
            "question": case["question"], "passed": passed, "runs": len(scored), "ran": len(runs),
            "unjudged": len(runs) - len(scored),
            "verdict": "NOT JUDGED" if not scored else "PASS" if passed == len(scored) else "FAIL" if passed == 0 else "MIXED",
            "checked": checked(case, judge_on=bool(judge_with)),
            "run_problems": problems, "judge_verdicts": [judge_word(r) for r in runs],
            "judge_notes": [r["judged"][1] if r.get("judged") else None for r in runs],
            "conversations": [r.get("conversation") for r in runs],
            "problems": sorted({x for ps in problems for x in ps}),
            "tools": [[t["name"] + (" (not run)" if t.get("unattended") else " (blocked)" if t.get("blocked") else " (failed)" if t.get("failed") else "")
                       for t in r["tools"]] for r in runs],
            "seconds": [r["seconds"] for r in runs], "tokens": [r["tokens_read"] + r["tokens_written"] for r in runs],
            "cost": [r.get("cost") for r in runs], "answers": [r.get("answer") for r in runs],
            "errors": [r.get("error") for r in runs],
        })
    return {
        "provider": provider, "label": providers.PROVIDERS[provider]["label"], "model": model, "repeat": repeat,
        "use_my_settings": use_my_settings, "judge": judge_with,
        "setup": setup_words(side, settings_changed or []),
        # Enough to see later exactly what the round ran with (F442): the prompt sent, the tools and their rules,
        # every setting, the questions' fingerprint and the judge's instructions
        "config": side.get("config"), "questions_hash": questions_hash(cases), "checks_version": CHECKS_VERSION,
        "judge_prompt": JUDGE_PROMPT if judge_with else None,
        "judge_model": providers.default_model(judge_with) if judge_with else None,
        "passed": sum(r["passed"] for r in rows), "total": sum(r["runs"] for r in rows), "cases": rows,
        "unjudged": sum(r["unjudged"] for r in rows),
        "estimated": provider == "mock", "only": only or "",
        "incomplete": any(r.get("skipped") for r in results),
    }


def new_run_id(when=None):
    when = when or time.time()
    return time.strftime("%Y%m%d-%H%M%S", time.localtime(when)) + f"-{int(when * 1000) % 1000:03d}"


def save_result(result, when=None, run_id=None):
    """Keep a finished run in data/evals/ for the score-over-time chart. Returns its id (`run_id` when the
    caller made it up front, so the run's conversations could point back to it)."""
    when = when or time.time()
    run_id = run_id or new_run_id(when)
    HISTORY.mkdir(parents=True, exist_ok=True)
    data = {"id": run_id, "time": when, **result}
    (HISTORY / f"{run_id}.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    forget_old_conversations()
    return run_id


KEEP_CONVERSATIONS = 10  # eval runs whose conversations stay inspectable; older runs keep only their scores


def forget_old_conversations(keep=KEEP_CONVERSATIONS):
    """Delete the saved conversations of all but the newest `keep` runs (each run saves one per
    question and repeat). The run's scores stay, so the chart is unchanged; its Inspect links go."""
    runs = []
    for path in HISTORY.glob("*.json"):
        try:
            runs.append((json.loads(path.read_text(encoding="utf-8")), path))
        except (OSError, ValueError):
            continue
    runs.sort(key=lambda r: r[0].get("time") or 0)
    for data, path in runs[:-keep] if len(runs) > keep else []:
        ids = [cid for case in data.get("cases", []) for cid in case.get("conversations") or [] if cid]
        if not ids:
            continue
        for cid in ids:
            try:
                conversations.delete(cid)  # (to .deleted/, purged after 7 days)
            except ValueError:
                pass
        for case in data.get("cases", []):
            if case.get("conversations"):
                case["conversations"] = []
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def history():
    """Past runs, oldest first, without the per-question detail."""
    out = []
    for path in sorted(HISTORY.glob("*.json")) if HISTORY.exists() else []:
        try:
            d = json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            continue
        out.append({k: d.get(k) for k in ("id", "time", "provider", "label", "model", "repeat", "use_my_settings",
                                            "setup", "passed", "total", "judge", "only", "incomplete", "unjudged",
                                            "questions_hash")}
                   | {"questions": len(d.get("cases", []))})
    return sorted(out, key=lambda r: r["time"] or 0)


def load_result(run_id):
    if not isinstance(run_id, str) or not run_id.replace("-", "").isdigit():
        raise ValueError("not an eval run id")
    return json.loads((HISTORY / f"{run_id}.json").read_text(encoding="utf-8"))


def report(provider, cases, results, model=None, repeat=1):
    """Print one line per question. With repeat > 1, results hold `repeat` runs per question in a row,
    and each question shows its pass rate (e.g. 2/3)."""
    if repeat > 1:
        return report_rates(provider, cases, results, model, repeat)
    label = f"{providers.PROVIDERS[provider]['label']} ({model or providers.default_model(provider)})"
    print(f"\n{label}")
    print("-" * len(label))
    passed = scored = 0
    for case, result in zip(cases, results):
        problems = failures(case, result)
        judged = result.get("judged")
        tools = tool_path(result["tools"])
        mark = "----" if unjudged(result) else "PASS" if not problems else "FAIL"
        print(f"  {mark}  {case['question'][:55]:<55}  [{tools}]  {result['seconds']}s")
        for p in problems:
            print(f"          {p}")
        if judged:
            print(f"          judge: {judge_word(result).lower().replace('unjudged', 'could not grade it')}: {judged[1]}")
        if not unjudged(result):
            scored += 1
            passed += not problems
    cost = [r["cost"] for r in results if r.get("cost") is not None]
    tokens = sum(r["tokens_read"] + r["tokens_written"] for r in results)
    print(f"  {pass_rate(passed, scored)}"
          + (f" · {tokens:,} tokens{' (estimated)' if provider == 'mock' else ''}" if tokens else " · tokens not reported")
          + (f" · about ${sum(cost):.4f}" if cost else ""))
    if scored < len(results):
        print(f"  {plural(len(results) - scored, 'run')} couldn't be judged (the judge itself failed): left out of the pass rate.")
    return passed


def pass_rate(passed, total):
    """The same words and rounding as the page: "Pass rate: 14 of 16 runs (88%)"."""
    return f"Pass rate: {passed} of {plural(total, 'run')} ({int(100 * passed / total + 0.5) if total else 0}%)"


def tool_mark(t):
    return t["name"] + (" (not run)" if t.get("unattended") else " (blocked)" if t.get("blocked") else " (failed)" if t.get("failed") else "")


def tool_path(calls):
    """The tools one run used, the page's way: "read_file (blocked) → roll_dice ×2", or "no tools"."""
    parts = []
    for name in map(tool_mark, calls):
        if parts and parts[-1][0] == name:
            parts[-1][1] += 1
        else:
            parts.append([name, 1])
    return " → ".join(f"{name} ×{n}" if n > 1 else name for name, n in parts) or "no tools"


def judge_is_tested(judge_with, provider, model):
    """The judge (the judging provider's default model) is the model being tested: it may go easy on its
    own answers. Goes by model, as the page does, whichever provider runs it."""
    if not judge_with:
        return False
    return (model or providers.default_model(provider)) == providers.default_model(judge_with)


def failures(case, result):
    problems = check(case, result)
    judged = result.get("judged")
    if judged and judged[0] is False:
        problems.append(f"judge: {judged[1]}")
    return problems


def unjudged(result):
    """The judge itself failed (an error, or a reply that was neither PASS nor FAIL): the run says nothing
    about the model, so it counts neither as a pass nor as a fail."""
    judged = result.get("judged")
    return bool(judged) and judged[0] is None


def judge_word(result):
    judged = result.get("judged")
    return None if not judged else "UNJUDGED" if judged[0] is None else "PASS" if judged[0] else "FAIL"


def report_rates(provider, cases, results, model, repeat):
    label = f"{providers.PROVIDERS[provider]['label']} ({model or providers.default_model(provider)}), {repeat} runs each"
    print(f"\n{label}")
    print("-" * len(label))
    total = runs_scored = left_out = 0
    mixed = False
    for i, case in enumerate(cases):
        runs = results[i * repeat:(i + 1) * repeat]
        problems = [failures(case, r) for r in runs if not unjudged(r)]
        passed = sum(not p for p in problems)
        total += passed
        runs_scored += len(problems)
        left_out += len(runs) - len(problems)
        mark = "----" if not problems else "PASS" if passed == len(problems) else "FAIL" if passed == 0 else "MIXED"
        mixed = mixed or mark == "MIXED"
        print(f"  {mark:<5} {passed}/{len(problems)}  {case['question'][:55]}")
        for p in sorted({x for ps in problems for x in ps}):
            runs_with = [str(n + 1) for n, ps in enumerate(problems) if p in ps]
            print(f"          {p}" + (f" (run{'s' if len(runs_with) > 1 else ''} {', '.join(runs_with)})" if len(problems) > 1 else ""))
        taken = {}
        for r in runs:
            path = tool_path(r["tools"])
            taken[path] = taken.get(path, 0) + 1
        for path, n in taken.items():
            print(f"          tools: {path} · in {plural(n, 'run')}")
    print(f"  {pass_rate(total, runs_scored)}")
    if mixed:
        print("  MIXED: the same question passed some runs and failed others.")
    if left_out:
        print(f"  {plural(left_out, 'run')} couldn't be judged (the judge itself failed): left out of the pass rate.")
    return total


def main():
    parser = argparse.ArgumentParser(description="Score providers on evals.json")
    parser.add_argument("--provider", action="append", choices=providers.PROVIDERS, required=True,
                        help="repeat to compare providers")
    parser.add_argument("--use-my-settings", action="store_true",
                        help="use every one of your settings, and your hooks, instead of the defaults (as Compare does)")
    parser.add_argument("--only", metavar="TEXT", help="run just the questions containing TEXT")
    parser.add_argument("--judge", default="mock", choices=[*providers.PROVIDERS, "none"],
                        help="which provider grades the open-ended answers (default: mock; 'none' skips them)")
    parser.add_argument("--repeat", type=int, default=1, metavar="N",
                        help="run each question N times and report pass rates (models vary from run to run)")
    parser.add_argument("--model", help="a model from the provider's list (e.g. the mock's claude-haiku-4-5-20251001)")
    args = parser.parse_args()
    if args.repeat < 1:
        parser.error("--repeat must be 1 or more")

    os.chdir(paths.ROOT)
    cases = json.loads((paths.CONFIG / "evals.json").read_text(encoding="utf-8"))["cases"]
    if args.only:
        cases = [c for c in cases if args.only.lower() in c["question"].lower()]
        if not cases:
            parser.exit(1, f"No question contains {args.only!r}.\n")
    judge_with = None if args.judge == "none" else args.judge
    print(f"{plural(len(cases), 'question')}; {'your edited settings' if args.use_my_settings else 'default settings'}; "
          f"judge: {judge_with or 'none'}; facts about you left out; tools that need approval blocked.")
    for provider in args.provider:
        problem = providers.is_local(provider) and providers.unavailable(provider)
        if problem:  # a local server that isn't running (or has no models): say so and go on to the next
            print(f"  ({providers.PROVIDERS[provider]['label']}: {problem})")
            continue
        model = args.model if args.model in providers.models(provider) else None
        if args.model and not model:
            print(f"  ({provider} has no model {args.model!r}; using {providers.default_model(provider)})")
        if judge_is_tested(judge_with, provider, model):
            print("  (the judge is the same model as the one being tested: it may go easy on its own answers)")
        started = time.time()
        repeated = [c for c in cases for _ in range(args.repeat)]
        results = run(provider, repeated, args.use_my_settings, judge_with=judge_with, model=model)
        report(provider, cases, results, model=model, repeat=args.repeat)
        print(f"  Took {time.time() - started:.0f}s")


if __name__ == "__main__":
    main()
