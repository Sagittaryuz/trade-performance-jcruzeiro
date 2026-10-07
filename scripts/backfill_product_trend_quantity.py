#!/usr/bin/env python3
"""Adiciona a quantidade mensal exata às séries de produto já processadas."""

from __future__ import annotations

import gzip
import json
from collections import defaultdict
from pathlib import Path


def main():
    root = Path(__file__).resolve().parents[1] / "public" / "data"
    with gzip.open(root / "brands.json.gz", "rt", encoding="utf-8") as handle:
        brands = json.load(handle)
    with gzip.open(root / "products.json.gz", "rt", encoding="utf-8") as handle:
        products = json.load(handle)

    quantities = defaultdict(float)
    for row in brands["productMonthly"]:
        quantities[(str(row["adm"]), row["month"])] += row["quantity"]
    for product in products["products"]:
        for row in product.get("monthly", []):
            row["quantity"] = round(quantities[(str(product["adm"]), row["date"][:7])], 3)

    with gzip.open(root / "products.json.gz", "wt", encoding="utf-8", compresslevel=9) as handle:
        json.dump(products, handle, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
