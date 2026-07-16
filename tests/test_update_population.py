"""Offline tests for scripts/update_population.py (no network)."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts import update_population as up


INE_CSV = """Municipios;Sexo;Periodo;Total
28001 Acebeda, La;Total;2025;70
28001 Acebeda, La;Total;2024;68
28001 Acebeda, La;Total;2023;67
28001 Acebeda, La;Total;2022;66
28001 Acebeda, La;Total;2021;69
28001 Acebeda, La;Total;2020;68
28001 Acebeda, La;Hombres;2025;40
28001 Acebeda, La;Mujeres;2025;30
28001 Acebeda, La;Total;2019;65
28079 Madrid;Total;2025;3.506.730
28079 Madrid;Total;2020;3.334.730
28 Madrid;Total;2025;7.000.000
"""

AYTO_CSV_COMBINED = """fecha;cod_distrito;desc_distrito;cod_barrio;desc_barrio;num_personas
2020-01-01;17;Villaverde;172;San Cristóbal;17000
2021-01-01;17;Villaverde;172;San Cristóbal;17300
2022-01-01;17;Villaverde;172;San Cristóbal;17500
2023-01-01;17;Villaverde;172;San Cristóbal;17800
2024-01-01;17;Villaverde;172;San Cristóbal;18100
2020-01-01;2;Arganzuela;24;Legazpi;5000
2024-01-01;2;Arganzuela;24;Legazpi;5500
2019-01-01;2;Arganzuela;24;Legazpi;4900
"""

AYTO_CSV_SPLIT_SEXO = """AÑO,COD_DIS,DESC_DISTRITO,COD_BAR,DESC_BARRIO,SEXO,POBLACION
2020,10,Latina,7,Águilas,Hombres,3000
2020,10,Latina,7,Águilas,Mujeres,3200
2024,10,Latina,7,Águilas,Hombres,3100
2024,10,Latina,7,Águilas,Mujeres,3300
"""


class ParseIneTests(unittest.TestCase):
    def test_filters_sex_codes_and_years(self) -> None:
        series = up.parse_ine_municipalities(INE_CSV)
        self.assertEqual(series["28001"], {2020: 68, 2021: 69, 2022: 66, 2023: 67, 2024: 68, 2025: 70})
        self.assertEqual(series["28079"][2025], 3506730)
        self.assertNotIn("28", series)  # fila provincial excluida
        self.assertNotIn(2019, series["28001"])  # anterior a MIN_YEAR


class ParseAytoTests(unittest.TestCase):
    def test_combined_codes_and_district_sum(self) -> None:
        districts, neighbourhoods = up.parse_ayto_population(AYTO_CSV_COMBINED)
        self.assertEqual(neighbourhoods["172"][2024], 18100)
        self.assertEqual(neighbourhoods["24"][2020], 5000)
        self.assertEqual(districts["17"][2024], 18100)
        self.assertNotIn(2019, neighbourhoods["24"])

    def test_split_codes_aggregate_rows(self) -> None:
        districts, neighbourhoods = up.parse_ayto_population(AYTO_CSV_SPLIT_SEXO)
        # barrio 7 del distrito 10 -> clave '107'; filas por sexo sumadas
        self.assertEqual(neighbourhoods["107"], {2020: 6200, 2024: 6400})
        self.assertEqual(districts["10"], {2020: 6200, 2024: 6400})


class SummaryTests(unittest.TestCase):
    def test_summary_from_py(self) -> None:
        summary = up._summary_from({2020: 100, 2023: 110, 2024: 121}, 2024)
        self.assertEqual(summary["p20"], 100)
        self.assertEqual(summary["p25"], 121)
        self.assertEqual(summary["a"], 21)
        self.assertEqual(summary["p"], 21.0)
        self.assertEqual(summary["la"], 11)
        self.assertEqual(summary["lp"], 10.0)


class ApplyTests(unittest.TestCase):
    def _with_data_dir(self, files: dict[str, dict]) -> Path:
        directory = Path(tempfile.mkdtemp()) / "data"
        directory.mkdir()
        for name, payload in files.items():
            (directory / name).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        return directory

    def test_apply_municipalities_requires_coverage(self) -> None:
        data = self._with_data_dir({"municipalities.json": {"28001": {"n": "Acebeda, La", "z": "Norte", "p25": 70}}})
        original = up.DATA
        up.DATA = data
        try:
            with self.assertRaises(ValueError):
                up.apply_municipalities({"28001": {2020: 68, 2025: 70}}, dry_run=True)
        finally:
            up.DATA = original

    def test_apply_level_writes_py_and_caps_summary(self) -> None:
        records = {str(code): {"n": f"B{code}", "d": 17} for code in range(171, 176)}
        records.update({str(code): {"n": f"B{code}", "d": 1} for code in range(11, 17)})
        records.update({str(1000 + index): {"n": f"X{index}", "d": 1} for index in range(120)})
        data = self._with_data_dir({"neighborhoods.json": records})
        series = {code: {2020: 100, 2023: 110, 2024: 120, 2025: 130} for code in records}
        original = up.DATA
        up.DATA = data
        try:
            up.apply_level("neighborhoods.json", series, is_barrio=True, dry_run=False)
        finally:
            up.DATA = original
        written = json.loads((data / "neighborhoods.json").read_text(encoding="utf-8"))
        record = written["172"]
        self.assertEqual(record["py"]["2025"], 130)  # la serie conserva todos los años
        self.assertEqual(record["p25"], 120)  # el resumen queda anclado a 2024
        self.assertEqual(record["cp"], 20.0)


if __name__ == "__main__":
    unittest.main()
