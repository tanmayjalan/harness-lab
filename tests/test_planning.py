"""Offline tests for planning.py: the model's step-by-step plan.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import unittest

from harness.core import loop, tools
from harness.features import planning


def step(text, status):
    return {"text": text, "status": status}


class PlanTests(unittest.TestCase):
    def test_plan_comes_back_as_a_checklist(self):
        out = planning.update({"steps": [step("Read the files", "done"), step("Compare them", "in_progress"),
                                         step("Write the summary", "pending")]})
        self.assertTrue(out.startswith("Plan saved: 1 of 3 done. Next: Compare them."))
        self.assertIn("[x] Read the files\n[>] Compare them\n[ ] Write the summary", out)

    def test_all_done(self):
        self.assertIn("All steps done.", planning.update({"steps": [step("Only step", "done")]}))

    def test_bad_plans_are_refused(self):
        for bad in [{}, {"steps": []}, {"steps": [step("", "done")]}, {"steps": [step("a", "maybe")]},
                    {"steps": [step("a", "in_progress"), step("b", "in_progress")]},
                    {"steps": [step(str(i), "pending") for i in range(21)]}]:
            with self.subTest(bad=str(bad)[:40]), self.assertRaises(ValueError):
                planning.update(bad)

    def test_the_harness_offers_and_runs_it(self):
        self.assertIn("update_plan", [t["name"] for t in tools.TOOLS])
        self.assertIn("1 of 2 done", tools.run_tool("update_plan", {"steps": [step("a", "done"), step("b", "pending")]}))


if __name__ == "__main__":
    unittest.main()
