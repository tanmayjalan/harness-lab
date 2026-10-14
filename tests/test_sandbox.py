"""Offline tests for the sandbox (harness/web/sandbox.py): a throwaway copy of everything the lab uses.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import json
import unittest
from unittest import mock

from harness import evals, paths
from harness.core import tools
from harness.features import hooks, lab_settings, mcp_client, memory
from harness.web import compare, conversations, sandbox


class SandboxTests(unittest.TestCase):
    def setUp(self):
        # prepare() points the lab at its copy; put every one of those back afterwards, so the
        # other tests keep isolate.py's folders
        for module, name in [(memory, "PATH"), (lab_settings, "PATH"), (conversations, "DIR"), (evals, "HISTORY"),
                             (compare, "HISTORY"), (hooks, "PATH"), (tools, "WORKSPACE"), (paths, "CONFIG"),
                             (mcp_client, "CONFIG")]:
            patcher = mock.patch.object(module, name, getattr(module, name))
            patcher.start()
            self.addCleanup(patcher.stop)

    # F295: the sandbox reads its own copy of config/: the eval questions and the MCP servers
    def test_the_sandbox_reads_its_own_config(self):
        real_config, real_mcp = paths.CONFIG, mcp_client.CONFIG
        tmp = sandbox.prepare(empty=True)
        self.assertEqual(paths.CONFIG, tmp / "config")
        self.assertEqual(mcp_client.CONFIG, tmp / "config" / real_mcp.name)
        self.assertNotEqual(paths.CONFIG, real_config)
        copy = tmp / "config" / "evals.json"
        data = json.loads(copy.read_text(encoding="utf-8"))
        data["cases"] = [{"question": "Only in the sandbox?", "tools": []}]
        copy.write_text(json.dumps(data), encoding="utf-8")
        self.assertEqual([c["question"] for c in evals.cases_from_config()], ["Only in the sandbox?"])
        self.assertNotIn("Only in the sandbox?", (real_config / "evals.json").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
