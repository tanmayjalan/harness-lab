"""Offline tests for visible retries: the loop tries a busy or failing call again itself, and says so.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import pathlib
import threading
import time
import unittest
from types import SimpleNamespace as NS
from unittest import mock

import anthropic
import httpx2
from anthropic.types import TextBlock, ToolUseBlock

from harness.core import loop, providers, tools
from harness.features import compaction, lab_settings, subagents
from harness.web import compare


def api_error(status, headers=None):
    response = httpx2.Response(status, request=httpx2.Request("POST", "https://api.example/v1/messages"), headers=headers or {})
    cls = {529: anthropic.OverloadedError, 429: anthropic.RateLimitError, 400: anthropic.BadRequestError,
           503: anthropic.InternalServerError}.get(status, anthropic.InternalServerError)
    return cls(f"Error code: {status}", response=response, body=None)


def answer(text="ok"):
    return NS(stop_reason="end_turn", content=[TextBlock(type="text", text=text)])


class Client:
    """Each item is a reply, or an exception to raise for that call."""

    def __init__(self, *items):
        self.items = list(items)
        self.calls = 0
        self.messages = self

    def create(self, **kwargs):
        self.calls += 1
        item = self.items.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item


def run(client, **kw):
    events = []
    text = loop.agent([{"role": "user", "content": "hi"}], client, confirm=None,
                      on_event=lambda kind, **d: events.append((kind, d)), **kw)
    return text, events


def kinds(events):
    return [k for k, _ in events]


class RetryTests(unittest.TestCase):
    def test_a_busy_service_is_tried_again_and_the_retry_is_shown(self):
        client = Client(api_error(529, {"retry-after-ms": "10"}), answer("fine"))
        text, events = run(client)
        self.assertEqual(text, "fine")
        self.assertEqual(client.calls, 2)
        self.assertEqual(kinds(events), ["request", "retry", "response"])  # on the same call, between the two
        retry = dict(events)["retry"]
        self.assertEqual((retry["turn"], retry["attempt"], retry["status"], retry["wait"], retry["simulated"]),
                         (1, 1, 529, 0.01, False))
        self.assertEqual(retry["reason"], "the service is overloaded")

    def test_retry_after_in_seconds_is_followed(self):
        client = Client(api_error(429, {"retry-after": "0.05"}), answer())
        started = time.time()
        _, events = run(client)
        self.assertEqual(dict(events)["retry"]["wait"], 0.05)
        self.assertGreaterEqual(time.time() - started, 0.05)

    def test_without_retry_after_it_waits_half_a_second_then_doubles(self):
        self.assertEqual([loop.retry_wait(api_error(500), n) for n in (1, 2, 3, 5)], [0.5, 1.0, 2.0, 8.0])

    def test_a_bad_request_is_not_tried_again(self):
        client = Client(api_error(400), answer())
        with self.assertRaises(anthropic.BadRequestError):
            run(client)
        self.assertEqual(client.calls, 1)

    def test_the_service_can_say_not_to_try_again(self):
        client = Client(api_error(500, {"x-should-retry": "false"}), answer())
        with self.assertRaises(anthropic.InternalServerError):
            run(client)
        self.assertEqual(client.calls, 1)

    def test_at_most_two_retries(self):
        busy = lambda: api_error(529, {"retry-after-ms": "1"})  # noqa: E731
        client = Client(busy(), busy(), busy(), answer())
        events = []
        with self.assertRaises(anthropic.OverloadedError):
            loop.agent([{"role": "user", "content": "hi"}], client, confirm=None,
                       on_event=lambda kind, **d: events.append((kind, d)))
        self.assertEqual(client.calls, 3)
        self.assertEqual([d["attempt"] for k, d in events if k == "retry"], [1, 2])

    def test_a_connection_error_is_tried_again(self):
        client = Client(anthropic.APIConnectionError(request=httpx2.Request("POST", "https://x")), answer())
        with mock.patch.object(loop, "retry_wait", lambda e, n: 0.01):
            _, events = run(client)
        retry = dict(events)["retry"]
        self.assertEqual((retry["status"], retry["reason"]), (None, "could not reach the service"))

    def test_stop_while_waiting_ends_the_message(self):
        client = Client(api_error(529, {"retry-after": "5"}), answer())
        stop = threading.Event()
        threading.Timer(0.2, stop.set).start()
        started = time.time()
        with self.assertRaises(loop.Stopped):
            loop.agent([{"role": "user", "content": "hi"}], client, confirm=None, should_stop=stop.is_set)
        self.assertLess(time.time() - started, 2)
        self.assertEqual(client.calls, 1)

    def test_a_reply_that_already_started_streaming_is_not_sent_again(self):
        class Stream:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            @property
            def text_stream(self):
                yield "Hel"
                raise api_error(529, {"retry-after-ms": "1"})

        class Streaming(Client):
            def stream(self, **kwargs):
                self.calls += 1
                return Stream()

        client = Streaming()
        with self.assertRaises(anthropic.OverloadedError):
            loop.agent([{"role": "user", "content": "hi"}], client, confirm=None, stream=True)
        self.assertEqual(client.calls, 1)

    # The practice switch: the first try of each call fails as if the service were busy, before anything is sent
    def test_the_practice_switch_fails_the_first_try_without_sending_it(self):
        client = Client(answer("after the retry"))
        text, events = run(client, busy=True)
        self.assertEqual(text, "after the retry")
        self.assertEqual(client.calls, 1)  # the simulated failure never reached the service
        retry = dict(events)["retry"]
        self.assertEqual((retry["status"], retry["simulated"]), (529, True))


def delegate(task="look it up"):
    return NS(stop_reason="tool_use", content=[ToolUseBlock(type="tool_use", id="d1", name="delegate", input={"task": task})])


# The practice switch reaches every call a message makes: a helper's, and a comparison side's
@mock.patch.object(loop, "retry_wait", lambda e, attempt: 0.01)
class PracticeEverywhereTests(unittest.TestCase):
    def test_a_helper_follows_the_practice_switch(self):
        events = []
        report = subagents.run_helper({"task": "look"}, Client(answer("the report")), "m", tools.TOOLS, tools.run_tool,
                                      lambda kind, **d: events.append((kind, d)), lambda: False, busy=True)
        self.assertEqual(report, "the report")
        self.assertEqual([d["simulated"] for k, d in events if k == "retry"], [True])

    def test_off_a_helper_is_not_retried(self):
        events = []
        subagents.run_helper({"task": "look"}, Client(answer("r")), "m", tools.TOOLS, tools.run_tool,
                             lambda kind, **d: events.append((kind, d)), lambda: False)
        self.assertNotIn("retry", [k for k, _ in events])

    def test_the_chat_s_helper_follows_the_practice_switch(self):
        import tempfile
        from harness.web import server
        folder = pathlib.Path(tempfile.mkdtemp())
        session = server.Session(Client(answer("the report")), "test", provider="mock",
                                 settings_path=folder / "settings.json", profile_path=folder / "profile.json")
        session._busy_now, session.last_call = True, {"id": "d1"}  # as a message with the switch on sets them
        self.assertEqual(session.run_tool("delegate", {"task": "look"}), "the report")
        [retry] = [e for e in session.events if e["kind"] == "sub" and e["step"] == "retry"]
        self.assertEqual((retry["helper"], retry["call"], retry["simulated"]), ("d1", 1, True))

    def test_a_comparison_side_retries_and_records_it_for_itself_and_its_helper(self):
        client = Client(delegate(), answer("helper's report"), answer("done"))
        out = compare.run_one(client, "m", "hi", "S", tools.TOOLS, lambda name: "allow", busy=True)
        self.assertEqual(out["answer"], "done")
        self.assertEqual(client.calls, 3)  # the simulated failures never reached the service
        main = [e for e in out["events"] if e["kind"] == "retry"]
        helper = [e for e in out["events"] if e["kind"] == "sub" and e["step"] == "retry"]
        self.assertEqual([(e["turn"], e["simulated"]) for e in main], [(1, True), (2, True)])
        self.assertEqual([(e["helper"], e["call"], e["simulated"]) for e in helper], [("d1", 1, True)])

    def test_a_comparison_side_without_the_switch_is_not_retried(self):
        out = compare.run_one(Client(answer("done")), "m", "hi", "S", tools.TOOLS, lambda name: "allow")
        self.assertNotIn("retry", [e["kind"] for e in out["events"]])


class QuietRetriesTests(unittest.TestCase):
    # No quiet retries in the SDK: the loop does them, where you can see them
    def test_every_provider_s_client_has_no_retries_of_its_own(self):
        with mock.patch.object(providers, "get_key", lambda name: "key"):
            for name in providers.PROVIDERS:
                # ("Other server" has no address until you enter one: give it one here)
                address = "http://127.0.0.1:9" if providers.is_local(name) else None
                self.assertEqual(providers.make_client(name, base_url=address).max_retries, 0, name)

    # Summarising and the eval judge keep quiet retries: they aren't the lesson
    def test_summarising_keeps_quiet_retries(self):
        seen = {}

        class WithOptions(Client):
            def with_options(self, **kw):
                seen.update(kw)
                return self
        history = [{"role": "user", "content": "x" * 3000}, {"role": "assistant", "content": "y"}] * 4
        compaction.compact(history, WithOptions(answer("summary")), "m")
        self.assertEqual(seen, {"max_retries": 2})


class PlainWordsTests(unittest.TestCase):
    # F296: the errors a busy service gives, in plain words
    def test_overloaded_unavailable_and_timeouts(self):
        self.assertIn("overloaded", providers.plain_error("OverloadedError: Error code: 529 - {'type': 'overloaded_error'}"))
        self.assertIn("unavailable", providers.plain_error("InternalServerError: Error code: 503 - Service Unavailable"))
        self.assertIn("took too long", providers.plain_error("APITimeoutError: Request timed out or interrupted."))


class SettingTests(unittest.TestCase):
    def test_the_practice_switch_is_a_setting(self):
        clean = lambda c: lab_settings.clean(c, loop.SYSTEM, tools.TOOLS, loop.default_permission)  # noqa: E731
        self.assertEqual(clean({"faults": {"busy": True}})["faults"], {"busy": True})
        self.assertIsNone(clean({"faults": {"busy": False}})["faults"])
        self.assertIn("practice: busy service", lab_settings.what_changed(clean({"faults": {"busy": True}})))
        with self.assertRaises(ValueError):
            clean({"faults": "yes"})


if __name__ == "__main__":
    unittest.main()
