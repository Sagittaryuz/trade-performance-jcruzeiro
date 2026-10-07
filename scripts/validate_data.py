#!/usr/bin/env python3
"""Valida fechamentos matemáticos dos JSONs entregues ao front-end."""

from __future__ import annotations

import json
import gzip
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"


def close(label: str, actual: float, expected: float, tolerance: float = 1.0) -> dict:
    difference = round(actual - expected, 4)
    ok = abs(difference) <= tolerance
    if not ok:
        raise AssertionError(f"{label}: diferença {difference:.4f} excede {tolerance}")
    return {"check": label, "actual": round(actual, 2), "expected": round(expected, 2), "difference": difference, "ok": ok}


def sum_period(facts: list[dict], start: str, end: str, field: str) -> float:
    return sum(float(row.get(field) or 0) for row in facts if start <= row["date"] <= end)


def main() -> None:
    with gzip.open(DATA / "dashboard.json.gz", "rt", encoding="utf-8") as handle:
        dashboard = json.load(handle)
    with gzip.open(DATA / "products.json.gz", "rt", encoding="utf-8") as handle:
        products = json.load(handle)["products"]
    with gzip.open(DATA / "brands.json.gz", "rt", encoding="utf-8") as handle:
        brands = json.load(handle)
    with gzip.open(DATA / "sellers.json.gz", "rt", encoding="utf-8") as handle:
        sellers = json.load(handle)
    checks: list[dict] = []
    end = date.fromisoformat(dashboard["meta"]["availableEnd"])
    prior_end = end.replace(year=end.year - 1)
    periods = {
        ("mtd", "current"): (end.replace(day=1).isoformat(), end.isoformat()),
        ("mtd", "previous"): (prior_end.replace(day=1).isoformat(), prior_end.isoformat()),
        ("mty", "current"): (end.replace(month=1, day=1).isoformat(), end.isoformat()),
        ("mty", "previous"): (prior_end.replace(month=1, day=1).isoformat(), prior_end.isoformat()),
    }
    fields = ("sale", "quantity", "basePresent", "profitPresent")
    tolerances = {"sale": 0.05, "quantity": 0.001, "basePresent": 2.0, "profitPresent": 2.0}
    for (period, side), (start, finish) in periods.items():
        label = f"{period}/{side}"
        for field in fields:
            overall = sum_period(dashboard["daily"]["overall"], start, finish, field)
            categories = sum_period(dashboard["daily"]["categories"], start, finish, field)
            dashboard_brands = sum_period(dashboard["daily"]["brands"], start, finish, field) if dashboard["daily"]["brands"] else sum_period(brands.get("productDaily", []), start, finish, field)
            product_total = sum(float(row["periods"][period][side].get(field) or 0) for row in products)
            store_total = sum_period(sellers["storeDaily"], start, finish, field)
            brand_store_total = sum(float(row.get(field) or 0) for row in brands.get("brandPeriods", []) if row["period"] == period and row["side"] == side and row["brand"] != "__ALL__")
            product_store_total = sum(float(row.get(field) or 0) for row in brands.get("productPeriods", []) if row["period"] == period and row["side"] == side)
            tolerance = tolerances[field]
            checks.extend([
                close(f"Categorias — {field} — {label}", categories, overall, tolerance),
                close(f"Marcas — {field} — {label}", dashboard_brands, overall, tolerance),
                close(f"Produtos — {field} — {label}", product_total, overall, tolerance),
                close(f"Lojas — {field} — {label}", store_total, overall, tolerance),
                close(f"Marcas por loja — {field} — {label}", brand_store_total, overall, tolerance),
                close(f"Produtos por loja — {field} — {label}", product_store_total, overall, tolerance),
            ])

    checks.append(close("Contagem de produtos", len(products), dashboard["meta"]["productCount"], 0))

    report = {
        "status": "aprovado",
        "checks": len(checks),
        "periods": [f"{period}/{side}" for period, side in periods],
        "tolerance": "R$ 0,05 em vendas; R$ 2,00 em base/lucro por arredondamento; 0,001 em quantidade",
        "results": checks,
    }
    (DATA / "validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": report["status"], "checks": report["checks"], "output": str(DATA / "validation.json")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
