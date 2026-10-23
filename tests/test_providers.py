"""Offline tests for providers.py and for passing the model name through.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import os
import unittest
from types import SimpleNamespace as NS
from unittest import mock

from anthropic.types import TextBlock

from harness.core import loop
from harness.core import providers
from harness.web import server as web_server


class env_without_keys:
    """The real environment (the SDK needs things like the home folder), minus any keys,
    and with no keys saved by setx either."""

    def __init__(self, **extra):
        env = {k: v for k, v in os.environ.items()
               if k not in ("DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "MOCK_KEY")}
        self.patches = [mock.patch.dict(os.environ, {**env, **extra}, clear=True),
                        mock.patch.object(providers, "saved_key", return_value=None)]

    def __enter__(self):
        for p in self.patches:
            p.start()

    def __exit__(self, *exc):
        for p in self.patches:
            p.stop()


class ProviderTests(unittest.TestCase):
    def test_deepseek_without_a_key_explains_what_to_do(self):
        with env_without_keys():
            with self.assertRaises(providers.MissingKey) as caught:
                providers.make_client("deepseek")
        self.assertIn("DEEPSEEK_API_KEY", str(caught.exception))

    # A missing key is an ordinary error: `except Exception` catches it (a SystemExit would slip past and end
    # whatever thread it happened in). The command-line start-ups turn it into a plain message themselves
    def test_a_missing_key_is_an_ordinary_error(self):
        self.assertTrue(issubclass(providers.MissingKey, Exception))
        self.assertFalse(issubclass(providers.MissingKey, SystemExit))

    def test_the_terminal_version_says_a_key_is_missing_and_stops(self):
        import contextlib
        import io
        from harness import cli
        err = io.StringIO()
        with env_without_keys(), mock.patch("sys.argv", ["cli", "--provider", "anthropic"]), \
                contextlib.redirect_stderr(err):
            with self.assertRaises(SystemExit) as caught:
                cli.main()
        self.assertEqual(caught.exception.code, 1)
        self.assertIn("ANTHROPIC_API_KEY", err.getvalue())

    def test_deepseek_uses_its_own_address_and_key(self):
        with env_without_keys(DEEPSEEK_API_KEY="sk-test", ANTHROPIC_API_KEY="other"):
            client = providers.make_client("deepseek")
        self.assertEqual(str(client.base_url).rstrip("/"), "https://api.deepseek.com/anthropic")
        self.assertEqual(client.api_key, "sk-test")

    def test_mock_needs_no_key_and_does_not_retry(self):
        with env_without_keys():
            client = providers.make_client("mock")
        self.assertEqual(str(client.base_url).rstrip("/"), "http://127.0.0.1:8765")
        self.assertEqual(client.max_retries, 0)

    def test_the_mock_key_comes_from_serve_or_mock_key(self):
        # The mock checks a key: the lab passes the one serve() made; a mock you start yourself uses MOCK_KEY
        with env_without_keys(MOCK_KEY="chosen"):
            self.assertEqual(providers.make_client("mock").api_key, "chosen")
            self.assertEqual(providers.make_client("mock", api_key="from-serve").api_key, "from-serve")

    def test_key_saved_with_setx_is_found(self):
        with env_without_keys():
            providers.saved_key.return_value = "sk-saved"
            self.assertIsNone(providers.missing_key("deepseek"))
            self.assertEqual(providers.make_client("deepseek").api_key, "sk-saved")

    def test_missing_key_is_reported(self):
        with env_without_keys():
            self.assertEqual(providers.missing_key("deepseek"), "DEEPSEEK_API_KEY")
            self.assertEqual(providers.missing_key("anthropic"), "ANTHROPIC_API_KEY")
            self.assertIsNone(providers.missing_key("mock"))

    def test_cost_from_reported_tokens(self):
        usage = {"input_tokens": 1_000_000, "cache_read_input_tokens": 0, "output_tokens": 500_000}
        self.assertAlmostEqual(providers.cost("deepseek", usage), 0.30 + 0.60)
        self.assertAlmostEqual(providers.cost("anthropic", usage), 4.00 + 10.00)
        self.assertAlmostEqual(providers.cost("deepseek", {"cache_read_input_tokens": 1_000_000}), 0.006)
        self.assertIsNone(providers.cost("mock", usage))      # no model given: no price
        self.assertIsNone(providers.cost("deepseek", None))   # nothing reported

    def test_cache_writes_cost_more_and_the_mock_prices_each_model(self):
        written = {"cache_creation_input_tokens": 1_000_000}
        self.assertAlmostEqual(providers.cost("anthropic", written), 5.00)   # 1.25 x the input price
        self.assertAlmostEqual(providers.cost("deepseek", written), 0.30)    # no write price: same as input
        usage = {"input_tokens": 1_000_000, "output_tokens": 1_000_000}
        self.assertAlmostEqual(providers.cost("mock", usage, "claude-haiku-4-5-20251001"), 1.00 + 5.00)
        self.assertAlmostEqual(providers.cost("mock", usage, "claude-opus-5-5"), 4.00 + 20.00)

    def test_the_mock_prices_sonnet_5_5_at_its_list_price(self):
        # F379: $2 in / $10 out, cache reads $0.20 (writes 1.25 x input), per million tokens
        sonnet = providers.price("mock", "claude-sonnet-5-5")
        self.assertEqual((sonnet["input"], sonnet["output"], sonnet["cached"], sonnet["cache_write"]), (2.00, 10.00, 0.20, 2.50))
        usage = {"input_tokens": 1_000_000, "output_tokens": 100_000}
        self.assertAlmostEqual(providers.cost("mock", usage, "claude-sonnet-5-5"), 2.00 + 1.00)

    def test_every_price_says_where_it_comes_from_and_when(self):
        # F384: the page shows the source and the date beside costs and window sizes
        for name, p in providers.PROVIDERS.items():
            source = p.get("source") or {}
            self.assertTrue(source.get("prices") and source.get("windows"), name)
            self.assertRegex(source.get("checked", ""), r"^\d{4}-\d{2}-\d{2}$", name)

    def test_thinking_styles(self):
        self.assertEqual(providers.thinking_style("anthropic"), "adaptive")
        self.assertEqual(providers.thinking_style("mock"), "budget")

    def test_every_provider_names_a_model(self):
        # (a server you run has whatever models you put on it: they're found when needed, test_local_models.py)
        for name, p in providers.PROVIDERS.items():
            self.assertTrue(p["model"] or providers.is_local(name), name)


class RecordingClient:
    def __init__(self):
        self.models = []
        self.messages = self

    def create(self, **kwargs):
        self.models.append(kwargs["model"])
        return NS(stop_reason="end_turn", content=[TextBlock(type="text", text="hi")])


class ModelPassThroughTests(unittest.TestCase):
    def test_agent_sends_the_model_it_is_given(self):
        client = RecordingClient()
        loop.agent([{"role": "user", "content": "hi"}], client, model="deepseek-v4-pro")
        self.assertEqual(client.models, ["deepseek-v4-pro"])

    def test_web_session_uses_its_model(self):
        client = RecordingClient()
        s = web_server.Session(client, "DeepSeek", model="deepseek-v4-pro")
        s.start("hi")
        while s.running:
            pass
        self.assertEqual(client.models, ["deepseek-v4-pro"])


if __name__ == "__main__":
    unittest.main()


class PlainErrorTests(unittest.TestCase):
    # F399: claude -p's own sign-in failing is a Claude Code problem, not an API key one
    def test_an_expired_claude_sign_in_says_to_sign_in_again(self):
        for raw in ("Error code: 500 - claude -p exited 1: Failed to authenticate: OAuth session expired and could "
                    "not be refreshed", "claude -p exited 1: Invalid API key · Please run /login"):
            with self.subTest(raw=raw):
                said = providers.plain_error(raw)
                self.assertIn("Claude Code isn't signed in", said)
                self.assertNotIn("ANTHROPIC_API_KEY", said)
        self.assertIn("ANTHROPIC_API_KEY", providers.plain_error("Error code: 401 - authentication_error"))

    def test_the_mock_refusing_its_key_is_said_plainly(self):
        said = providers.plain_error("Error code: 401 - wrong or missing key for this mock server")
        self.assertIn("MOCK_KEY", said)
        self.assertNotIn("ANTHROPIC_API_KEY", said)

    # F240: the loop's own call limit, in the words the chat uses
    def test_the_call_limit_in_plain_words(self):
        self.assertEqual(providers.plain_error("RuntimeError: Stopped: hit max_turns (20)"),
                         "Stopped after 20 model calls: the most allowed for one message.")

