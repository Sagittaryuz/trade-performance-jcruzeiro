#!/usr/bin/env python3
"""Preenche o consolidado de rede por loja quando a ODS original não está disponível."""

from __future__ import annotations

import gzip
import json
from datetime import date
from pathlib import Path


def aggregate(rows, start: str, end: str):
    scoped = [row for row in rows if start <= row["date"] <= end]
    sale = sum(row["sale"] for row in scoped)
    quantity = sum(row["quantity"] for row in scoped)
    base = sum(row["basePresent"] for row in scoped)
    profit = sum(row["profitPresent"] for row in scoped)
    transactions = sum(row["transactions"] for row in scoped)
    return {
        "sale": round(sale, 2), "quantity": round(quantity, 3),
        "basePresent": round(base, 2), "profitPresent": round(profit, 2),
        "margin": round(profit / base * 100, 4) if base else None,
        "transactions": transactions,
    }


def main():
    root = Path(__file__).resolve().parents[1] / "public" / "data"
    with gzip.open(root / "brands.json.gz", "rt", encoding="utf-8") as handle:
        brands = json.load(handle)
    with gzip.open(root / "sellers.json.gz", "rt", encoding="utf-8") as handle:
        sellers = json.load(handle)

    cutoff = date.fromisoformat(min(brands["meta"]["availableEnd"], sellers["meta"]["availableEnd"]))
    previous_year = cutoff.year - 1
    month_day = cutoff.strftime("%m-%d")
    ranges = {
        ("mtd", "current"): (cutoff.strftime("%Y-%m-01"), cutoff.isoformat()),
        ("mtd", "previous"): (f"{previous_year}-{cutoff.month:02d}-01", f"{previous_year}-{month_day}"),
        ("mty", "current"): (f"{cutoff.year}-01-01", cutoff.isoformat()),
        ("mty", "previous"): (f"{previous_year}-01-01", f"{previous_year}-{month_day}"),
    }
    periods = []
    stores = sorted({row["store"] for row in sellers["storeDaily"]})
    for (period, side), (start, end) in ranges.items():
        for store in stores:
            rows = [row for row in sellers["storeDaily"] if row["store"] == store]
            periods.append({"period": period, "side": side, "store": store, "brand": "__ALL__", **aggregate(rows, start, end)})
    brands["brandPeriods"] = periods
    with gzip.open(root / "brands.json.gz", "wt", encoding="utf-8", compresslevel=9) as handle:
        json.dump(brands, handle, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
