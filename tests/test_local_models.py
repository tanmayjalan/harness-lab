"""Offline tests for models on your own server (local_models.py and the local providers): a fake server
on this computer plays Ollama or LM Studio, so nothing needs to be installed or running.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files, and from any real model server)
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

from harness.core import local_models, providers


class FakeServer:
    """A stand-in for Ollama or LM Studio: GET /v1/models lists `models`; POST /api/show says what each can do."""

    def __init__(self, models=("small:1b", "tooly:4b"), no_tools=("small:1b",), models_body=None, status=200):
        self.asked = []
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                fake.asked.append(("GET", self.path, self.headers.get("x-api-key")))
                if self.path != "/v1/models":
                    return self.reply(404, b"404 page not found")
                body = models_body if models_body is not None else json.dumps(
                    {"object": "list", "data": [{"id": m, "object": "model"} for m in models]}).encode()
                self.reply(status, body)

            def do_POST(self):
                asked = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
                fake.asked.append(("POST", self.path, asked.get("model")))
                caps = ["completion"] + ([] if asked.get("model") in no_tools else ["tools"])
                self.reply(200, json.dumps({"capabilities": caps}).encode())

            def reply(self, code, body):
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def __enter__(self):
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        local_models.forget()
        self.patch = mock.patch.object(local_models, "_ask", local_models.real_ask)  # this test's own server only
        self.patch.start()
        return self

    def __exit__(self, *exc):
        self.patch.stop()
        self.server.shutdown()
        self.server.server_close()
        local_models.forget()


def free_port():
    """A port nothing listens on (just opened and closed)."""
    s = ThreadingHTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
    port = s.server_port
    s.server_close()
    return port


class AddressTests(unittest.TestCase):
    def tearDown(self):
        local_models.PATH.unlink(missing_ok=True)

    def test_an_address_is_tidied_for_the_sdk(self):
        self.assertEqual(local_models.clean_url("http://127.0.0.1:11434/"), "http://127.0.0.1:11434")
        self.assertEqual(local_models.clean_url("http://127.0.0.1:1234/v1"), "http://127.0.0.1:1234")  # the SDK adds /v1
        self.assertEqual(local_models.clean_url(" 192.168.1.20:11434 "), "http://192.168.1.20:11434")
        self.assertEqual(local_models.clean_url("https://models.example.com/proxy/v1/"), "https://models.example.com/proxy")

    def test_what_isnt_an_address_is_refused_in_plain_words(self):
        for bad in ("", "ftp://host", "http://", "http://host:port", "http://host/?a=1"):
            with self.subTest(bad=bad), self.assertRaises(ValueError) as caught:
                local_models.clean_url(bad)
            self.assertTrue(str(caught.exception).endswith("."), bad)

    def test_this_computer_or_another(self):
        self.assertTrue(local_models.is_this_computer("http://127.0.0.1:11434"))
        self.assertTrue(local_models.is_this_computer("http://localhost:1234"))
        self.assertTrue(local_models.is_this_computer("http://[::1]:1234"))
        self.assertFalse(local_models.is_this_computer("http://192.168.1.20:11434"))
        self.assertFalse(local_models.is_this_computer(None))

    def test_a_saved_address_is_used_and_the_default_otherwise(self):
        self.assertEqual(providers.address_of("ollama"), "http://127.0.0.1:11434")
        self.assertIsNone(providers.address_of("custom"))
        local_models.save("custom", "10.0.0.5:8080/v1")
        self.assertEqual(providers.address_of("custom"), "http://10.0.0.5:8080")
        self.assertEqual(providers.address_of("ollama"), "http://127.0.0.1:11434")  # the others unchanged

    def test_the_sandbox_saves_addresses_in_its_own_copy(self):
        # start.bat -Fresh promises nothing reaches data/: an address saved there stays in the throwaway copy
        import shutil
        from harness.core import tools
        from harness.features import checkpoints, hooks, lab_settings, mcp_client, memory, skills
        from harness import evals, paths
        from harness.web import compare, conversations, sandbox
        for module, name in [(memory, "PATH"), (lab_settings, "PATH"), (conversations, "DIR"), (evals, "HISTORY"),
                             (compare, "HISTORY"), (checkpoints, "DIR"), (hooks, "PATH"), (paths, "CONFIG"),
                             (mcp_client, "CONFIG"), (skills, "DIR"), (tools, "WORKSPACE"), (local_models, "PATH")]:
            patcher = mock.patch.object(module, name, getattr(module, name))
            patcher.start()
            self.addCleanup(patcher.stop)
        tmp = sandbox.prepare(empty=True)
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        self.assertEqual(local_models.PATH, tmp / "data" / "local_servers.json")

    def test_a_damaged_file_means_no_saved_addresses(self):
        local_models.PATH.write_text("not json", encoding="utf-8")
        self.assertEqual(local_models.load(), {})


class DiscoverTests(unittest.TestCase):
    def test_models_are_listed_those_that_can_use_tools_first(self):
        with FakeServer() as fake:
            found = local_models.discover(fake.url, ollama=True)
        self.assertIsNone(found["problem"])
        self.assertEqual(found["models"], ["tooly:4b", "small:1b"])
        self.assertEqual(found["no_tools"], ["small:1b"])

    def test_only_ollama_is_asked_what_each_model_can_do(self):
        with FakeServer(models=("openai/gpt-oss-20b",)) as fake:
            found = local_models.discover(fake.url, ollama=False)
        self.assertEqual(found, {"models": ["openai/gpt-oss-20b"], "no_tools": [], "problem": None})
        self.assertEqual([a[0] for a in fake.asked], ["GET"])

    def test_the_answer_is_reused_for_a_few_seconds(self):
        with FakeServer() as fake:
            local_models.discover(fake.url)
            local_models.discover(fake.url)
            self.assertEqual(sum(a[0] == "GET" for a in fake.asked), 1)
            local_models.forget()  # Check again
            local_models.discover(fake.url)
            self.assertEqual(sum(a[0] == "GET" for a in fake.asked), 2)

    def test_the_key_is_sent_when_there_is_one(self):
        with FakeServer() as fake:
            local_models.discover(fake.url, key="secret")
        self.assertEqual(fake.asked[0][2], "secret")

    def test_nothing_running_says_how_to_start_it(self):
        url = f"http://127.0.0.1:{free_port()}"
        with mock.patch.object(local_models, "_ask", local_models.real_ask):
            found = local_models.discover(url, start_hint="Start Ollama.")
        self.assertEqual(found["models"], [])
        self.assertEqual(found["problem"], f"Nothing answered at {url}. Start Ollama.")

    def test_no_models_says_how_to_get_one(self):
        with FakeServer(models=()) as fake:
            found = local_models.discover(fake.url, models_hint="Get one with ollama pull.")
        self.assertIn("has no models", found["problem"])
        self.assertIn("ollama pull", found["problem"])

    def test_an_answer_that_isnt_a_model_list(self):
        for body in (b"<html>hello</html>", b'{"models": []}', b"[1, 2]"):
            with self.subTest(body=body), FakeServer(models_body=body) as fake:
                self.assertIn("not with a list of models", local_models.discover(fake.url)["problem"])

    def test_a_server_that_wants_a_key_says_which_variable(self):
        with FakeServer(status=401) as fake:
            self.assertIn("LOCAL_API_KEY", local_models.discover(fake.url)["problem"])

    def test_no_address_yet(self):
        self.assertIn("No address yet", local_models.discover(None)["problem"])


class LocalProviderTests(unittest.TestCase):
    def tearDown(self):
        local_models.PATH.unlink(missing_ok=True)
        local_models.forget()

    def test_the_models_and_the_default_come_from_the_server(self):
        with FakeServer() as fake:
            local_models.save("ollama", fake.url)
            self.assertEqual(providers.models("ollama"), ["tooly:4b", "small:1b"])
            self.assertEqual(providers.default_model("ollama"), "tooly:4b")
            self.assertIsNone(providers.unavailable("ollama"))

    def test_a_server_that_isnt_running_is_unavailable_with_the_reason(self):
        # (isolate.py lets no test reach a real server: as if none were running)
        self.assertEqual(providers.models("lmstudio"), [])
        self.assertIsNone(providers.default_model("lmstudio"))
        self.assertIn("LM Studio", providers.unavailable("lmstudio"))  # its own words for starting it

    def test_a_client_points_at_the_address_without_asking_the_server(self):
        local_models.save("custom", "http://192.168.1.20:8080")
        with mock.patch.dict("os.environ", {}, clear=False), mock.patch.object(providers, "get_key", return_value=None):
            client = providers.make_client("custom")
        self.assertEqual(str(client.base_url).rstrip("/"), "http://192.168.1.20:8080")
        self.assertEqual(client.api_key, "local")
        self.assertEqual(client.max_retries, 0)

    def test_local_api_key_is_used_when_set(self):
        with mock.patch.object(providers, "get_key", side_effect=lambda name: "k-123" if name == "LOCAL_API_KEY" else None):
            self.assertEqual(providers.make_client("lmstudio").api_key, "k-123")

    def test_no_address_means_no_client_rather_than_anthropics_address(self):
        with self.assertRaises(providers.MissingKey) as caught:
            providers.make_client("custom")
        self.assertIn("no address", str(caught.exception))

    def test_cloud_providers_are_not_local(self):
        self.assertFalse(providers.is_local("anthropic"))
        self.assertFalse(providers.is_local("mock"))
        self.assertTrue(all(providers.is_local(n) for n in ("ollama", "lmstudio", "custom")))


class PlainErrorTests(unittest.TestCase):
    def test_what_a_local_model_cant_do_is_said_plainly(self):
        cases = {
            'Error code: 400 - {"error": {"message": "registry.ollama.ai/library/gemma:2b does not support tools"}}': "can't use tools",
            'Error code: 400 - {"error": {"message": "\\"gemma3:1b\\" does not support thinking"}}': "Turn thinking off",
            'Error code: 404 - {"error": {"message": "model \\"nope\\" not found, try pulling it first"}}': "ollama pull",
            "Error code: 404 - 404 page not found": "update it",
        }
        for raw, words in cases.items():
            with self.subTest(raw=raw):
                self.assertIn(words, providers.plain_error(raw))

    def test_cannot_reach_names_ollama_and_lm_studio(self):
        self.assertIn("Ollama or LM Studio", providers.plain_error("APIConnectionError: Connection error."))


if __name__ == "__main__":
    unittest.main()
