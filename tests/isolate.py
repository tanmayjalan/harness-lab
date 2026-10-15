"""Imported by every test file: point everything the lab reads or saves at a temporary folder,
so tests never read or change your real profile, settings, conversations, hooks or workspace."""
import atexit
import pathlib
import shutil
import tempfile

from harness.core import tools
from harness.features import hooks, lab_settings, memory
from harness.web import conversations

TMP = pathlib.Path(tempfile.mkdtemp(prefix="harness-tests-"))
atexit.register(shutil.rmtree, TMP, ignore_errors=True)  # deleted when the test run ends
memory.PATH = TMP / "profile.json"
lab_settings.PATH = TMP / "lab_settings.json"
conversations.DIR = TMP / "conversations"
from harness import evals  # noqa: E402
evals.HISTORY = TMP / "evals"
from harness.web import compare  # noqa: E402
compare.HISTORY = TMP / "compare"
# No checkpoints for Rewind: the test workspace (below) is the whole temp folder, too big and busy to copy for
# every message. The Rewind tests turn it on with a workspace of their own
from harness.features import checkpoints  # noqa: E402
checkpoints.ON = False
checkpoints.DIR = TMP / "checkpoints"

# Tests use temporary folders for files; count the whole temp area as the workspace
tools.WORKSPACE = pathlib.Path(tempfile.gettempdir())

# No skills unless a test makes its own (config/skills/ is yours to edit)
from harness.features import skills  # noqa: E402
skills.DIR = TMP / "skills"

# No hooks unless a test loads its own (so tests never write to your tool log)
hooks.PATH = TMP / "no_hooks_in_tests.py"

# No test reaches the internet (get_weather asks Open-Meteo); tests that need it fake fetch_json
from harness.core import toy_tools  # noqa: E402


def _offline(url):
    raise OSError(f"tests don't use the internet (asked for {url})")


toy_tools.fetch_json = _offline

# Nor a model server you may be running (Ollama, LM Studio): local providers find none, unless a test serves
# its own (tests/test_local_models.py puts real_ask back, with a fake server of its own)
from harness.core import local_models  # noqa: E402
local_models.PATH = TMP / "local_servers.json"
local_models.real_ask = local_models._ask


def _no_local_servers(url, key, body=None):
    raise OSError(f"tests don't use local model servers (asked for {url})")


local_models._ask = _no_local_servers
