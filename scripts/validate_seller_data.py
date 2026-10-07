#!/usr/bin/env python3
"""Valida a integração entre movimentos, lojas, vendedores e base mestre."""

import gzip
import json
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]


def load(path):
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


sellers = load(ROOT / "public/data/sellers.json.gz")
dashboard = load(ROOT / "public/data/dashboard.json.gz")
closed_day = datetime.now(ZoneInfo("America/Sao_Paulo")).date() - timedelta(days=1)
cutoff = min(dashboard["meta"]["availableEnd"], closed_day.isoformat())
store_daily = [row for row in sellers["storeDaily"] if row["date"] <= cutoff]
network_daily = [row for row in dashboard["daily"]["overall"] if row["date"] <= cutoff]
store_sale = sum(row["sale"] for row in store_daily)
network_sale = sum(row["sale"] for row in network_daily)
store_transactions = sum(row["transactions"] for row in store_daily)
network_transactions = sum(row["transactions"] for row in network_daily)

checks = {
    "six_stores": len(sellers["stores"]) == 6,
    "all_stores_have_sellers": all(store["sellerCount"] > 0 for store in sellers["stores"]),
    "seller_count": len(sellers["sellers"]) == sellers["meta"]["sellers"],
    "dated_movements": sellers["meta"]["periodCapability"] == "dated_movements" and bool(store_daily),
    "date_range": sellers["meta"]["availableStart"] >= "2025-01-01" and sellers["meta"]["availableEnd"] >= cutoff,
    "transaction_reconciliation": store_transactions == network_transactions,
    "sale_reconciliation": abs(store_sale - network_sale) / network_sale < 0.0001,
    "product_match": sellers["meta"]["matchRate"] >= 99.9,
    "product_detail_reconciliation": abs(sellers["meta"]["reconciliationRate"] - 100) < 0.01,
    "no_future_in_closed_cut": all(row["date"] <= cutoff for row in store_daily),
}
result = {
    "status": "aprovado" if all(checks.values()) else "reprovado",
    "cutoff": cutoff,
    "checks": checks,
    "storeSale": store_sale,
    "networkSale": network_sale,
    "saleReconciliationRate": store_sale / network_sale * 100 if network_sale else 0,
    "storeTransactions": store_transactions,
    "networkTransactions": network_transactions,
}
(ROOT / "public/data/seller-validation.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(result, ensure_ascii=False, indent=2))
raise SystemExit(0 if all(checks.values()) else 1)
