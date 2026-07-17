"""Offline tests for scripts/update_prices.py (no network)."""

from __future__ import annotations

import unittest

from scripts import update_prices as up


REPORT_HTML = """<html><body>
<h1>Evolución del precio de la vivienda en venta en Madrid provincia</h1>
<p>Junio 2026</p>
<table><tbody>
<tr><th>Localización</th><th>Precio m2</th><th>Mensual</th><th>Trimestral</th><th>Anual</th><th>Máximo</th><th>Var</th></tr>
<tr><td>Madrid provincia</td><td>4.786 €/m2</td><td>+ 0,4 %</td><td>+ 1,2 %</td><td>+ 11,6 %</td><td>4.786 €/m2</td><td>0,0 %</td></tr>
<tr><td><a href="/x/">Alcalá de Henares</a></td><td>2.903 €/m2</td><td>- 0,3 %</td><td>+ 2,1 %</td><td>+ 15,8 %</td><td>2.910 €/m2</td><td>- 0,2 %</td></tr>
<tr><td>La Moraleja</td><td>6.953 €/m2</td><td>n.d.</td><td>n.d.</td><td>+ 7,5 %</td><td>6.953 €/m2</td><td>0,0 %</td></tr>
<tr><td>El Álamo</td><td>2.070 €/m2</td><td>n.d.</td><td>n.d.</td><td>n.d.</td><td>2.070 €/m2</td><td>0,0 %</td></tr>
</tbody></table>
<table><tr><td>Otra tabla</td><td>que no debe leerse</td></tr></table>
</body></html>"""

RENT_HTML = """<html><body><p>Abril 2026</p><table>
<tr><th>Localización</th><th>Precio</th><th>M</th><th>T</th><th>A</th><th>Max</th><th>V</th></tr>
<tr><td>Villaverde</td><td>17,6 €/m2</td><td>+ 1,0 %</td><td>+ 2,0 %</td><td>+ 12,6 %</td><td>17,6 €/m2</td><td>0,0 %</td></tr>
<tr><td>Los Rosales</td><td>17,9 €/m2</td><td>n.d.</td><td>n.d.</td><td>- 1,2 %</td><td>18,1 €/m2</td><td>- 1,1 %</td></tr>
</table></body></html>"""


class ParseTests(unittest.TestCase):
    def test_parse_report_month_rows_and_first_table_only(self) -> None:
        month, rows = up.parse_report(REPORT_HTML)
        self.assertEqual(month, "junio de 2026")
        self.assertEqual(len(rows), 4)  # cabecera fuera; segunda tabla ignorada
        self.assertEqual(rows[1], ("Alcalá de Henares", 2903.0, 15.8))
        self.assertEqual(rows[3], ("El Álamo", 2070.0, None))  # anual n.d.

    def test_parse_rent_decimal_prices_and_negative_variation(self) -> None:
        month, rows = up.parse_report(RENT_HTML)
        self.assertEqual(month, "abril de 2026")
        self.assertEqual(rows[0], ("Villaverde", 17.6, 12.6))
        self.assertEqual(rows[1], ("Los Rosales", 17.9, -1.2))

    def test_percent_signs(self) -> None:
        self.assertEqual(up.parse_percent("+ 9,0 %"), 9.0)
        self.assertEqual(up.parse_percent("- 2,6 %"), -2.6)
        self.assertEqual(up.parse_percent("0,0 %"), 0.0)
        self.assertIsNone(up.parse_percent("n.d."))


class MappingTests(unittest.TestCase):
    RECORDS = {"28005": {"n": "Alcalá de Henares"}, "28004": {"n": "Álamo, El"}, "28014": {"n": "Arganda del Rey"}}

    def test_muni_matching_with_articles_and_aliases(self) -> None:
        index = up.build_muni_index(self.RECORDS)
        self.assertEqual(up.muni_code(index, "Alcalá de Henares"), "28005")
        self.assertEqual(up.muni_code(index, "El Álamo"), "28004")
        self.assertEqual(up.muni_code(index, "Arganda"), "28014")
        self.assertIsNone(up.muni_code(index, "Ciudalcampo"))

    def test_zone_index_groups_shared_zones(self) -> None:
        neighbourhoods = {
            "192": {"n": "Valdebernardo", "zi": "Valdebernardo - Valderribas"},
            "193": {"n": "Valderrivas", "zi": "Valdebernardo - Valderribas"},
            "172": {"n": "San Cristóbal", "zi": "San Cristóbal"},
        }
        zones = up.build_zone_index(neighbourhoods)
        self.assertEqual(sorted(zones[up.normalise("Valdebernardo - Valderribas")]), ["192", "193"])
        self.assertEqual(zones[up.normalise("San Cristóbal")], ["172"])


if __name__ == "__main__":
    unittest.main()
