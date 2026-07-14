"""Collect aggregate sale/rent listing counts from the Idealista Search API."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import time
from typing import Any

try:
    from .idealista_client import IdealistaAPIError, IdealistaClient, SearchRequest
except ImportError:  # Direct execution: python scripts/update_supply.py
    from idealista_client import IdealistaAPIError, IdealistaClient, SearchRequest


def load_locations(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list) or not payload:
        raise ValueError("locations file must contain a non-empty JSON list")
    required = {"code", "name", "level", "location_id"}
    for index, location in enumerate(payload):
        if not isinstance(location, dict) or not required.issubset(location):
            raise ValueError(f"location {index} must contain {sorted(required)}")
        if str(location["location_id"]).startswith("REPLACE_"):
            raise ValueError(f"location {location['name']} still has a placeholder location_id")
        for denominator in ("population", "housing_stock"):
            value = location.get(denominator)
            if value is not None and (
                isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0
            ):
                raise ValueError(f"location {location['name']} has an invalid {denominator}")
    return payload


def per_thousand(total: int, denominator: int | float | None) -> float | None:
    """Return a comparable supply rate without inventing missing denominators."""
    if denominator is None:
        return None
    return round(total * 1000 / denominator, 2)


def write_json_atomic(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def collect(
    client: IdealistaClient,
    locations: list[dict[str, Any]],
    *,
    delay: float,
) -> dict[str, Any]:
    collected_at = datetime.now(timezone.utc).replace(microsecond=0)
    results: list[dict[str, Any]] = []

    for location in locations:
        row: dict[str, Any] = {
            "code": location["code"],
            "name": location["name"],
            "level": location["level"],
            "idealista_location_id": location["location_id"],
        }
        if location.get("population") is not None:
            row["population"] = location["population"]
        if location.get("housing_stock") is not None:
            row["housing_stock"] = location["housing_stock"]
        for operation in ("sale", "rent"):
            response = client.search(
                SearchRequest(
                    country="es",
                    operation=operation,
                    property_type="homes",
                    location_id=location["location_id"],
                    max_items=1,
                    num_page=1,
                )
            )
            row[f"{operation}_total"] = response.total
            if delay:
                time.sleep(delay)
        row["total_supply"] = row["sale_total"] + row["rent_total"]
        for operation in ("sale", "rent", "total_supply"):
            total_key = operation if operation == "total_supply" else f"{operation}_total"
            prefix = "total" if operation == "total_supply" else operation
            inhabitants = per_thousand(row[total_key], location.get("population"))
            homes = per_thousand(row[total_key], location.get("housing_stock"))
            if inhabitants is not None:
                row[f"{prefix}_per_1000_inhabitants"] = inhabitants
            if homes is not None:
                row[f"{prefix}_per_1000_homes"] = homes
        results.append(row)

    return {
        "schema_version": 2,
        "generated_at": collected_at.isoformat().replace("+00:00", "Z"),
        "source": "Idealista Search API",
        "property_type": "homes",
        "normalization": {
            "unit": "active listings per 1,000",
            "denominators": ["population", "housing_stock"],
            "note": "Rates are only emitted when the corresponding denominator is supplied.",
        },
        "locations": results,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--locations", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=Path("data/idealista_supply.json"))
    parser.add_argument("--snapshot-dir", type=Path)
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--timeout", type=float, default=20.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    api_key = os.environ.get("IDEALISTA_API_KEY")
    api_secret = os.environ.get("IDEALISTA_API_SECRET")
    if not api_key or not api_secret:
        raise SystemExit("IDEALISTA_API_KEY and IDEALISTA_API_SECRET are required")

    locations = load_locations(args.locations)
    client = IdealistaClient(api_key, api_secret, timeout=args.timeout)
    try:
        payload = collect(client, locations, delay=max(args.delay, 0.0))
    except IdealistaAPIError as exc:
        raise SystemExit(f"Idealista API error: {exc}") from exc

    write_json_atomic(args.output, payload)
    if args.snapshot_dir:
        stamp = payload["generated_at"].replace(":", "").replace("-", "")
        write_json_atomic(args.snapshot_dir / f"idealista_supply_{stamp}.json", payload)
    print(f"Wrote {len(payload['locations'])} aggregate location records to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
