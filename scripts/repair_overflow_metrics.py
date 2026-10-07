#!/usr/bin/env python3
"""Restaura o último agregado auditado e corrige somente estouros de custo do ODS.

Lucro e margem presentes vêm de %Lucro pres. e não podem ser recompostos pelo
custo contábil quando um estouro é corrigido.
"""

from __future__ import annotations

import gzip
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"
OVERFLOW_UNIT = 922_337_203_685_477.63


def repair_metrics(value, counters: dict[str, int]):
    if isinstance(value, list):
        for item in value:
            repair_metrics(item, counters)
        return
    if not isinstance(value, dict):
        return

    cost = value.get("cost")
    if isinstance(cost, (int, float)) and cost < -1_000_000_000_000 and {"sale", "basePresent", "profit", "profitPresent"} <= value.keys():
        occurrences = max(1, round(abs(cost) / OVERFLOW_UNIT))
        corrected_cost = cost + occurrences * OVERFLOW_UNIT
        if abs(corrected_cost) > 1_000_000_000:
            raise ValueError(f"Custo ainda inválido após correção: {corrected_cost}")
        sale = float(value["sale"] or 0)
        profit = sale - corrected_cost
        value["cost"] = round(corrected_cost, 2)
        value["profit"] = round(profit, 2)
        counters["objects"] += 1
        counters["rows"] += occurrences

    for item in value.values():
        repair_metrics(item, counters)


def restore_and_repair(filename: str) -> dict[str, int]:
    compressed = subprocess.check_output(["git", "show", f"HEAD:public/data/{filename}"], cwd=ROOT)
    payload = json.loads(gzip.decompress(compressed).decode("utf-8"))
    counters = {"objects": 0, "rows": 0}
    repair_metrics(payload, counters)
    destination = DATA / filename
    with gzip.open(destination, "wt", encoding="utf-8", compresslevel=9) as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
    return counters


def main() -> None:
    dashboard = restore_and_repair("dashboard.json.gz")
    products = restore_and_repair("products.json.gz")
    print(json.dumps({"dashboard": dashboard, "products": products}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
