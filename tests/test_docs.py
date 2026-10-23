"""The Markdown files' links: every link to a file in this repo, and every #section, must lead somewhere.
Also two facts the docs state that could drift: the file map names every Python file, and the handbook count.

Run:  python -m unittest test_docs
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import os
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
# Not checked: tools' folders, your saved data, and workspace/ (the model writes there, so its files change)
SKIP = {".git", ".venv", "node_modules", "data", "workspace", ".claude", ".superpowers", ".ux-review"}
LINK = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")   # [text](target) and ![alt](target)
FENCE = re.compile(r"^(```|~~~).*?^\1", re.S | re.M)                    # code blocks: links in them are examples


def markdown_files():
    found = []
    for folder, dirs, files in os.walk(ROOT):
        # Python environments (whatever they're called) hold other projects' docs: not ours to check
        dirs[:] = [d for d in dirs if d not in SKIP and not os.path.exists(os.path.join(folder, d, "pyvenv.cfg"))]
        found += [pathlib.Path(folder, f) for f in files if f.endswith(".md")]
    return sorted(found)


def anchor(heading):
    """GitHub's id for a heading: lower case, punctuation dropped, spaces turned into hyphens."""
    text = re.sub(r"[`*_]|\[([^\]]*)\]\([^)]*\)", r"\1", heading).strip().lower()
    return re.sub(r"[^\w\- ]", "", text).replace(" ", "-")


def anchors(path):
    text = FENCE.sub("", path.read_text(encoding="utf-8"))
    return {anchor(h) for h in re.findall(r"^#{1,6}\s+(.+?)\s*#*$", text, re.M)}


class DocLinks(unittest.TestCase):
    def test_there_are_docs_to_check(self):
        names = {p.relative_to(ROOT).as_posix() for p in markdown_files()}
        self.assertIn("README.md", names)
        self.assertIn("docs/README.md", names)

    def test_every_link_leads_somewhere(self):
        broken = []
        for md in markdown_files():
            text = FENCE.sub("", md.read_text(encoding="utf-8"))
            for target in LINK.findall(text):
                if re.match(r"[a-z]+:", target):   # https:, mailto: and so on: not checked offline
                    continue
                file_part, _, section = target.partition("#")
                dest = (md.parent / file_part).resolve() if file_part else md
                where = f"{md.relative_to(ROOT).as_posix()} -> {target}"
                if not dest.exists():
                    broken.append(f"{where}: no such file")
                elif section and dest.suffix == ".md" and section not in anchors(dest):
                    broken.append(f"{where}: no such section")
        self.assertEqual(broken, [], "\n".join(broken))

    def test_the_file_map_names_every_python_file(self):
        """How it's built promises one line per file: a new file in harness/ must get its line."""
        text = (ROOT / "docs" / "architecture.md").read_text(encoding="utf-8")
        section = text.split("## What's where", 1)[1]
        tree = re.search(r"^```\n(.*?)^```", section, re.S | re.M).group(1)
        named = set(re.findall(r"[├└]──\s+([\w.]+\.py)\b", tree))
        code = ROOT / "harness"
        files = {p.name for p in code.rglob("*.py")
                 if p.name != "__init__.py" and "static" not in p.relative_to(code).parts}
        self.assertTrue(files, "no Python files found in harness/")
        self.assertEqual(sorted(files - named), [], "in harness/ but not in docs/architecture.md's file map")

    def test_the_handbook_count_matches_the_handbook(self):
        """The docs say how many policies the sample handbook has; its README.md is the index, not a policy."""
        handbook = ROOT / "workspace" / "handbook"
        policies = len([p for p in handbook.glob("*.md") if p.name.lower() != "readme.md"])
        stated = []
        for rel in ("docs/learning-path.md", "docs/architecture.md", "workspace/README.txt"):
            for count in re.findall(r"(\d+) short policies", (ROOT / rel).read_text(encoding="utf-8")):
                stated.append((rel, int(count)))
        self.assertTrue(stated, "no handbook count found in the docs")
        self.assertEqual([s for s in stated if s[1] != policies], [], f"the handbook has {policies} policies")

    def test_anchor_matches_github(self):
        self.assertEqual(anchor("Start and stop"), "start-and-stop")
        self.assertEqual(anchor("What the mock can't show, and what hasn't been tried live"),
                         "what-the-mock-cant-show-and-what-hasnt-been-tried-live")
        self.assertEqual(anchor("Two loops: a workflow"), "two-loops-a-workflow")
        self.assertEqual(anchor("`start.bat` options"), "startbat-options")


if __name__ == "__main__":
    unittest.main()
