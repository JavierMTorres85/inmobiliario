"""Download official yearly population series into the dashboard JSON.

Sources:
- INE table 2881 (padron): yearly population per municipality of Madrid.
- Ayuntamiento de Madrid open data 300557: yearly population per district and
  neighbourhood at 1 January.

The script adds a ``py`` mapping (year -> population) to each record and
recomputes the derived summary fields (p20, p25, a, p, la, lp, cp) from the
observed years, so the dashboard timeline animates real data instead of
interpolating between anchors. Neighbourhood/district summaries are pinned to
the 2020-2024 window to keep the published labels truthful; ``py`` keeps every
downloaded year for the timeline.

No credentials are involved; both sources are public files.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
INE_URL = "https://www.ine.es/jaxiT3/files/t/es/csv_bdsc/2881.csv?nocab=1"
AYTO_URLS = (
    "https://datos.madrid.es/egob/catalogo/300557-0-poblacion-distrito-barrio.csv",
    "https://datos.madrid.es/dataset/300557-0-poblacion-distrito-barrio/resource/"
    "300557-0-poblacion-distrito-barrio-csv/download/300557-0-poblacion-distrito-barrio-csv.csv",
)
MIN_YEAR = 2020
SUMMARY_CAP_DB = 2024  # districts/neighbourhoods summaries pinned to 2020-2024
USER_AGENT = "inmobiliario-dashboard/1.0 (open data ingest; github.com/JavierMTorres85/inmobiliario)"


def fetch(url: str, timeout: int = 60) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError(f"Cannot decode response from {url}")


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFD", text.casefold())
    return "".join(char for char in text if not unicodedata.combining(char)).strip()


def parse_int(text: str | None) -> int | None:
    if text is None:
        return None
    cleaned = text.replace(".", "").replace("\xa0", "").replace(" ", "").replace(",", "").strip()
    if not cleaned or not cleaned.lstrip("-").isdigit():
        return None
    return int(cleaned)


def parse_year(text: str | None) -> int | None:
    if not text:
        return None
    digits = [chunk for chunk in "".join(c if c.isdigit() else " " for c in text).split() if len(chunk) == 4]
    for chunk in digits:
        year = int(chunk)
        if 1990 <= year <= 2100:
            return year
    return None


# ---------------------------------------------------------------- INE (municipalities)

def parse_ine_municipalities(text: str) -> dict[str, dict[int, int]]:
    """Parse the INE bdsc CSV (semicolon separated) into code -> {year: population}."""
    reader = csv.reader(io.StringIO(text), delimiter=";")
    header = next(reader)
    columns = {normalise(name): index for index, name in enumerate(header)}
    sexo_index = next((index for name, index in columns.items() if "sexo" in name), None)
    periodo_index = next((index for name, index in columns.items() if "periodo" in name), None)
    total_index = next((index for name, index in columns.items() if name == "total"), len(header) - 1)
    if periodo_index is None:
        raise ValueError(f"INE CSV without 'Periodo' column; header was {header}")

    series: dict[str, dict[int, int]] = {}
    for row in reader:
        if len(row) <= total_index:
            continue
        territory = row[0].strip()
        code = territory.split(" ", 1)[0]
        if len(code) != 5 or not code.isdigit() or not code.startswith("28"):
            continue
        if sexo_index is not None and normalise(row[sexo_index]) not in ("total", "ambos sexos"):
            continue
        year = parse_year(row[periodo_index])
        value = parse_int(row[total_index])
        if year is None or value is None or year < MIN_YEAR:
            continue
        series.setdefault(code, {})[year] = value
    return series


# ------------------------------------------------- Ayuntamiento (districts + neighbourhoods)

def _pick_column(fieldnames: list[str], *must_contain: str, reject: tuple[str, ...] = ()) -> str | None:
    for name in fieldnames:
        normal = normalise(name)
        if all(token in normal for token in must_contain) and not any(token in normal for token in reject):
            return name
    return None


def parse_ayto_population(text: str) -> tuple[dict[str, dict[int, int]], dict[str, dict[int, int]]]:
    """Parse the Ayto CSV into (district_series, neighbourhood_series).

    Neighbourhood keys follow the dashboard convention: ``district*10 + number``
    rendered without padding ('172' = district 17, barrio 2; '24' = district 2,
    barrio 4). Rows are summed, so files broken down by sex or age aggregate
    cleanly. Districts are the sum of their neighbourhoods.
    """
    sample = text[:4096]
    delimiter = ";" if sample.count(";") >= sample.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    fields = reader.fieldnames or []
    year_column = _pick_column(fields, "ano") or _pick_column(fields, "fecha")
    district_column = _pick_column(fields, "cod", "dis") or _pick_column(fields, "distrito", reject=("desc", "nombre", "literal"))
    barrio_column = _pick_column(fields, "cod", "bar") or _pick_column(fields, "barrio", reject=("desc", "nombre", "literal"))
    value_column = (
        _pick_column(fields, "poblacion")
        or _pick_column(fields, "personas")
        or _pick_column(fields, "habitantes")
        or _pick_column(fields, "total")
        or _pick_column(fields, "num")
    )
    missing = [label for label, column in (("año/fecha", year_column), ("distrito", district_column), ("barrio", barrio_column), ("valor", value_column)) if column is None]
    if missing:
        raise ValueError(f"Ayto CSV: no puedo identificar columnas {missing}; cabecera: {fields}")

    districts: dict[str, dict[int, int]] = {}
    neighbourhoods: dict[str, dict[int, int]] = {}
    for row in reader:
        year = parse_year(row.get(year_column))
        district = parse_int(row.get(district_column))
        barrio = parse_int(row.get(barrio_column))
        value = parse_int(row.get(value_column))
        if None in (year, district, barrio, value) or year < MIN_YEAR:
            continue
        if not 1 <= district <= 21:
            continue
        combined = barrio if barrio > 9 else district * 10 + barrio
        if combined // 10 != district:
            # combined code inconsistent with its district: trust the district column
            combined = district * 10 + (barrio % 10)
        neighbourhood_key = str(combined)
        district_key = str(district)
        neighbourhoods.setdefault(neighbourhood_key, {})
        neighbourhoods[neighbourhood_key][year] = neighbourhoods[neighbourhood_key].get(year, 0) + value
        districts.setdefault(district_key, {})
        districts[district_key][year] = districts[district_key].get(year, 0) + value
    return districts, neighbourhoods


# ---------------------------------------------------------------- merge into dashboard JSON

def _summary_from(py: dict[int, int], last: int) -> dict[str, float] | None:
    first = MIN_YEAR
    if first not in py or last not in py:
        return None
    p20, plast = py[first], py[last]
    previous = py.get(last - 1)
    summary: dict[str, float] = {
        "p20": p20,
        "p25": plast,
        "a": plast - p20,
        "p": round((plast / p20 - 1) * 100, 1) if p20 else None,
    }
    if previous:
        summary["la"] = plast - previous
        summary["lp"] = round((plast - previous) / previous * 100, 1)
    return summary


def apply_municipalities(series: dict[str, dict[int, int]], *, dry_run: bool) -> str:
    path = DATA / "municipalities.json"
    records = json.loads(path.read_text(encoding="utf-8"))
    matched = [code for code in records if code in series]
    if len(matched) < 170:
        raise ValueError(f"Solo {len(matched)} municipios casan con el INE; esperaba >=170. Abortando.")
    drift = []
    for code in matched:
        py = dict(sorted(series[code].items()))
        record = records[code]
        last = max(py)
        summary = _summary_from(py, last)
        old_p25 = record.get("p25")
        if summary and old_p25 and abs(summary["p25"] - old_p25) / old_p25 > 0.05:
            drift.append(f"{record.get('n', code)}: {old_p25} -> {summary['p25']}")
        record["py"] = {str(year): value for year, value in py.items()}
        if summary:
            record.update(summary)
    if drift:
        print(f"AVISO: {len(drift)} municipios cambian >5% frente al corte anterior:")
        for line in drift[:10]:
            print("  ", line)
    if not dry_run:
        path.write_text(json.dumps(records, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return f"municipios: {len(matched)}/179 con serie {min(min(py) for py in series.values())}-{max(max(py) for py in series.values())}"


def apply_level(filename: str, series: dict[str, dict[int, int]], *, is_barrio: bool, dry_run: bool) -> str:
    path = DATA / filename
    records = json.loads(path.read_text(encoding="utf-8"))
    matched = [code for code in records if code in series]
    minimum = 120 if is_barrio else 21
    if len(matched) < minimum:
        raise ValueError(
            f"Solo {len(matched)} códigos de {filename} casan con el Ayto (esperaba >={minimum}). "
            "Revisa la derivación de códigos antes de escribir nada."
        )
    summarised = 0
    for code in matched:
        py = dict(sorted(series[code].items()))
        record = records[code]
        record["py"] = {str(year): value for year, value in py.items()}
        if SUMMARY_CAP_DB in py:
            summary = _summary_from(py, SUMMARY_CAP_DB)
            if summary:
                record.update(summary)
                if is_barrio:
                    record["cp"] = summary["p"]
                summarised += 1
    if not dry_run:
        path.write_text(json.dumps(records, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    years = sorted({year for values in series.values() for year in values})
    return f"{filename}: {len(matched)} con py {years[0]}-{years[-1]}; resúmenes 2020-{SUMMARY_CAP_DB}: {summarised}"


def recompute_zones(*, dry_run: bool) -> str:
    municipalities = json.loads((DATA / "municipalities.json").read_text(encoding="utf-8"))
    path = DATA / "zones.json"
    zones = json.loads(path.read_text(encoding="utf-8"))
    for name, zone in zones.items():
        members = [record for record in municipalities.values() if record.get("z") == name]
        p20 = sum(record.get("p20") or 0 for record in members)
        p25 = sum(record.get("p25") or 0 for record in members)
        if p20 and p25:
            zone.update({"p20": p20, "p25": p25, "a": p25 - p20, "p": round((p25 / p20 - 1) * 100, 1)})
    if not dry_run:
        path.write_text(json.dumps(zones, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return f"zones.json: {len(zones)} zonas recalculadas desde municipios"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-ine", action="store_true", help="no tocar municipios")
    parser.add_argument("--skip-ayto", action="store_true", help="no tocar distritos/barrios")
    parser.add_argument("--ine-file", type=Path, help="CSV local del INE (tests / uso sin red)")
    parser.add_argument("--ayto-file", type=Path, help="CSV local del Ayto (tests / uso sin red)")
    parser.add_argument("--dry-run", action="store_true", help="valida y resume sin escribir")
    args = parser.parse_args()

    results: list[str] = []
    if not args.skip_ine:
        text = args.ine_file.read_text(encoding="utf-8") if args.ine_file else fetch(INE_URL)
        series = parse_ine_municipalities(text)
        results.append(apply_municipalities(series, dry_run=args.dry_run))
        results.append(recompute_zones(dry_run=args.dry_run))
    if not args.skip_ayto:
        if args.ayto_file:
            text = args.ayto_file.read_text(encoding="utf-8")
        else:
            text, errors = None, []
            for url in AYTO_URLS:
                try:
                    text = fetch(url)
                    break
                except Exception as error:  # noqa: BLE001 - informar y probar la siguiente URL
                    errors.append(f"{url}: {error}")
            if text is None:
                raise SystemExit("No se pudo descargar el CSV del Ayto:\n" + "\n".join(errors))
        districts, neighbourhoods = parse_ayto_population(text)
        results.append(apply_level("districts.json", districts, is_barrio=False, dry_run=args.dry_run))
        results.append(apply_level("neighborhoods.json", neighbourhoods, is_barrio=True, dry_run=args.dry_run))

    for line in results:
        print(line)
    if args.dry_run:
        print("dry-run: no se ha escrito nada")
    return 0


if __name__ == "__main__":
    sys.exit(main())
