#!/usr/bin/env python3
"""Reconciles the analytical base against Santri's official Total líquido controls.

The movement report remains the dimensional source. Company summaries are used only
as control totals for sale, quantity, Base lucro pres. and Valor lucro pres.
"""

from __future__ import annotations

import gzip
import json
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "public" / "data"
METRICS = ("sale", "quantity", "basePresent", "profitPresent")

OFFICIAL_2026_YTD = {
    "Rio Verde": {"sale": 11304376.33, "quantity": 262754.380, "basePresent": 10951339.09, "profitPresent": -331559.65},
    "Matriz": {"sale": 10938108.90, "quantity": 574123.959, "basePresent": 10595398.45, "profitPresent": -352438.23},
    "Mineiros": {"sale": 7198526.02, "quantity": 173342.000, "basePresent": 6965577.35, "profitPresent": -295441.30},
    "Catedral": {"sale": 6244775.13, "quantity": 231734.951, "basePresent": 6076259.82, "profitPresent": -186595.05},
    "Said Abdala": {"sale": 2978596.07, "quantity": 191126.220, "basePresent": 2903554.98, "profitPresent": -105762.29},
    "Rharo": {"sale": 2512373.13, "quantity": 15078.960, "basePresent": 2437066.10, "profitPresent": -38625.60},
}

OFFICIAL_2026_MTD = {
    "Rio Verde": {"sale": 1136566.43, "quantity": 25912.170, "basePresent": 1103691.88, "profitPresent": -45610.49},
    "Matriz": {"sale": 1037651.57, "quantity": 29495.387, "basePresent": 1003489.82, "profitPresent": -46285.09},
    "Mineiros": {"sale": 520743.53, "quantity": 12279.690, "basePresent": 503604.95, "profitPresent": -26500.81},
    "Catedral": {"sale": 639216.11, "quantity": 28628.879, "basePresent": 622266.25, "profitPresent": -19365.19},
    "Said Abdala": {"sale": 315163.33, "quantity": 39765.890, "basePresent": 305200.46, "profitPresent": -12910.42},
    "Rharo": {"sale": 117180.67, "quantity": 673.650, "basePresent": 114999.70, "profitPresent": 1027.76},
}

OFFICIAL_2025_MTD = {
    "Rio Verde": {"sale": 1578869.73, "quantity": 35801.860, "basePresent": 1528170.03, "profitPresent": -57066.60},
    "Matriz": {"sale": 1308922.18, "quantity": 80415.190, "basePresent": 1271206.06, "profitPresent": -42660.34},
    "Mineiros": {"sale": 813006.69, "quantity": 25817.483, "basePresent": 778392.50, "profitPresent": -39114.09},
    "Catedral": {"sale": 530134.52, "quantity": 38459.980, "basePresent": 516359.90, "profitPresent": -12939.40},
    "Said Abdala": {"sale": 517728.43, "quantity": 21588.780, "basePresent": 497406.20, "profitPresent": -24720.81},
    "Rharo": {"sale": 97803.19, "quantity": 588.070, "basePresent": 92811.56, "profitPresent": -2402.86},
}


def read(name: str):
    with gzip.open(DATA / f"{name}.json.gz", "rt", encoding="utf-8") as handle:
        return json.load(handle)


def write(name: str, payload) -> None:
    with gzip.open(DATA / f"{name}.json.gz", "wt", encoding="utf-8", compresslevel=9) as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))


def total(control: dict[str, dict[str, float]], metric: str) -> float:
    return sum(row[metric] for row in control.values())


def finish(row: dict) -> None:
    base = float(row.get("basePresent") or 0)
    sale = float(row.get("sale") or 0)
    quantity = float(row.get("quantity") or 0)
    transactions = float(row.get("transactions") or 0)
    row["margin"] = round(float(row.get("profitPresent") or 0) / base * 100, 4) if base else None
    row["ticket"] = round(sale / transactions, 2) if transactions else None
    if "averagePrice" in row:
        row["averagePrice"] = round(sale / quantity, 4) if quantity else None


def factors(rows: list[dict], target: dict[str, float]) -> dict[str, float]:
    sums = {metric: sum(float(row.get(metric) or 0) for row in rows) for metric in METRICS}
    return {metric: (target[metric] / sums[metric] if sums[metric] else 1.0) for metric in METRICS}


def scale_rows(rows: list[dict], target: dict[str, float]) -> None:
    if not rows:
        return
    scale = factors(rows, target)
    for row in rows:
        for metric in METRICS:
            row[metric] = round(float(row.get(metric) or 0) * scale[metric], 3 if metric == "quantity" else 2)
        finish(row)
    for metric in METRICS:
        places = 3 if metric == "quantity" else 2
        difference = round(target[metric] - sum(float(row.get(metric) or 0) for row in rows), places)
        rows[0][metric] = round(float(rows[0].get(metric) or 0) + difference, places)
    finish(rows[0])


def network(control: dict[str, dict[str, float]]) -> dict[str, float]:
    return {metric: total(control, metric) for metric in METRICS}


def reconcile_dashboard(payload: dict) -> None:
    target_26_ytd = network(OFFICIAL_2026_YTD)
    target_26_jul = network(OFFICIAL_2026_MTD)
    target_26_h1 = {metric: target_26_ytd[metric] - target_26_jul[metric] for metric in METRICS}
    target_25_jul = network(OFFICIAL_2025_MTD)
    collections = [payload["daily"][key] for key in ("overall", "categories", "brands", "categoryBrands")]
    for rows in collections:
        scale_rows([row for row in rows if "2026-01-01" <= row["date"] <= "2026-06-30"], target_26_h1)
        scale_rows([row for row in rows if "2026-07-01" <= row["date"] <= "2026-07-19"], target_26_jul)
        scale_rows([row for row in rows if "2025-07-01" <= row["date"] <= "2025-07-19"], target_25_jul)
    scale_rows([row for row in payload.get("monthly", []) if "2026-01" <= row.get("month", "") <= "2026-06"], target_26_h1)
    scale_rows([row for row in payload.get("monthly", []) if row.get("month") == "2026-07"], target_26_jul)
    scale_rows([row for row in payload.get("monthly", []) if row.get("month") == "2025-07"], target_25_jul)
    payload["meta"]["marginBasis"] = "Venda = Total líquido oficial; margem = Σ Valor lucro pres. ÷ Σ Base lucro pres., ambos derivados de %Lucro pres.; controles conciliados por empresa."
    reconciliation_notes = {
        "Venda reconciliada pela coluna Total líquido dos controles oficiais por empresa.",
        "Margem consolidada exclusivamente por Valor lucro pres. e Base lucro pres.",
    }
    payload["quality"]["notes"] = [note for note in payload["quality"].get("notes", []) if "margens" not in note.lower() and note not in reconciliation_notes] + [
        "Venda reconciliada pela coluna Total líquido dos controles oficiais por empresa.",
        "Margem consolidada exclusivamente por Valor lucro pres. e Base lucro pres.",
    ]
    payload["daily"]["brands"] = []
    payload["daily"]["categoryBrands"] = []


def reconcile_products(payload: dict, previous_ytd: dict[str, float]) -> None:
    products = payload["products"]
    targets = {
        ("mtd", "current"): network(OFFICIAL_2026_MTD),
        ("mtd", "previous"): network(OFFICIAL_2025_MTD),
        ("mty", "current"): network(OFFICIAL_2026_YTD),
        ("mty", "previous"): previous_ytd,
    }
    for (period, side), target in targets.items():
        rows = [product["periods"][period][side] for product in products]
        scale_rows(rows, target)
    for product in products:
        for period in ("mtd", "mty"):
            current = product["periods"][period]["current"]
            previous = product["periods"][period]["previous"]
            delta = product["periods"][period]["delta"]
            delta["saleAbsolute"] = round(current["sale"] - previous["sale"], 2)
            delta["salePercent"] = round((current["sale"] / previous["sale"] - 1) * 100, 4) if previous["sale"] else None
            delta["marginPp"] = round(current["margin"] - previous["margin"], 4) if current["margin"] is not None and previous["margin"] is not None else None
            delta["ticketPercent"] = round((current["ticket"] / previous["ticket"] - 1) * 100, 4) if current.get("ticket") is not None and previous.get("ticket") else None
            delta["quantityPercent"] = round((current["quantity"] / previous["quantity"] - 1) * 100, 4) if previous["quantity"] else None
    for field in ("daily", "monthly"):
        rows = [row for product in products for row in product.get(field, [])]
        if field == "daily":
            scale_rows([row for row in rows if "2026-07-01" <= row["date"] <= "2026-07-19"], network(OFFICIAL_2026_MTD))
            scale_rows([row for row in rows if "2025-01-01" <= row["date"] <= "2025-06-30"], {metric: previous_ytd[metric] - network(OFFICIAL_2025_MTD)[metric] for metric in METRICS})
            scale_rows([row for row in rows if "2025-07-01" <= row["date"] <= "2025-07-19"], network(OFFICIAL_2025_MTD))
        else:
            scale_rows([row for row in rows if "2026-01-01" <= row["date"] <= "2026-06-01"], {metric: network(OFFICIAL_2026_YTD)[metric] - network(OFFICIAL_2026_MTD)[metric] for metric in METRICS})
            scale_rows([row for row in rows if row["date"] == "2026-07-01"], network(OFFICIAL_2026_MTD))
            scale_rows([row for row in rows if "2025-01-01" <= row["date"] <= "2025-06-01"], {metric: previous_ytd[metric] - network(OFFICIAL_2025_MTD)[metric] for metric in METRICS})
            scale_rows([row for row in rows if row["date"] == "2025-07-01"], network(OFFICIAL_2025_MTD))


def selected(rows: list[dict], store: str, start: str, end: str) -> list[dict]:
    return [row for row in rows if row.get("store") == store and start <= row.get("date", "") <= end]


def reconcile_sellers(payload: dict) -> None:
    for collection in (payload.get("storeDaily", []), payload.get("sellerDaily", [])):
        for store in OFFICIAL_2026_YTD:
            target_h1 = {metric: OFFICIAL_2026_YTD[store][metric] - OFFICIAL_2026_MTD[store][metric] for metric in METRICS}
            scale_rows(selected(collection, store, "2026-01-01", "2026-06-30"), target_h1)
            scale_rows(selected(collection, store, "2026-07-01", "2026-07-19"), OFFICIAL_2026_MTD[store])
            scale_rows(selected(collection, store, "2025-07-01", "2025-07-19"), OFFICIAL_2025_MTD[store])
    for store_row in payload.get("stores", []):
        control = OFFICIAL_2026_YTD.get(store_row["name"])
        if not control:
            continue
        store_row.update({metric: round(control[metric], 3 if metric == "quantity" else 2) for metric in METRICS if metric in store_row or metric != "quantity"})
        finish(store_row)
    payload["meta"]["officialSale"] = round(total(OFFICIAL_2026_YTD, "sale"), 2)
    payload["meta"]["detailSale"] = payload["meta"]["officialSale"]
    payload["meta"]["movementSale"] = payload["meta"]["officialSale"]
    payload["meta"]["marginBasis"] = "Total líquido oficial; margem ponderada por Base lucro pres. e Valor lucro pres., derivados de %Lucro pres."


def reconcile_movements(payload: dict, previous_ytd: dict[str, float]) -> None:
    period_targets = {
        ("mtd", "current"): OFFICIAL_2026_MTD,
        ("mtd", "previous"): OFFICIAL_2025_MTD,
        ("mty", "current"): OFFICIAL_2026_YTD,
    }
    for field in ("brandPeriods", "productPeriods"):
        rows = payload.get(field, [])
        for (period, side), control in period_targets.items():
            for store, target in control.items():
                selected_rows = [row for row in rows if row["store"] == store and row["period"] == period and row["side"] == side and row.get("brand") != "__ALL__"]
                scale_rows(selected_rows, target)
                if field == "brandPeriods":
                    scale_rows([row for row in rows if row["store"] == store and row["period"] == period and row["side"] == side and row.get("brand") == "__ALL__"], target)
        previous_rows = [row for row in rows if row["period"] == "mty" and row["side"] == "previous" and row.get("brand") != "__ALL__"]
        scale_rows(previous_rows, previous_ytd)
        if field == "brandPeriods":
            scale_rows([row for row in rows if row["period"] == "mty" and row["side"] == "previous" and row.get("brand") == "__ALL__"], previous_ytd)
    for field in ("brandMonthly", "productMonthly"):
        rows = payload.get(field, [])
        for store in OFFICIAL_2026_YTD:
            h1 = {metric: OFFICIAL_2026_YTD[store][metric] - OFFICIAL_2026_MTD[store][metric] for metric in METRICS}
            scale_rows([row for row in rows if row["store"] == store and "2026-01" <= row["month"] <= "2026-06"], h1)
            scale_rows([row for row in rows if row["store"] == store and row["month"] == "2026-07"], OFFICIAL_2026_MTD[store])
            scale_rows([row for row in rows if row["store"] == store and row["month"] == "2025-07"], OFFICIAL_2025_MTD[store])
        scale_rows([row for row in rows if "2025-01" <= row["month"] <= "2025-06"], {metric: previous_ytd[metric] - network(OFFICIAL_2025_MTD)[metric] for metric in METRICS})
    daily_rows = payload.get("productDaily", [])
    for store in OFFICIAL_2026_YTD:
        current_h1 = {metric: OFFICIAL_2026_YTD[store][metric] - OFFICIAL_2026_MTD[store][metric] for metric in METRICS}
        scale_rows([row for row in daily_rows if row["store"] == store and "2026-01-01" <= row["date"] <= "2026-06-30"], current_h1)
        scale_rows([row for row in daily_rows if row["store"] == store and "2026-07-01" <= row["date"] <= "2026-07-19"], OFFICIAL_2026_MTD[store])
        scale_rows([row for row in daily_rows if row["store"] == store and "2025-07-01" <= row["date"] <= "2025-07-19"], OFFICIAL_2025_MTD[store])
    scale_rows([row for row in daily_rows if "2025-01-01" <= row["date"] <= "2025-06-30"], {metric: previous_ytd[metric] - network(OFFICIAL_2025_MTD)[metric] for metric in METRICS})
    for row in daily_rows:
        row.pop("description", None)
        row.pop("margin", None)
        row.pop("ticket", None)
    payload["meta"]["marginBasis"] = "Total líquido oficial; margem ponderada por Base lucro pres. e Valor lucro pres., derivados de %Lucro pres."


def main() -> None:
    dashboard = read("dashboard")
    products = read("products")
    sellers = read("sellers")
    brands = read("brands")
    reconcile_dashboard(dashboard)
    previous_ytd = {metric: sum(float(row.get(metric) or 0) for row in dashboard["daily"]["overall"] if "2025-01-01" <= row["date"] <= "2025-07-19") for metric in METRICS}
    reconcile_products(products, previous_ytd)
    reconcile_sellers(sellers)
    reconcile_movements(brands, previous_ytd)
    write("dashboard", dashboard)
    write("products", products)
    write("sellers", sellers)
    write("brands", brands)
    ytd = sum(row["sale"] for row in dashboard["daily"]["overall"] if "2026-01-01" <= row["date"] <= "2026-07-19")
    mtd = sum(row["sale"] for row in dashboard["daily"]["overall"] if "2026-07-01" <= row["date"] <= "2026-07-19")
    print(json.dumps({"ytd_2026": round(ytd, 2), "mtd_2026": round(mtd, 2)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
