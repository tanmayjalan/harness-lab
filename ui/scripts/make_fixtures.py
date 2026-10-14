"""Make the frontend's test data from REAL server events, with no model calls.

Runs harness.web.server.Session with scripted fake models, one scenario each, and saves
the events it emits to ui/src/test/fixtures/<scenario>.json. Re-run this whenever the
server's event shapes change, so the page's tests always use the real shapes.

    .venv\\Scripts\\python ui\\scripts\\make_fixtures.py      (from the Harness folder)

Everything it saves (profile, settings, conversations, hooks) goes to a temporary folder.
"""
import atexit
import json
import pathlib
import shutil
import sys
import tempfile
import time
from types import SimpleNamespace as NS

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from anthropic.types import TextBlock, ToolUseBlock, Usage  # noqa: E402

from harness.core import run_code, tools, toy_tools  # noqa: E402
from harness.features import checkpoints, hooks, lab_settings, memory, skills  # noqa: E402
from harness.web import conversations  # noqa: E402
from harness.web import server as web_server  # noqa: E402

TMP = pathlib.Path(tempfile.mkdtemp(prefix="harness-fixtures-"))
atexit.register(shutil.rmtree, TMP, ignore_errors=True)  # deleted when the script ends
memory.PATH = TMP / "profile.json"
lab_settings.PATH = TMP / "lab_settings.json"
conversations.DIR = TMP / "conversations"
checkpoints.DIR = TMP / "checkpoints"  # (Rewind's copies of the workspace's files)
hooks.PATH = TMP / "no_hooks.py"
skills.DIR = TMP / "skills"  # (none: config/skills/ is yours, and the samples don't use skills)
WORK = TMP / "workspace"
WORK.mkdir()
(WORK / "notes.md").write_text("# Notes\n- launch on 15 October\n" * 120, encoding="utf-8")  # big enough to summarise
(WORK / "budget.csv").write_text("item,amount\ncoffee,18.50\ntrain,64.00\n", encoding="utf-8")
tools.WORKSPACE = WORK
# get_weather asks Open-Meteo; answer for it here, so the fixtures never use the internet
toy_tools.fetch_json = lambda url: ({"results": [{"name": "Paris", "country": "France", "latitude": 48.85,
                                                  "longitude": 2.35}]} if "geocoding" in url else
                                     {"current": {"time": "2026-10-03T20:00", "temperature_2m": 31,
                                                  "relative_humidity_2m": 40, "wind_speed_10m": 9, "weather_code": 0}})
OUT = ROOT / "ui" / "src" / "test" / "fixtures"


def text(t):
    return TextBlock(type="text", text=t)


def call(id, name, **input):
    return ToolUseBlock(type="tool_use", id=id, name=name, input=input)


def reply(stop, *content, inp=1200, out=80, cached=0):
    return NS(stop_reason=stop, content=list(content),
              usage=Usage(input_tokens=inp, output_tokens=out, cache_read_input_tokens=cached))


class Scripted:
    """Answers in order. `stream` is left out on purpose: the server then makes plain calls."""

    def __init__(self, *replies, fail=None):
        self.replies = list(replies)
        self.fail = fail
        self.messages = self

    def create(self, **kw):
        if self.fail:
            raise RuntimeError(self.fail)
        if kw.get("system", "").startswith("You summarise"):  # a summarising call
            return NS(content=[text("The user asked about notes; they hold launch plans.")],
                      usage=Usage(input_tokens=900, output_tokens=60))
        time.sleep(0.01)  # so calls take a measurable time
        return self.replies.pop(0)


def session(client, provider="deepseek", settings=None, profile=None):
    path = TMP / f"settings-{time.time_ns()}.json"
    if settings:
        lab_settings.save(settings, web_server.loop.SYSTEM, tools.TOOLS, web_server.loop.default_permission, path)
    prof = TMP / f"profile-{time.time_ns()}.json"
    if profile:
        memory.save(profile, prof)
    return web_server.Session(client, "DeepSeek" if provider == "deepseek" else "Mock: replies from claude -p",
                              model="deepseek-flash" if provider == "deepseek" else "claude-opus-5-5",
                              provider=provider, settings_path=path, profile_path=prof)


def send(s, message, answer=None, timeout=10):
    """Send a message; if `answer` is given, answer the first approval with it."""
    s.start(message)
    end = time.time() + timeout
    while s.running and time.time() < end:
        pending = [e for e in s.snapshot(0)["events"] if e["kind"] == "approval"]
        decided = {e["id"] for e in s.snapshot(0)["events"] if e["kind"] == "decision"}
        for a in pending:
            if a["id"] not in decided and answer is not None:
                s.decide(a["id"], answer)
        time.sleep(0.01)
    assert not s.running, f"{message!r} did not finish"


def save(name, s):
    OUT.mkdir(parents=True, exist_ok=True)
    events = s.snapshot(0)["events"]
    (OUT / f"{name}.json").write_text(json.dumps(events, indent=1, ensure_ascii=False) + "\n", encoding="utf-8",
                                      newline="\n")
    print(f"{name:20} {len(events):3} events: {' '.join(e['kind'] for e in events)[:110]}")


def main():
    # 1. A plain answer, no tools
    s = session(Scripted(reply("end_turn", text("Paris is the capital of **France**."), inp=900, out=20)))
    send(s, "What is the capital of France?")
    save("answer", s)

    # 2. Two tools in one reply, then the answer (the history grows between calls)
    s = session(Scripted(
        reply("tool_use", text("Let me check the weather."), call("t1", "get_weather", city="Paris"),
              call("t2", "get_current_time", timezone="Europe/Paris"), inp=1500, out=90),
        reply("tool_use", call("t3", "convert_temperature", value=31, from_unit="celsius", to_unit="fahrenheit"),
              inp=1800, out=60, cached=1500),
        reply("end_turn", text("It's **87.8 °F** in Paris."), inp=2000, out=40, cached=1800)))
    send(s, "What's the weather in Paris, in Fahrenheit?")
    save("tool_turn", s)

    # 3. A write that asks first, declined
    s = session(Scripted(
        reply("tool_use", call("w1", "write_file", path="todo.txt", content="- book the room\n")),
        reply("end_turn", text("OK, I didn't write it."))))
    send(s, "Create todo.txt", answer=False)
    save("approval_declined", s)

    # 4. A read outside the workspace: normally allowed, so it asks; allowed
    outside = TMP / "elsewhere.txt"
    outside.write_text("secret plans", encoding="utf-8")
    s = session(Scripted(
        reply("tool_use", call("r1", "read_file", path=str(outside))),
        reply("end_turn", text("It says: secret plans."))))
    send(s, "Read that file outside", answer=True)
    save("approval_outside", s)

    # 5. Blocked by your settings, and blocked by a hook
    hook_file = TMP / "my_hooks.py"
    hook_file.write_text("def before_tool(name, args):\n"
                         "    return 'looks like a secret' if '.env' in str(args.get('path', '')) else None\n",
                         encoding="utf-8")
    hooks.PATH = hook_file
    s = session(Scripted(
        reply("tool_use", call("b1", "read_file", path="private/.env"), call("b2", "roll_dice", sides=6)),
        reply("end_turn", text("Both were blocked."))), settings={"permissions": {"roll_dice": "block"}})
    send(s, "Read private/.env and roll a die")
    hooks.PATH = TMP / "no_hooks.py"
    save("blocked", s)

    # 5b. Your hooks at work: one lets calls through, one rewrites a result, one crashes
    hook_file = TMP / "my_hooks_at_work.py"
    hook_file.write_text("def before_tool(name, args):\n"
                         "    if name == 'roll_dice':\n"
                         "        return 1 / 0\n"
                         "    return None\n"
                         "def after_tool(name, args, result):\n"
                         "    return '[Untrusted content] ' + result if name == 'read_file' else None\n",
                         encoding="utf-8")
    hooks.PATH = hook_file
    s = session(Scripted(
        reply("tool_use", call("k1", "read_file", path="budget.csv"), call("k2", "calculate", expression="18.5+64"),
              call("k3", "roll_dice", sides=6)),
        reply("end_turn", text("The budget adds up to 82.50; the die couldn't be rolled."))))
    send(s, "Add up budget.csv and roll a die")
    hooks.PATH = TMP / "no_hooks.py"
    save("hooked", s)

    # 6. A helper agent
    s = session(Scripted(
        reply("tool_use", call("d1", "delegate", task="Read notes.md and summarise it", report="one line")),
        reply("tool_use", call("h1", "read_file", path="notes.md"), inp=700, out=40),
        reply("end_turn", text("notes.md: launch plans for 15 October."), inp=1400, out=30),
        reply("end_turn", text("The helper says: launch plans for 15 October."))))
    send(s, "Use a helper to summarise notes.md")
    save("helper", s)

    # 6b. A helper whose tools go through your hooks too
    hook_file = TMP / "my_hooks_for_helpers.py"
    hook_file.write_text("def before_tool(name, args):\n"
                         "    return None\n"
                         "def after_tool(name, args, result):\n"
                         "    return '[Untrusted content] ' + result if name == 'read_file' else None\n",
                         encoding="utf-8")
    hooks.PATH = hook_file
    s = session(Scripted(
        reply("tool_use", call("d1", "delegate", task="Read budget.csv and add it up", report="one line")),
        reply("tool_use", call("h1", "read_file", path="budget.csv"), inp=700, out=40),
        reply("end_turn", text("budget.csv adds up to 82.50."), inp=900, out=20),
        reply("end_turn", text("The helper says the budget adds up to 82.50."))))
    send(s, "Use a helper to add up budget.csv")
    hooks.PATH = TMP / "no_hooks.py"
    save("helper_hooked", s)

    # 7. A plan
    steps = [{"text": "List the files", "status": "done"}, {"text": "Read budget.csv", "status": "in_progress"},
             {"text": "Add it up", "status": "pending"}]
    s = session(Scripted(
        reply("tool_use", call("p1", "update_plan", steps=steps), call("p2", "read_file", path="budget.csv")),
        reply("tool_use", call("p3", "update_plan", steps=[{**x, "status": "done"} for x in steps])),
        reply("end_turn", text("The total is 82.50."))))
    send(s, "Do this in steps: total budget.csv")
    save("plan", s)

    # 8. Two messages with trimming on (the second call's copy has an old result replaced)
    s = session(Scripted(
        reply("tool_use", call("n1", "read_file", path="notes.md")),
        reply("end_turn", text("Notes read.")),
        reply("tool_use", call("n2", "read_file", path="budget.csv")),
        reply("tool_use", call("n3", "list_files", path=".")),
        reply("end_turn", text("Done."))), settings={"trim": {"enabled": True, "keep_last": 1}})
    send(s, "Read notes.md")
    send(s, "Now read budget.csv and list the files")
    save("trimmed", s)

    # 9. Summarising: the second message starts by replacing old history with a summary
    s = session(Scripted(
        reply("tool_use", call("c1", "read_file", path="notes.md")),
        reply("end_turn", text("Notes read.")),
        reply("end_turn", text("They're launch plans."))), settings={"compact": {"enabled": True, "over_chars": 2000}})
    send(s, "Read notes.md")
    send(s, "What were they about?")
    save("compacted", s)

    # 10. Stopped mid-reply: the tools asked for are answered "Not run"
    class StopDuring(Scripted):
        def create(self, **kw):
            r = super().create(**kw)
            stopper.stop()
            return r
    stopper = session(StopDuring(reply("tool_use", call("s1", "get_weather", city="Paris"),
                                       call("s2", "get_weather", city="Tokyo"))))
    send(stopper, "Weather in Paris and Tokyo")
    save("stopped", stopper)

    # 11. A provider switch between messages, with a fact about you shared
    s = session(Scripted(reply("end_turn", text("Hello Asha.")), reply("end_turn", text("Still you, Asha."))),
                profile=[{"label": "Name", "value": "Asha", "share": True}])
    send(s, "Hi")
    s.switch("mock", Scripted(reply("end_turn", text("Hi again, Asha."))), "Mock: replies from claude -p",
             "claude-opus-5-5")
    s.provider = "mock"
    send(s, "Who am I?")
    save("provider_switch", s)

    # 12. An error from the provider
    s = session(Scripted(fail="Connection refused"))
    send(s, "Hello?")
    save("error", s)

    # 13. A busy service (the practice switch): the first try fails, the harness waits and tries again
    s = session(Scripted(reply("end_turn", text("Paris is the capital of **France**."), inp=900, out=20)),
                settings={"faults": {"busy": True}})
    send(s, "What is the capital of France?")
    save("retry", s)

    # 14. Several tools at once: three allowed tools from one reply run at the same time
    s = session(Scripted(
        reply("tool_use", call("a1", "calculate", expression="18*3"), call("a2", "roll_dice", sides=6),
              call("a3", "get_current_time", timezone="Asia/Tokyo"), inp=1500, out=90),
        reply("end_turn", text("54, a roll, and the time in Tokyo."), inp=1900, out=30)),
        settings={"tools_at_once": {"enabled": True}})
    send(s, "Work out 18*3, roll a die and tell me the time in Tokyo")
    save("at_once", s)

    # 15. The workflow: gather facts (one tool), write, check finds a problem, fix, check passes
    s = session(Scripted(
        reply("tool_use", call("w1", "read_file", path="budget.csv"), inp=1100, out=40),
        reply("end_turn", text("- coffee: 18.50 (budget.csv)\n- train: 64.00 (budget.csv)"), inp=1300, out=30),
        reply("end_turn", text("You spent **92.50** in total."), inp=400, out=20),
        reply("end_turn", text("PROBLEMS\n- 18.50 + 64.00 is 82.50, not 92.50"), inp=450, out=25),
        reply("end_turn", text("You spent **82.50** in total: coffee 18.50 and the train 64.00."), inp=500, out=25),
        reply("end_turn", text("PASS"), inp=460, out=5)),
        settings={"workflow": {"enabled": True}})
    send(s, "How much did I spend in budget.csv?")
    save("workflow", s)

    # 16. Run code: the script fails, the model reads the error, fixes the file and runs it again. The runs
    # are stubbed, so the sample is the same on every computer and starts no programs
    runs = [RuntimeError("Exit code: 1\nErrors:\nTraceback (most recent call last):\n"
                         '  File "scripts/totals.py", line 7, in <module>\n    amount = int(row["amount"])\n'
                         "ValueError: invalid literal for int() with base 10: '18.50'"),
            "Exit code: 0\nOutput:\ntotal         82.50"]

    def stub_run_python(code=None, path=None, should_stop=None):  # (the chat passes its Stop)
        out = runs.pop(0)
        if isinstance(out, Exception):
            raise out
        return out
    real_run_python, run_code.run_python = run_code.run_python, stub_run_python
    s = session(Scripted(
        reply("tool_use", call("x1", "run_python", path="scripts/totals.py"), inp=1500, out=40),
        reply("tool_use", text("int() can't read 18.50: amounts have decimals, so it needs float()."),
              call("x2", "write_file", path="scripts/totals.py",
                   content="import csv\n\ntotal = 0.0\nwith open('budget.csv', encoding='utf-8') as f:\n"
                           "    for row in csv.DictReader(f):\n        total += float(row['amount'])\n"
                           "print(f\"{'total':10} {total:8.2f}\")\n"), inp=1700, out=120),
        reply("tool_use", call("x3", "run_python", path="scripts/totals.py"), inp=1900, out=40),
        reply("end_turn", text("Fixed: it now uses float(). The total is **82.50**."), inp=2000, out=30)),
        settings={"run_code": {"enabled": True}})
    send(s, "Run scripts/totals.py. If it fails, fix it and run it again until it works.", answer=True)
    run_code.run_python = real_run_python
    save("run_code", s)

    # 17. Fifty tools: the 40 office tools sent on every call, so each call is much bigger
    book = dict(room="B", date="2026-10-14", start_time="15:00", people=4)
    s = session(Scripted(
        reply("tool_use", call("o1", "book_room", **book), inp=5400, out=50),
        reply("end_turn", text("Room B is booked for 15:00 tomorrow, for 4 people."), inp=5600, out=25)),
        settings={"extra_tools": {"enabled": True, "mode": "all"}})
    send(s, "Book meeting room B for 3pm tomorrow for 4 people.")
    save("extra_tools_all", s)

    # 18. Find a tool first: a small first call, find_tool loads book_room, the next call's tools grow
    s = session(Scripted(
        reply("tool_use", call("f1", "find_tool", query="book a meeting room"), inp=1300, out=30),
        reply("tool_use", call("f2", "book_room", **book), inp=1900, out=50),
        reply("end_turn", text("Room B is booked for 15:00 tomorrow, for 4 people."), inp=2100, out=25)),
        settings={"extra_tools": {"enabled": True, "mode": "find"}})
    send(s, "Book meeting room B for 3pm tomorrow for 4 people.")
    save("find_tool", s)


if __name__ == "__main__":
    main()
