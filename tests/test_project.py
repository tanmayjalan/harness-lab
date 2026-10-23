"""Offline tests for the project files: pyproject.toml and requirements.txt say the same thing.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import re
import unittest

from harness import paths


def requirement_lines():
    """requirements.txt without comments: what setup.bat installs."""
    text = (paths.ROOT / "requirements.txt").read_text(encoding="utf-8")
    return sorted(re.sub(r"\s+", "", line.split("#")[0]) for line in text.splitlines() if line.split("#")[0].strip())


class ProjectFileTests(unittest.TestCase):
    # setup.bat installs requirements.txt; tools that read pyproject.toml must see the same packages
    def test_pyproject_lists_the_same_packages_as_requirements(self):
        try:
            import tomllib
        except ImportError:  # (Python 3.10 has no tomllib: the newer Python in CI checks it)
            self.skipTest("tomllib needs Python 3.11")
        project = tomllib.loads((paths.ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]
        self.assertEqual(sorted(re.sub(r"\s+", "", d) for d in project["dependencies"]), requirement_lines())
        self.assertEqual(project["requires-python"], ">=3.10")
