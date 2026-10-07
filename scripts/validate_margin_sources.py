#!/usr/bin/env python3
"""Confere que toda margem publicada fecha com lucro/base presentes."""

from __future__ import annotations

import gzip
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"
BASE_TOLERANCE_PP = 0.011


def load(filename: str):
    with gzip.open(DATA / filename, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def audit(value, location: str, results: list[dict]) -> None:
    if isinstance(value, list):
        for index, item in enumerate(value):
            audit(item, f"{location}[{index}]", results)
        return
    if not isinstance(value, dict):
        return

    if {"margin", "basePresent", "profitPresent"} <= value.keys():
        base = float(value.get("basePresent") or 0)
        actual = value.get("margin")
        expected = float(value.get("profitPresent") or 0) / base * 100 if base else None
        difference = 0.0 if actual is None and expected is None else abs(float(actual or 0) - float(expected or 0))
        # Lucro e base são publicados com centavos, enquanto a margem é calculada
        # antes do arredondamento. Em bases muito pequenas, R$ 0,01 pode representar
        # vários pontos percentuais; a tolerância precisa acompanhar esse efeito.
        tolerance = BASE_TOLERANCE_PP + (0.011 / abs(base) * 100 if base else 0)
        results.append({"location": location, "differencePp": difference, "ok": difference <= tolerance})

    for key, item in value.items():
        audit(item, f"{location}.{key}", results)


def main() -> None:
    files = ["dashboard.json.gz", "products.json.gz", "sellers.json.gz", "brands.json.gz"]
    report = {}
    failures = []
    for filename in files:
        payload = load(filename)
        results: list[dict] = []
        audit(payload, filename, results)
        failed = [result for result in results if not result["ok"]]
        report[filename] = {
            "marginsChecked": len(results),
            "maximumDifferencePp": max((result["differencePp"] for result in results), default=0),
            "failures": len(failed),
        }
        failures.extend(failed)

    dashboard = load("dashboard.json.gz")
    if "%Lucro pres." not in dashboard["meta"]["marginBasis"]:
        failures.append({"location": "dashboard.meta.marginBasis", "ok": False})
    for filename in ("sellers.json.gz", "brands.json.gz"):
        payload = load(filename)
        if "%Lucro pres." not in payload["meta"].get("marginBasis", ""):
            failures.append({"location": f"{filename}.meta.marginBasis", "ok": False})

    print(json.dumps({"status": "aprovado" if not failures else "reprovado", "files": report}, ensure_ascii=False, indent=2))
    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
