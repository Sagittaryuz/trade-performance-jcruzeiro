#!/usr/bin/env python3
"""Gera fatos mensais de marcas/produtos por loja a partir dos movimentos do ODS."""

from __future__ import annotations

import gzip
import json
import sqlite3
import sys
import tempfile
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from lxml import etree

from import_seller_data import TABLE, br_number, cells, movement_date


def first_month(value: date, months_back: int) -> str:
    year = value.year
    month = value.month - months_back
    while month <= 0:
        month += 12
        year -= 1
    return f"{year:04d}-{month:02d}-01"


def store_name(value: str) -> str:
    raw = value.upper()
    return next((name for marker, name in [
        ("CATEDRAL", "Catedral"), ("MINEIROS", "Mineiros"),
        ("RHARO", "R. Haro"), ("SAID", "Said Abdala"),
        ("RIO VERDE", "Rio Verde"), ("MATRIZ", "Matriz"),
    ] if marker in raw), "Matriz")


def stream_json_array(handle, cursor, product=False):
    first = True
    for row in cursor:
        store, month, brand, *values = row
        if product:
            adm, description, sale, quantity, base, profit, transactions = values
        else:
            sale, quantity, base, profit, transactions = values
        item = {
            "store": store, "month": month, "brand": brand,
            "sale": sale, "quantity": quantity,
            "basePresent": base, "profitPresent": profit,
            "margin": profit / base * 100 if base else None,
            "transactions": transactions,
        }
        if product:
            item.update({"adm": adm, "description": description})
        if not first:
            handle.write(",")
        handle.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")))
        first = False


def stream_period_array(handle, rows):
    first = True
    for period, side, store, brand, sale, quantity, base, profit, transactions in rows:
        item = {
            "period": period, "side": side, "store": store, "brand": brand,
            "sale": sale, "quantity": quantity,
            "basePresent": base, "profitPresent": profit,
            "margin": profit / base * 100 if base else None,
            "transactions": transactions,
        }
        if not first:
            handle.write(",")
        handle.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")))
        first = False


def stream_product_period_array(handle, rows):
    first = True
    for period, side, store, brand, adm, description, sale, quantity, base, profit, transactions in rows:
        item = {
            "period": period, "side": side, "store": store, "brand": brand,
            "adm": adm, "description": description,
            "sale": sale, "quantity": quantity,
            "basePresent": base, "profitPresent": profit,
            "margin": profit / base * 100 if base else None,
            "transactions": transactions,
        }
        if not first:
            handle.write(",")
        handle.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")))
        first = False


def main():
    source = Path(sys.argv[1])
    destination = Path(sys.argv[2])
    master_path = Path(sys.argv[3])
    yesterday = datetime.now(ZoneInfo("America/Sao_Paulo")).date() - timedelta(days=1)
    read_start = f"{yesterday.year - 1:04d}-01-01"
    end = yesterday.isoformat()

    with gzip.open(master_path, "rt", encoding="utf-8") as handle:
        master = json.load(handle)
    products = {str(product["adm"]): product for product in master["products"]}

    database = Path(tempfile.gettempdir()) / "trade-performance-brand-movements.sqlite"
    database.unlink(missing_ok=True)
    connection = sqlite3.connect(database)
    connection.executescript("""
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA temp_store=FILE;
        CREATE TABLE movements (
          fingerprint TEXT PRIMARY KEY,
          store TEXT NOT NULL,
          day TEXT NOT NULL,
          brand TEXT NOT NULL,
          adm TEXT NOT NULL,
          description TEXT NOT NULL,
          movement TEXT NOT NULL,
          sale REAL NOT NULL,
          quantity REAL NOT NULL,
          base REAL NOT NULL,
          profit REAL NOT NULL
        ) WITHOUT ROWID;
    """)
    insert = "INSERT OR IGNORE INTO movements VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    batch = []
    current_store = ""
    current_seller = ""
    in_movements = False
    read_rows = 0

    with zipfile.ZipFile(source) as archive, archive.open("content.xml") as handle:
        for _, xml_row in etree.iterparse(handle, events=("end",), tag=f"{{{TABLE}}}table-row"):
            values = cells(xml_row)
            labels = [item["text"] for item in values]
            if len(labels) > 3 and labels[2].endswith("VENDAS"):
                current_store = store_name(labels[3])
                current_seller = labels[0]
                in_movements = False
            elif labels and labels[0] == "Movimento":
                if len(labels) <= 19 or "".join(labels[19].split()).casefold() != "%lucropres.":
                    raise RuntimeError("Coluna de margem dos movimentos não é %Lucro pres. na posição esperada.")
                in_movements = True
            elif current_seller and in_movements and len(labels) >= 20:
                movement_day = movement_date(labels[2])
                if movement_day and read_start <= movement_day <= end:
                    movement = labels[0].replace(".", "")
                    adm = labels[3].replace(".", "")
                    product = products.get(adm)
                    brand = product["brand"] if product else "NÃO IDENTIFICADA"
                    description = product["description"] if product else labels[4].title()
                    sale = br_number(labels[15])
                    quantity = br_number(labels[6])
                    base = br_number(labels[18])
                    margin = br_number(labels[19])
                    profit = base * margin / 100
                    fingerprint = "|".join((current_store, current_seller, movement, movement_day, adm, labels[6], labels[15], labels[18], labels[19]))
                    batch.append((fingerprint, current_store, movement_day, brand, adm, description, movement, sale, quantity, base, profit))
                    read_rows += 1
                    if len(batch) >= 5000:
                        connection.executemany(insert, batch)
                        connection.commit()
                        batch.clear()
            xml_row.clear()
    if batch:
        connection.executemany(insert, batch)
        connection.commit()

    actual_end = connection.execute("SELECT MAX(day) FROM movements").fetchone()[0] or end
    cutoff = date.fromisoformat(actual_end)
    start = first_month(cutoff, 11)
    brands = [row[0] for row in connection.execute("SELECT DISTINCT brand FROM movements ORDER BY brand")]
    brand_count = connection.execute("SELECT COUNT(*) FROM (SELECT store, substr(day,1,7), brand FROM movements WHERE day >= ? GROUP BY store, substr(day,1,7), brand)", (start,)).fetchone()[0]
    product_count = connection.execute("SELECT COUNT(*) FROM (SELECT store, substr(day,1,7), brand, adm FROM movements WHERE day >= ? GROUP BY store, substr(day,1,7), brand, adm)", (start,)).fetchone()[0]
    brand_query = connection.execute("""
        SELECT store, substr(day,1,7) AS month, brand, SUM(sale), SUM(quantity), SUM(base), SUM(profit), COUNT(DISTINCT movement)
        FROM movements WHERE day >= ? GROUP BY store, month, brand ORDER BY month, brand, store
    """, (start,))

    current_year = cutoff.year
    previous_year = current_year - 1
    month_day = actual_end[5:]
    ranges = {
        ("mtd", "current"): (f"{current_year}-{cutoff.month:02d}-01", actual_end),
        ("mtd", "previous"): (f"{previous_year}-{cutoff.month:02d}-01", f"{previous_year}-{month_day}"),
        ("mty", "current"): (f"{current_year}-01-01", actual_end),
        ("mty", "previous"): (f"{previous_year}-01-01", f"{previous_year}-{month_day}"),
    }
    period_rows = []
    product_period_rows = []
    for (period, side), (range_start, range_end) in ranges.items():
        scoped = connection.execute("""
            SELECT store, brand, SUM(sale), SUM(quantity), SUM(base), SUM(profit), COUNT(DISTINCT movement)
            FROM movements WHERE day BETWEEN ? AND ? GROUP BY store, brand
        """, (range_start, range_end)).fetchall()
        period_rows.extend((period, side, *row) for row in scoped)
        consolidated = connection.execute("""
            SELECT store, '__ALL__', SUM(sale), SUM(quantity), SUM(base), SUM(profit), COUNT(DISTINCT movement)
            FROM movements WHERE day BETWEEN ? AND ? GROUP BY store
        """, (range_start, range_end)).fetchall()
        period_rows.extend((period, side, *row) for row in consolidated)
        products_scoped = connection.execute("""
            SELECT store, brand, adm, MAX(description), SUM(sale), SUM(quantity), SUM(base), SUM(profit), COUNT(DISTINCT movement)
            FROM movements WHERE day BETWEEN ? AND ? GROUP BY store, brand, adm
        """, (range_start, range_end)).fetchall()
        product_period_rows.extend((period, side, *row) for row in products_scoped)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(destination, "wt", encoding="utf-8", compresslevel=9) as output:
        meta = {
            "source": source.name,
            "availableStart": start,
            "availableEnd": actual_end,
            "brands": len(brands),
            "brandMonthlyRows": brand_count,
            "productMonthlyRows": product_count,
            "movementRowsRead": read_rows,
            "marginBasis": "%Lucro pres. dos movimentos; consolidado ponderado por Base lucro pres.",
        }
        output.write('{"meta":')
        output.write(json.dumps(meta, ensure_ascii=False, separators=(",", ":")))
        output.write(',"brands":')
        output.write(json.dumps(brands, ensure_ascii=False, separators=(",", ":")))
        output.write(',"brandMonthly":[')
        stream_json_array(output, brand_query)
        output.write('],"productMonthly":[')
        product_query = connection.execute("""
            SELECT store, substr(day,1,7) AS month, brand, adm, MAX(description), SUM(sale), SUM(quantity), SUM(base), SUM(profit), COUNT(DISTINCT movement)
            FROM movements WHERE day >= ? GROUP BY store, month, brand, adm ORDER BY month, brand, adm, store
        """, (start,))
        stream_json_array(output, product_query, True)
        output.write('],"brandPeriods":[')
        stream_period_array(output, period_rows)
        output.write('],"productPeriods":[')
        stream_product_period_array(output, product_period_rows)
        output.write("]}")
    connection.close()
    database.unlink(missing_ok=True)
    print(json.dumps(meta, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
