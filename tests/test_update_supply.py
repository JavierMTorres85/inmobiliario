from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import json
import tempfile
import unittest

from scripts.update_supply import collect, load_locations, per_thousand


class FakeClient:
    def search(self, request):
        totals = {"sale": 120, "rent": 30}
        return SimpleNamespace(total=totals[request.operation])


class NormalizationTests(unittest.TestCase):
    def test_per_thousand_keeps_missing_denominator_missing(self):
        self.assertIsNone(per_thousand(10, None))
        self.assertEqual(per_thousand(25, 2000), 12.5)

    def test_collect_emits_raw_and_normalized_supply(self):
        payload = collect(
            FakeClient(),
            [
                {
                    "code": "28000",
                    "name": "Ejemplo",
                    "level": "municipality",
                    "location_id": "location-1",
                    "population": 10_000,
                    "housing_stock": 5_000,
                }
            ],
            delay=0,
        )
        row = payload["locations"][0]

        self.assertEqual(payload["schema_version"], 2)
        self.assertEqual(row["sale_total"], 120)
        self.assertEqual(row["rent_total"], 30)
        self.assertEqual(row["total_supply"], 150)
        self.assertEqual(row["sale_per_1000_inhabitants"], 12.0)
        self.assertEqual(row["rent_per_1000_homes"], 6.0)
        self.assertEqual(row["total_per_1000_homes"], 30.0)

    def test_location_denominators_must_be_positive(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "locations.json"
            path.write_text(
                json.dumps(
                    [
                        {
                            "code": "28000",
                            "name": "Ejemplo",
                            "level": "municipality",
                            "location_id": "location-1",
                            "population": 0,
                        }
                    ]
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "invalid population"):
                load_locations(path)


if __name__ == "__main__":
    unittest.main()
