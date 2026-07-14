"""Cache the three public boundary datasets used by the static dashboard."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import requests


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "geo"
MUNICIPAL_API = (
    "https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/"
    "georef-spain-municipio/records"
)
DISTRICTS_URL = (
    "https://raw.githubusercontent.com/codeforgermany/click_that_hood/"
    "main/public/data/madrid-districts.geojson"
)
NEIGHBORHOODS_URL = (
    "https://services.arcgis.com/oSryZQrvtpGJ3f3s/arcgis/rest/services/"
    "L%C3%ADmites_administrativos_oficiales_del_Ayuntamiento_de_Madrid/"
    "FeatureServer/0/query"
)


def fetch_json(url: str, *, params: dict[str, Any] | None = None) -> Any:
    response = requests.get(url, params=params, timeout=60)
    response.raise_for_status()
    return response.json()


def rounded(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, 5)
    if isinstance(value, list):
        return [rounded(item) for item in value]
    return value


def feature(properties: dict[str, Any], geometry: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "Feature",
        "properties": properties,
        "geometry": {**geometry, "coordinates": rounded(geometry["coordinates"])},
    }


def write_collection(name: str, features: list[dict[str, Any]], expected: int) -> None:
    if len(features) != expected:
        raise RuntimeError(f"{name}: expected {expected} features, received {len(features)}")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    payload = {"type": "FeatureCollection", "features": features}
    (OUTPUT / name).write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def municipalities() -> list[dict[str, Any]]:
    allowed = set(json.loads((ROOT / "data" / "municipalities.json").read_text()))
    results: list[dict[str, Any]] = []
    for offset in (0, 100):
        payload = fetch_json(
            MUNICIPAL_API,
            params={
                "select": "mun_code,geo_shape",
                "where": 'prov_name="Madrid"',
                "limit": 100,
                "offset": offset,
            },
        )
        for record in payload.get("results", []):
            code = record.get("mun_code")
            shape = record.get("geo_shape")
            if code in allowed and shape:
                geometry = shape.get("geometry", shape)
                results.append(feature({"mun_code": code}, geometry))
    return results


def districts() -> list[dict[str, Any]]:
    allowed = set(json.loads((ROOT / "data" / "districts.json").read_text()))
    payload = fetch_json(DISTRICTS_URL)
    results = []
    for source in payload.get("features", []):
        code = str(source.get("properties", {}).get("cartodb_id"))
        if code in allowed:
            results.append(feature({"cartodb_id": int(code)}, source["geometry"]))
    return results


def neighborhoods() -> list[dict[str, Any]]:
    allowed = set(json.loads((ROOT / "data" / "neighborhoods.json").read_text()))
    payload = fetch_json(
        NEIGHBORHOODS_URL,
        params={
            "where": "1=1",
            "outFields": "COD_DISBAR,NOMBRE",
            "f": "geojson",
            "outSR": 4326,
            "geometryPrecision": 5,
        },
    )
    results = []
    for source in payload.get("features", []):
        props = source.get("properties", {})
        code = str(props.get("COD_DISBAR"))
        if code in allowed:
            results.append(
                feature(
                    {"COD_DISBAR": int(code), "NOMBRE": props.get("NOMBRE")},
                    source["geometry"],
                )
            )
    return results


def main() -> int:
    write_collection("municipalities.geojson", municipalities(), 179)
    write_collection("districts.geojson", districts(), 21)
    write_collection("neighborhoods.geojson", neighborhoods(), 131)
    print("Cached 179 municipalities, 21 districts and 131 neighborhoods")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
