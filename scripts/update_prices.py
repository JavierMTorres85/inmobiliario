"""Refresh sale/rent prices from idealista's public price report.

Updates ``v``/``va`` (sale price and annual variation) and ``alq``/``aa``
(rent) for municipalities, districts and neighbourhoods, then recomputes the
derived ``rb`` (gross yield) and ``esf`` (affordability). The five-year series
(``s``) and the demand-price quadrants are historical anchors and are never
touched here.

Sources are the public report pages (no API, no credentials):
  https://www.idealista.com/sala-de-prensa/informes-precio-vivienda/...

Neighbourhood rows are matched through the ``zi`` (idealista zone) stored in
``data/neighborhoods.json``; municipalities by normalised name against
``data/municipalities.json``. Unknown zones are reported, never guessed.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import unicodedata
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
BASE = "https://www.idealista.com/sala-de-prensa/informes-precio-vivienda"
PROVINCE = "madrid-comunidad/madrid-provincia"
DISTRICT_SLUGS = {
    "centro": 1, "arganzuela": 2, "retiro": 3, "salamanca": 4, "chamartin": 5,
    "tetuan": 6, "chamberi": 7, "fuencarral": 8, "moncloa": 9, "latina": 10,
    "carabanchel": 11, "usera": 12, "puente-de-vallecas": 13, "moratalaz": 14,
    "ciudad-lineal": 15, "hortaleza": 16, "villaverde": 17, "villa-de-vallecas": 18,
    "vicalvaro": 19, "san-blas": 20, "barajas": 21,
}
DISTRICT_NAMES = {
    "centro": 1, "arganzuela": 2, "retiro": 3, "salamanca": 4, "chamartin": 5,
    "tetuan": 6, "chamberi": 7, "fuencarral": 8, "moncloa": 9, "latina": 10,
    "carabanchel": 11, "usera": 12, "puente de vallecas": 13, "moratalaz": 14,
    "ciudad lineal": 15, "hortaleza": 16, "villaverde": 17, "villa de vallecas": 18,
    "vicalvaro": 19, "san blas": 20, "barajas": 21,
}
MUNI_ALIASES = {"arganda": "arganda del rey", "san agustin de guadalix": "san agustin del guadalix"}
# Zonas del informe que no son municipios (urbanizaciones/entidades): se ignoran sin avisar.
KNOWN_NON_MUNICIPALITIES = {
    "madrid provincia", "la moraleja", "eurovillas", "ciudalcampo", "club de campo",
    "fuente del fresno", "santo domingo", "los hueros", "cotos de monterrey", "mataelpino",
    "cerceda", "serracines", "valdelagua", "espacial (villafranca castillo), estacion",
}
MONTHS = "enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre"
USER_AGENT = "Mozilla/5.0 (compatible; inmobiliario-dashboard/1.0; datos públicos; github.com/JavierMTorres85/inmobiliario)"


def fetch(url: str, timeout: int = 45) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept-Language": "es-ES,es"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFD", text.casefold())
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9() ,]", " ", text)).strip()


class _TableParser(HTMLParser):
    """Collects the rows of the first <table> in the page as lists of cell texts."""

    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._in_table = False
        self._done = False
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs) -> None:
        if self._done:
            return
        if tag == "table" and not self._in_table:
            self._in_table = True
        elif self._in_table and tag == "tr":
            self._row = []
        elif self._in_table and tag in ("td", "th"):
            self._cell = []

    def handle_endtag(self, tag: str) -> None:
        if self._done or not self._in_table:
            return
        if tag == "table":
            self._in_table = False
            self._done = True
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None
        elif tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append(" ".join(" ".join(self._cell).split()))
            self._cell = None

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)


def parse_price(text: str) -> float | None:
    match = re.search(r"([\d.]+(?:,\d+)?)\s*€/m2", text)
    if not match:
        return None
    value = float(match.group(1).replace(".", "").replace(",", "."))
    return value


def parse_percent(text: str) -> float | None:
    match = re.search(r"([+-]?)\s*([\d.]+(?:,\d+)?)\s*%", text)
    if not match:
        return None
    sign = -1.0 if match.group(1) == "-" else 1.0
    return sign * float(match.group(2).replace(".", "").replace(",", "."))


def parse_report(html: str) -> tuple[str | None, list[tuple[str, float, float | None]]]:
    """Returns (report_month, [(location, price, annual_variation), ...])."""
    month = None
    match = re.search(rf"({MONTHS})\s+(20\d\d)", html, re.IGNORECASE)
    if match:
        month = f"{match.group(1).lower()} de {match.group(2)}"
    parser = _TableParser()
    parser.feed(html)
    rows = []
    for cells in parser.rows:
        if len(cells) < 5:
            continue
        price = parse_price(cells[1])
        if price is None:
            continue
        rows.append((cells[0].strip(), price, parse_percent(cells[4])))
    return month, rows


# ---------------------------------------------------------------- mapping helpers

def canon_muni(name: str) -> str:
    match = re.match(r"^(.*), (El|La|Los|Las)$", name)
    if match:
        name = f"{match.group(2)} {match.group(1)}"
    return normalise(name)


def build_muni_index(records: dict) -> dict[str, str]:
    return {canon_muni(record["n"]): code for code, record in records.items()}


def muni_code(index: dict[str, str], name: str) -> str | None:
    normal = normalise(name)
    normal = MUNI_ALIASES.get(normal, normal)
    return index.get(normal) or index.get(normal.replace(" de ", " del "))


def build_zone_index(neighbourhoods: dict) -> dict[str, list[str]]:
    zones: dict[str, list[str]] = {}
    for code, record in neighbourhoods.items():
        zone = record.get("zi")
        if zone:
            zones.setdefault(normalise(zone), []).append(code)
    return zones


# ---------------------------------------------------------------- application

def apply_prices(kind: str, *, from_dir: Path | None, delay: float, dry_run: bool) -> dict:
    """kind: 'venta' (v/va) o 'alquiler' (alq/aa)."""
    value_key, variation_key = ("v", "va") if kind == "venta" else ("alq", "aa")
    municipalities = json.loads((DATA / "municipalities.json").read_text(encoding="utf-8"))
    districts = json.loads((DATA / "districts.json").read_text(encoding="utf-8"))
    neighbourhoods = json.loads((DATA / "neighborhoods.json").read_text(encoding="utf-8"))
    muni_index = build_muni_index(municipalities)
    zone_index = build_zone_index(neighbourhoods)

    def read(path_key: str, url: str) -> str:
        if from_dir:
            return (from_dir / f"{path_key}.html").read_text(encoding="utf-8")
        html = fetch(url)
        time.sleep(delay)
        return html

    report = {"kind": kind, "month": None, "munis": 0, "districts": 0, "zones": 0,
              "unmatched": [], "drift": [], "stale": 0}

    # 1) Municipios
    month, rows = parse_report(read(f"{kind}-municipios", f"{BASE}/{kind}/{PROVINCE}/"))
    report["month"] = month
    seen_munis = set()
    for name, price, variation in rows:
        if normalise(name) in KNOWN_NON_MUNICIPALITIES:
            continue
        code = muni_code(muni_index, name)
        if not code:
            report["unmatched"].append(f"muni? {name}")
            continue
        record = municipalities[code]
        old = record.get(value_key)
        if old and abs(price - old) / old > 0.30:
            report["drift"].append(f"{record['n']}: {value_key} {old} -> {price}")
        record[value_key] = round(price) if kind == "venta" else price
        if variation is not None:
            record[variation_key] = variation
        seen_munis.add(code)
    report["stale"] += sum(1 for code, r in municipalities.items() if r.get(value_key) and code not in seen_munis)
    report["munis"] = len(seen_munis)

    # 2) Distritos (página de la capital)
    _, rows = parse_report(read(f"{kind}-distritos", f"{BASE}/{kind}/{PROVINCE}/madrid/"))
    for name, price, variation in rows:
        code = DISTRICT_NAMES.get(normalise(name))
        if not code:
            continue  # fila "Madrid" (capital) u otros agregados
        record = districts[str(code)]
        record[value_key] = round(price) if kind == "venta" else price
        if variation is not None:
            record[variation_key] = variation
        report["districts"] += 1

    # 3) Barrios (una página por distrito)
    for slug in DISTRICT_SLUGS:
        _, rows = parse_report(read(f"{kind}-{slug}", f"{BASE}/{kind}/{PROVINCE}/madrid/{slug}/"))
        district_rows = rows[1:] if rows and normalise(rows[0][0]) in DISTRICT_NAMES else rows
        for name, price, variation in district_rows:
            codes = zone_index.get(normalise(name))
            if not codes:
                if normalise(name) not in DISTRICT_NAMES:
                    report["unmatched"].append(f"zona? {slug}/{name}")
                continue
            for code in codes:
                record = neighbourhoods[code]
                record[value_key] = round(price) if kind == "venta" else price
                if variation is not None:
                    record[variation_key] = variation
                report["zones"] += 1

    # 4) Derivados
    for collection in (municipalities, districts, neighbourhoods):
        for record in collection.values():
            if record.get("v") and record.get("alq"):
                record["rb"] = round(record["alq"] * 12 / record["v"] * 100, 2)
            if record.get("v") and record.get("r"):
                record["esf"] = round(record["v"] * 80 / record["r"], 1)

    # 5) Cobertura mínima antes de escribir
    minimums = {"venta": (60, 21, 90), "alquiler": (25, 21, 70)}[kind]
    observed = (report["munis"], report["districts"], report["zones"])
    if any(value < minimum for value, minimum in zip(observed, minimums)):
        raise ValueError(f"Cobertura insuficiente en {kind}: munis/distritos/zonas={observed}, mínimo={minimums}. No se escribe nada.")

    if not dry_run:
        (DATA / "municipalities.json").write_text(json.dumps(municipalities, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        (DATA / "districts.json").write_text(json.dumps(districts, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        (DATA / "neighborhoods.json").write_text(json.dumps(neighbourhoods, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return report


def update_manifest(venta_month: str | None, alquiler_month: str | None, *, dry_run: bool) -> None:
    path = DATA / "manifest.json"
    manifest = json.loads(path.read_text(encoding="utf-8"))
    metrics = manifest.get("metrics", {})
    if venta_month:
        for level in metrics.get("pre", {}).get("periods", {}):
            metrics["pre"]["periods"][level] = venta_month
        year = venta_month.split()[-1]
        for level, value in metrics.get("esf", {}).get("periods", {}).items():
            if "sin dato" not in value:
                metrics["esf"]["periods"][level] = f"precio {year} / renta 2023"
    if venta_month and alquiler_month:
        combined = alquiler_month if alquiler_month == venta_month else f"venta {venta_month} · alquiler {alquiler_month}"
        for level in metrics.get("ren", {}).get("periods", {}):
            metrics["ren"]["periods"][level] = combined
    manifest["updated"] = time.strftime("%Y-%m-%d")
    if not dry_run:
        path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-dir", type=Path, help="directorio con HTML descargado (tests / uso sin red)")
    parser.add_argument("--delay", type=float, default=1.5, help="pausa entre peticiones (s)")
    parser.add_argument("--dry-run", action="store_true", help="valida y resume sin escribir")
    args = parser.parse_args()

    reports = []
    for kind in ("venta", "alquiler"):
        report = apply_prices(kind, from_dir=args.from_dir, delay=args.delay, dry_run=args.dry_run)
        reports.append(report)
        print(f"{kind}: mes={report['month']} munis={report['munis']} distritos={report['districts']} zonas-barrio={report['zones']} sin_actualizar={report['stale']}")
        for line in report["unmatched"][:8]:
            print("  sin cruce:", line)
        for line in report["drift"][:8]:
            print("  AVISO variación >30%:", line)
    update_manifest(reports[0]["month"], reports[1]["month"], dry_run=args.dry_run)
    if args.dry_run:
        print("dry-run: no se ha escrito nada")
    return 0


if __name__ == "__main__":
    sys.exit(main())
