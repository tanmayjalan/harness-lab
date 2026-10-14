"""Offline tests for toy_tools.py and how the harness reaches them.

Run:  python -m unittest -v
"""
import isolate  # noqa: F401  (keeps tests away from your real files)
import pathlib
import tempfile
import unittest

from harness.core import loop, tools
from harness.core import toy_tools


class ToyToolTests(unittest.TestCase):
    def test_temperature(self):
        self.assertEqual(toy_tools.convert_temperature(100, "celsius", "fahrenheit"), "100 celsius = 212.0 fahrenheit")
        self.assertEqual(toy_tools.convert_temperature(32, "Fahrenheit", "kelvin"), "32 fahrenheit = 273.15 kelvin")
        with self.assertRaises(ValueError):
            toy_tools.convert_temperature(-300, "celsius", "kelvin")  # below absolute zero
        with self.assertRaises(ValueError):
            toy_tools.convert_temperature(1, "celsius", "rankine")

    def test_calculator_does_arithmetic(self):
        self.assertEqual(toy_tools.calculate("(2,450 * 17) / 100"), "(2,450 * 17) / 100 = 416.5")
        self.assertEqual(toy_tools.calculate("2 ** 10 - -3"), "2 ** 10 - -3 = 1027")

    def test_calculator_refuses_anything_else(self):
        for bad in ["__import__('os').system('dir')", "open('x')", "x + 1", "'a' * 3", "9 ** 999999"]:
            with self.subTest(bad=bad), self.assertRaises((ValueError, SyntaxError)):
                toy_tools.calculate(bad)

    def test_time(self):
        self.assertIn("in Asia/Tokyo (UTC+0900)", toy_tools.get_current_time("Asia/Tokyo"))
        with self.assertRaises(Exception):
            toy_tools.get_current_time("Mars/Olympus_Mons")

    def test_dice(self):
        result = toy_tools.roll_dice(sides=6, count=3)
        self.assertTrue(result.startswith("Rolled 3d6: ["))
        with self.assertRaises(ValueError):
            toy_tools.roll_dice(sides=1)

    def fake_web(self, places, current=None, fail=None):
        """Stand in for Open-Meteo: record each URL asked for and answer from the given data."""
        asked = []

        def fetch(url):
            asked.append(url)
            if fail:
                raise fail
            if "geocoding" in url:
                return {"results": places}
            return {"current": current}
        old = toy_tools.fetch_json
        toy_tools.fetch_json = fetch
        self.addCleanup(setattr, toy_tools, "fetch_json", old)
        return asked

    def test_weather_finds_the_city_then_asks_for_its_weather(self):
        asked = self.fake_web([{"name": "Paris", "admin1": "Île-de-France", "country": "France",
                                "latitude": 48.85, "longitude": 2.35}],
                              {"time": "2026-10-03T20:00", "temperature_2m": 19.6, "relative_humidity_2m": 49,
                               "wind_speed_10m": 5.5, "weather_code": 61})
        result = toy_tools.get_weather("Paris")
        self.assertTrue(result.startswith("Paris, Île-de-France, France: 19.6 °C, light rain, humidity 49%"))
        self.assertIn("name=Paris", asked[0])                       # the city the model chose goes out here
        self.assertIn("latitude=48.85&longitude=2.35", asked[1])    # and the place it found, here
        self.assertIn(asked[0], result)                             # the result shows both requests
        self.assertIn(asked[1], result)

    def test_weather_errors_reach_the_model_as_errors(self):
        self.fake_web([])
        with self.assertRaisesRegex(ValueError, "no place called 'Atlantis'"):
            toy_tools.get_weather("Atlantis")
        self.fake_web([], fail=OSError("timed out"))
        with self.assertRaisesRegex(RuntimeError, "couldn't reach the weather service"):
            toy_tools.get_weather("Paris")

    def test_tests_never_use_the_internet(self):
        with self.assertRaises(OSError):
            toy_tools.fetch_json("https://example.com")  # tests/isolate.py blocks it

    def test_search_ranks_files_and_never_looks_in_hidden_ones(self):
        root = pathlib.Path(tempfile.mkdtemp())
        (root / "handbook").mkdir()
        (root / "handbook" / "refunds.md").write_text("# Refunds\nAnnual plans: refund within 30 days.\nRefund rules.", encoding="utf-8")
        (root / "handbook" / "travel.md").write_text("# Travel\nBook trains. No refund on tickets.", encoding="utf-8")
        (root / "private").mkdir()
        (root / "private" / ".env").write_text("REFUND_SECRET=hunter2", encoding="utf-8")
        old = tools.WORKSPACE
        tools.WORKSPACE = root
        self.addCleanup(setattr, tools, "WORKSPACE", old)
        found = tools.run_tool("search_files", {"query": "refund annual"})
        self.assertTrue(found.startswith("handbook/refunds.md"))     # most matches first
        self.assertIn("handbook/travel.md", found)
        self.assertNotIn("hunter2", found)                             # hidden files are never searched
        self.assertNotIn(".env", found)
        self.assertEqual(tools.run_tool("search_files", {"query": "zebra"}), "No files mention 'zebra'.")

    def test_expense_form_checks_its_shape(self):
        ok = toy_tools.submit_expense("2026-10-03", 38.5, "EUR", "travel", "taxi to the airport")
        self.assertIn("2026-10-03, 38.50 EUR, travel, taxi to the airport", ok)
        with self.assertRaisesRegex(ValueError, "date must be YYYY-MM-DD.*currency must be one of"):
            toy_tools.submit_expense("yesterday", 38.5, "euros", "travel")
        with self.assertRaisesRegex(ValueError, "amount must be a number above 0"):
            toy_tools.submit_expense("2026-10-03", "38.50", "EUR", "travel")

    def test_strict_goes_only_to_the_anthropic_api(self):
        from harness.core import providers
        strict = [t for t in tools.TOOLS if t.get("strict")]
        self.assertEqual([t["name"] for t in strict], ["submit_expense"])
        self.assertTrue(any(t.get("strict") for t in providers.tools_for("anthropic", tools.TOOLS)))
        for name in ("mock", "deepseek"):
            self.assertFalse(any("strict" in t for t in providers.tools_for(name, tools.TOOLS)))
        self.assertTrue(strict[0]["strict"])  # the original list is left as it was

    def test_every_tool_has_a_handler_and_the_harness_offers_it(self):
        names = {t["name"] for t in toy_tools.TOOLS}
        self.assertEqual(names, set(toy_tools.HANDLERS))
        self.assertTrue(names <= {t["name"] for t in tools.TOOLS})

    def test_harness_runs_a_toy_tool_and_rejects_bad_input(self):
        self.assertIn("212.0", tools.run_tool("convert_temperature",
                                                {"value": 100, "from_unit": "celsius", "to_unit": "fahrenheit"}))
        with self.assertRaises(TypeError):  # the agent loop turns this into an is_error result
            tools.run_tool("roll_dice", {"faces": 6})


if __name__ == "__main__":
    unittest.main()
