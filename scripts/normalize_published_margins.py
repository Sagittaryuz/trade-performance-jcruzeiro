#!/usr/bin/env python3
"""Normaliza margens publicadas pela base e pelo lucro presente já exibidos."""

from __future__ import annotations

import gzip
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"


def normalize(value, counters: dict[str, int]) -> None:
    if isinstance(value, list):
        for item in value:
            normalize(item, counters)
        return
    if not isinstance(value, dict):
        return
    if {"margin", "basePresent", "profitPresent"} <= value.keys():
        base = float(value.get("basePresent") or 0)
        profit = float(value.get("profitPresent") or 0)
        expected = round(profit / base * 100, 4) if base else None
        if value.get("margin") != expected:
            value["margin"] = expected
            counters["corrected"] += 1
    for item in value.values():
        normalize(item, counters)


def main() -> None:
    report = {}
    for path in sorted(DATA.glob("*.json.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            payload = json.load(handle)
        counters = {"corrected": 0}
        normalize(payload, counters)
        with gzip.open(path, "wt", encoding="utf-8", compresslevel=9) as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        report[path.name] = counters
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
