#!/usr/bin/env python3
"""Importa o relatório ODS por vendedor sem expandir o XML de ~2 GB em disco."""

from __future__ import annotations

import gzip
import json
import re
import sys
import zipfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from lxml import etree

TABLE = "urn:oasis:names:tc:opendocument:xmlns:table:1.0"
OFFICE = "urn:oasis:names:tc:opendocument:xmlns:office:1.0"


def number(value: str | None) -> float:
    if not value:
        return 0.0
    try:
        parsed = float(value)
        return 0.0 if abs(parsed) > 1e15 else parsed
    except ValueError:
        return 0.0


def br_number(value: str | None) -> float:
    if not value:
        return 0.0
    try:
        parsed = float(value.replace(".", "").replace(",", "."))
        return 0.0 if abs(parsed) > 1e15 else parsed
    except ValueError:
        return 0.0


def movement_date(value: str) -> str | None:
    try:
        return datetime.strptime(value[:8], "%d/%m/%y").strftime("%Y-%m-%d")
    except ValueError:
        return None


def text(cell) -> str:
    return " ".join("".join(cell.itertext()).split())


def cells(row):
    result = []
    for cell in row.findall(f"{{{TABLE}}}table-cell"):
        repeat = int(cell.get(f"{{{TABLE}}}number-columns-repeated", "1"))
        item = {
            "text": text(cell),
            "value": cell.get(f"{{{OFFICE}}}value"),
        }
        result.extend([item] * min(repeat, 40))
    return result


def main() -> None:
    source = Path(sys.argv[1])
    destination = Path(sys.argv[2])
    master_path = Path(sys.argv[3])

    with gzip.open(master_path, "rt", encoding="utf-8") as handle:
        master = json.load(handle)
    products = {str(p["adm"]): p for p in master["products"]}

    sellers = []
    store_products = defaultdict(lambda: defaultdict(lambda: {"sale": 0.0, "profitPresent": 0.0, "basePresent": 0.0, "quantity": 0.0, "description": "", "brand": ""}))
    store_daily = defaultdict(lambda: defaultdict(lambda: {"sale": 0.0, "profitPresent": 0.0, "basePresent": 0.0, "quantity": 0.0, "movements": set()}))
    seller_daily = defaultdict(lambda: defaultdict(lambda: {"sale": 0.0, "profitPresent": 0.0, "basePresent": 0.0, "quantity": 0.0, "movements": set()}))
    current_store = ""
    current_seller = None
    product_rows = matched_rows = 0
    distinct = set()
    unmatched = set()
    description_mismatches = 0
    overflow_rows = 0
    movement_rows = 0
    movement_sale = 0.0
    movement_transactions = set()
    movement_owner = {}
    shared_movement_rows = 0
    movement_fingerprints = set()
    duplicate_movement_rows = 0
    in_movements = False

    with zipfile.ZipFile(source) as archive, archive.open("content.xml") as handle:
        for _, row in etree.iterparse(handle, events=("end",), tag=f"{{{TABLE}}}table-row"):
            values = cells(row)
            labels = [item["text"] for item in values]
            if len(labels) >= 23 and len(labels) > 3 and labels[2].endswith("VENDAS") and " - " in labels[3]:
                raw_store = labels[3].upper()
                store = next((name for marker, name in [
                    ("CATEDRAL", "Catedral"), ("MINEIROS", "Mineiros"),
                    ("RHARO", "R. Haro"), ("SAID", "Said Abdala"),
                    ("RIO VERDE", "Rio Verde"), ("MATRIZ", "Matriz"),
                ] if marker in raw_store), "Matriz")
                sale = number(values[15]["value"])
                base = number(values[20]["value"])
                profit = number(values[21]["value"])
                current_seller = {
                    "code": labels[0], "name": labels[1].title(), "store": store,
                    "sale": sale, "cost": number(values[16]["value"]),
                    "profitPresent": profit, "basePresent": base,
                    "margin": br_number(labels[22]) if len(labels) > 22 else ((profit / base * 100) if base else None),
                }
                sellers.append(current_seller)
                current_store = store
                in_movements = False
            elif labels and labels[0] == "Movimento":
                if len(labels) <= 19 or "".join(labels[19].split()).casefold() != "%lucropres.":
                    raise RuntimeError("Coluna de margem dos movimentos não é %Lucro pres. na posição esperada.")
                in_movements = True
            elif current_seller and in_movements and len(labels) >= 20 and movement_date(labels[2]):
                date = movement_date(labels[2])
                movement_id = labels[0].replace(".", "")
                movement_key = (current_store, movement_id)
                owner = movement_owner.setdefault(movement_key, current_seller["code"])
                if owner != current_seller["code"]:
                    shared_movement_rows += 1
                    row.clear()
                    continue
                fingerprint = (current_store, current_seller["code"], movement_id, date, labels[3], labels[6], labels[15], labels[18], labels[19])
                if fingerprint in movement_fingerprints:
                    duplicate_movement_rows += 1
                    row.clear()
                    continue
                movement_fingerprints.add(fingerprint)
                quantity = br_number(labels[6])
                sale = br_number(labels[15])
                base = br_number(labels[18])
                margin = br_number(labels[19])
                profit = base * margin / 100
                daily = store_daily[current_store][date]
                daily["sale"] += sale
                daily["quantity"] += quantity
                daily["basePresent"] += base
                daily["profitPresent"] += profit
                daily["movements"].add(movement_id)
                seller_key = (current_store, current_seller["code"], current_seller["name"])
                seller_day = seller_daily[seller_key][date]
                seller_day["sale"] += sale
                seller_day["quantity"] += quantity
                seller_day["basePresent"] += base
                seller_day["profitPresent"] += profit
                seller_day["movements"].add(movement_id)
                movement_transactions.add((current_store, movement_id))
                movement_rows += 1
                movement_sale += sale
            elif current_seller and not in_movements and len(labels) >= 23 and labels[0].isdigit() and labels[1] and labels[2] != "Departamento":
                adm = labels[0]
                product_rows += 1
                distinct.add(adm)
                product = products.get(adm)
                if product:
                    matched_rows += 1
                    if labels[1].strip().upper() != product["description"].strip().upper():
                        description_mismatches += 1
                else:
                    unmatched.add(adm)
                nums = [number(item["value"]) for item in values]
                if any(abs(number(item["value"])) >= 1e15 for item in values):
                    overflow_rows += 1
                target = store_products[current_store][adm]
                target["description"] = product["description"] if product else labels[1].title()
                target["brand"] = product["brand"] if product else labels[3]
                target["sale"] += nums[15] if len(nums) > 15 else 0
                target["quantity"] += nums[7] if len(nums) > 7 else 0
                target["basePresent"] += nums[20] if len(nums) > 20 else 0
                target["profitPresent"] += nums[21] if len(nums) > 21 else 0
            row.clear()

    store_rows = []
    for store in ["Matriz", "Catedral", "Mineiros", "R. Haro", "Said Abdala", "Rio Verde"]:
        members = [seller for seller in sellers if seller["store"] == store]
        sale = sum(s["sale"] for s in members)
        base = sum(s["basePresent"] for s in members)
        profit = sum(s["profitPresent"] for s in members)
        detail_sale = sum(p["sale"] for p in store_products[store].values())
        top = sorted((dict({"adm": adm}, **metrics) for adm, metrics in store_products[store].items()), key=lambda p: p["sale"], reverse=True)[:10]
        store_rows.append({
            "name": store, "sellerCount": len(members), "sale": sale,
            "profitPresent": profit, "basePresent": base,
            "margin": (profit / base * 100) if base else None,
            "detailSale": detail_sale, "reconciliationGap": sale - detail_sale,
            "topProducts": top,
        })

    total = sum(store["sale"] for store in store_rows)
    detail_total = sum(store["detailSale"] for store in store_rows)
    for store in store_rows:
        store["share"] = store["sale"] / total * 100 if total else 0
    sellers.sort(key=lambda seller: seller["sale"], reverse=True)

    daily_rows = []
    for store, dates in store_daily.items():
        for date, metrics in dates.items():
            base = metrics["basePresent"]
            daily_rows.append({
                "store": store, "date": date,
                "sale": metrics["sale"], "quantity": metrics["quantity"],
                "basePresent": base, "profitPresent": metrics["profitPresent"],
                "margin": metrics["profitPresent"] / base * 100 if base else None,
                "transactions": len(metrics["movements"]),
            })
    daily_rows.sort(key=lambda row: (row["date"], row["store"]))

    seller_daily_rows = []
    for (store, code, name), dates in seller_daily.items():
        for date, metrics in dates.items():
            base = metrics["basePresent"]
            seller_daily_rows.append({
                "store": store, "code": code, "name": name, "date": date,
                "sale": metrics["sale"], "quantity": metrics["quantity"],
                "basePresent": base, "profitPresent": metrics["profitPresent"],
                "margin": metrics["profitPresent"] / base * 100 if base else None,
                "transactions": len(metrics["movements"]),
            })
    seller_daily_rows.sort(key=lambda row: (row["date"], row["store"], row["name"]))


    output = {
        "meta": {
            "source": source.name, "stores": len(store_rows), "sellers": len(sellers),
            "productRows": product_rows, "distinctAdm": len(distinct),
            "matchedDistinctAdm": len(distinct - unmatched),
            "matchRate": (len(distinct - unmatched) / len(distinct) * 100) if distinct else 0,
            "matchedRows": matched_rows, "descriptionMismatches": description_mismatches,
            "overflowRows": overflow_rows,
            "periodCapability": "dated_movements",
            "periodNote": "Movimentos atribuídos por loja e vendedor usando a data de recebimento do relatório.",
            "officialSale": total, "detailSale": detail_total,
            "reconciliationRate": detail_total / total * 100 if total else 0,
            "movementRows": movement_rows,
            "movementSale": movement_sale,
            "movementTransactions": len(movement_transactions),
            "sharedMovementRowsRemoved": shared_movement_rows,
            "duplicateMovementRowsRemoved": duplicate_movement_rows,
            "movementReconciliationRate": movement_sale / total * 100 if total else 0,
            "availableStart": daily_rows[0]["date"] if daily_rows else None,
            "availableEnd": daily_rows[-1]["date"] if daily_rows else None,
            "marginBasis": "%Lucro pres. dos movimentos; consolidado ponderado por Base lucro pres.",
        },
        "stores": store_rows,
        "sellers": sellers,
        "storeDaily": daily_rows,
        "sellerDaily": seller_daily_rows,
        "unmatchedAdm": sorted(unmatched),
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(destination, "wt", encoding="utf-8", compresslevel=9) as handle:
        json.dump(output, handle, ensure_ascii=False, separators=(",", ":"))
    print(json.dumps(output["meta"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
