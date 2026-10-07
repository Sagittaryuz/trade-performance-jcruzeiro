#!/usr/bin/env python3
"""Converte o relatório hierárquico Santri (ODS) em agregados JSON para o BI.

Uso:
    python3 scripts/import_sales_data.py /caminho/relatorio.ods

O relatório não é copiado para o site. Somente agregados necessários ao front-end
são gravados em public/data/dashboard.json.
"""

from __future__ import annotations

import json
import gzip
import math
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, DefaultDict, Iterable
from zipfile import ZipFile
from zoneinfo import ZoneInfo

from lxml import etree


TABLE_NS = "urn:oasis:names:tc:opendocument:xmlns:table:1.0"
OFFICE_NS = "urn:oasis:names:tc:opendocument:xmlns:office:1.0"
TABLE = f"{{{TABLE_NS}}}"
OFFICE = f"{{{OFFICE_NS}}}"

GROUP_CODE = re.compile(r"^\d{3}(?:\.\d{3}){0,3}$")
MOVEMENT_CODE = re.compile(r"^\d{1,3}(?:\.\d{3})+$")
PRODUCT_CODE = re.compile(r"^\d+$")


def normalized_header(value: str) -> str:
    return re.sub(r"\s+", "", value).casefold()


def br_number(value: str | None) -> float:
    if not value:
        return 0.0
    cleaned = value.strip().replace("R$", "").replace(" ", "")
    if not cleaned:
        return 0.0
    if "," in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    try:
        number = float(cleaned)
        return number if math.isfinite(number) else 0.0
    except ValueError:
        return 0.0


def parse_date(value: str) -> date | None:
    text = value.strip()
    for fmt in ("%d/%m/%y %H:%M:%S", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    return None


def parse_emission(value: str) -> str | None:
    match = re.search(r"(\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2}:\d{2})", value)
    if not match:
        return None
    return datetime.strptime(" ".join(match.groups()), "%d/%m/%Y %H:%M:%S").isoformat()


def extract_row(element: etree._Element, max_columns: int = 30) -> list[str]:
    values: list[str] = []
    for cell in element:
        if cell.tag not in (TABLE + "table-cell", TABLE + "covered-table-cell"):
            continue
        repeat = int(cell.get(TABLE + "number-columns-repeated", "1"))
        text = "".join(cell.itertext()).strip()
        if not text:
            text = (
                cell.get(OFFICE + "value")
                or cell.get(OFFICE + "date-value")
                or cell.get(OFFICE + "time-value")
                or ""
            )
        remaining = max_columns - len(values)
        if remaining <= 0:
            break
        values.extend([text] * min(repeat, remaining))
    while values and values[-1] == "":
        values.pop()
    return values


@dataclass
class Metrics:
    sale: float = 0.0
    gross: float = 0.0
    freight: float = 0.0
    discount: float = 0.0
    quantity: float = 0.0
    cost: float = 0.0
    base_present: float = 0.0
    profit: float = 0.0
    profit_present: float = 0.0
    transactions: set[str] = field(default_factory=set)
    skus: set[str] = field(default_factory=set)

    def add(self, movement: dict[str, Any]) -> None:
        self.sale += movement["sale"]
        self.gross += movement["gross"]
        self.freight += movement["freight"]
        self.discount += movement["discount"]
        self.quantity += movement["quantity"]
        self.cost += movement["cost"]
        self.base_present += movement["base_present"]
        self.profit += movement["profit"]
        self.profit_present += movement["profit_present"]
        self.transactions.add(movement["movement"])
        self.skus.add(movement["adm"])

    def json(self) -> dict[str, float | int | None]:
        tx = len(self.transactions)
        skus = len(self.skus)
        margin = self.profit_present / self.base_present * 100 if self.base_present else None
        gross_base = self.gross if self.gross else self.sale + self.discount
        discount_rate = self.discount / gross_base * 100 if gross_base else None
        return {
            "sale": round(self.sale, 2),
            "gross": round(self.gross, 2),
            "freight": round(self.freight, 2),
            "discount": round(self.discount, 2),
            "discountRate": round(discount_rate, 4) if discount_rate is not None else None,
            "quantity": round(self.quantity, 3),
            "cost": round(self.cost, 2),
            "basePresent": round(self.base_present, 2),
            "profit": round(self.profit, 2),
            "profitPresent": round(self.profit_present, 2),
            "margin": round(margin, 4) if margin is not None else None,
            "transactions": tx,
            "skus": skus,
            "ticket": round(self.sale / tx, 2) if tx else None,
            "averagePrice": round(self.sale / self.quantity, 4) if self.quantity else None,
        }


def safe_change(current: float | None, previous: float | None) -> float | None:
    if current is None or previous in (None, 0):
        return None
    return round((current / previous - 1) * 100, 4)


def metric_delta(current: dict[str, Any], previous: dict[str, Any]) -> dict[str, Any]:
    margin_now = current.get("margin")
    margin_prev = previous.get("margin")
    return {
        "saleAbsolute": round(current["sale"] - previous["sale"], 2),
        "salePercent": safe_change(current["sale"], previous["sale"]),
        "marginPp": round(margin_now - margin_prev, 4)
        if margin_now is not None and margin_prev is not None
        else None,
        "profitPresentAbsolute": round(current["profitPresent"] - previous["profitPresent"], 2),
        "profitPresentPercent": safe_change(current["profitPresent"], previous["profitPresent"]),
        "quantityPercent": safe_change(current["quantity"], previous["quantity"]),
        "ticketPercent": safe_change(current.get("ticket"), previous.get("ticket")),
    }


def diagnosis(sale_change: float | None, margin_pp: float | None) -> str:
    if sale_change is None or margin_pp is None:
        return "Sem base comparativa"
    sale_state = 0 if -1 <= sale_change <= 1 else (1 if sale_change > 1 else -1)
    margin_state = 0 if -0.2 <= margin_pp <= 0.2 else (1 if margin_pp > 0.2 else -1)
    if sale_state == 0 and margin_state == 0:
        return "Estável"
    if sale_state >= 0 and margin_state > 0:
        return "Crescimento saudável"
    if sale_state > 0 and margin_state <= 0:
        return "Crescimento com perda de rentabilidade"
    if sale_state <= 0 and margin_state > 0:
        return "Margem melhor, mas perda de volume"
    return "Categoria crítica"


def priority(current: dict[str, Any], delta: dict[str, Any], share: float, recent_declines: int) -> str:
    loss = max(0.0, -float(delta.get("saleAbsolute") or 0))
    pct = max(0.0, -float(delta.get("salePercent") or 0))
    margin_loss = max(0.0, -float(delta.get("marginPp") or 0))
    score = min(35, pct * 1.4) + min(25, margin_loss * 5) + min(20, share * 0.8)
    score += min(15, recent_declines * 5) + min(5, loss / 100_000)
    if score >= 55:
        return "Crítica"
    if score >= 35:
        return "Alta"
    if score >= 18:
        return "Média"
    return "Baixa"


def week_bounds(any_date: date) -> tuple[date, date]:
    start = any_date - timedelta(days=any_date.weekday())
    return start, start + timedelta(days=5)


def last_closed_week(max_date: date) -> tuple[date, date]:
    days_from_saturday = (max_date.weekday() - 5) % 7
    end = max_date - timedelta(days=days_from_saturday)
    return end - timedelta(days=5), end


def fixed_period_bounds(closed_end: date) -> dict[str, dict[str, tuple[date, date]]]:
    previous_year = closed_end.year - 1
    return {
        "mtd": {
            "current": (closed_end.replace(day=1), closed_end),
            "previous": (
                closed_end.replace(year=previous_year, day=1),
                closed_end.replace(year=previous_year),
            ),
        },
        "mty": {
            "current": (closed_end.replace(month=1, day=1), closed_end),
            "previous": (
                closed_end.replace(year=previous_year, month=1, day=1),
                closed_end.replace(year=previous_year),
            ),
        },
    }


def period_metrics(
    events: Iterable[dict[str, Any]], start: date, end: date, predicate=lambda _: True
) -> Metrics:
    metrics = Metrics()
    for event in events:
        if start <= event["date"] <= end and predicate(event):
            metrics.add(event)
    return metrics


def importer(source: Path, output: Path, reference_products_path: Path | None = None) -> dict[str, Any]:
    events: list[dict[str, Any]] = []
    products: dict[str, dict[str, Any]] = {}
    descriptions: DefaultDict[str, set[str]] = defaultdict(set)
    categories: dict[str, str] = {}
    subcategories: dict[str, str] = {}
    groups: dict[str, str] = {}
    current_category = {"code": "", "name": "Sem categoria"}
    current_subcategory = {"code": "", "name": "Sem subcategoria"}
    current_group = {"code": "", "name": "Sem agrupamento"}
    current_product: dict[str, Any] | None = None
    state = "group"
    emitted_at: str | None = None
    ignored_rows = 0
    invalid_dates = 0
    movements_without_product = 0
    movement_rows = 0
    reference_products: dict[str, dict[str, Any]] = {}
    if reference_products_path and reference_products_path.exists():
        opener = gzip.open if reference_products_path.suffix == ".gz" else open
        with opener(reference_products_path, "rt", encoding="utf-8") as handle:
            reference_products = {str(item["adm"]): item for item in json.load(handle).get("products", [])}
    known_category_codes = {item.get("categoryCode", "") for item in reference_products.values() if item.get("categoryCode")}
    known_category_names = {item.get("category", "") for item in reference_products.values() if item.get("category")}

    with ZipFile(source) as archive, archive.open("content.xml") as stream:
        context = etree.iterparse(stream, events=("end",), tag=TABLE + "table-row", huge_tree=True)
        for _, element in context:
            row = extract_row(element)
            first = row[0].strip() if row else ""
            if not emitted_at and row:
                emitted_at = next((parse_emission(value) for value in row if parse_emission(value)), None)

            if first == "Produto" and len(row) > 4:
                state = "product"
            elif first == "Movimento" and len(row) > 4:
                if len(row) <= 19 or normalized_header(row[19]) != "%lucropres.":
                    raise RuntimeError("Coluna de margem dos movimentos não é %Lucro pres. na posição esperada.")
                state = "movement"
            # Linhas de agrupamento possuem o bloco completo de totais (26+ colunas).
            # ADMs antigos também podem ter apenas três dígitos; o tamanho evita que
            # esses produtos sejam confundidos com categorias de nível superior.
            elif GROUP_CODE.fullmatch(first) and len(row) >= 26:
                segments = first.split(".")
                label = row[1].strip()
                if len(segments) == 1:
                    if not reference_products or first in known_category_codes or label in known_category_names:
                        current_category = {"code": first, "name": label}
                        categories[first] = label
                    else:
                        current_category = {"code": "", "name": "Sem categoria"}
                elif len(segments) == 3:
                    current_subcategory = {"code": first, "name": label}
                    subcategories[first] = label
                elif len(segments) == 4:
                    current_group = {"code": first, "name": label}
                    groups[first] = label
                state = "group"
            elif state == "product" and PRODUCT_CODE.fullmatch(first) and len(row) >= 5:
                adm = first.lstrip("0") or "0"
                brand_raw = row[3].strip()
                brand = re.sub(r"^\d+\s*-\s*", "", brand_raw).strip() or "Sem marca"
                current_product = {
                    "adm": adm,
                    "description": row[1].strip(),
                    "ncm": row[2].strip(),
                    "brand": brand,
                    "brandRaw": brand_raw,
                    "originalCode": row[4].strip(),
                    "categoryCode": current_category["code"],
                    "category": current_category["name"],
                    "subcategoryCode": current_subcategory["code"],
                    "subcategory": current_subcategory["name"],
                    "groupCode": current_group["code"],
                    "group": current_group["name"],
                }
                reference = reference_products.get(adm)
                if reference:
                    for field_name in ("categoryCode", "category", "subcategoryCode", "subcategory", "groupCode", "group"):
                        current_product[field_name] = reference.get(field_name, current_product[field_name])
                    if current_product["categoryCode"]:
                        categories[current_product["categoryCode"]] = current_product["category"]
                descriptions[adm].add(current_product["description"])
                products.setdefault(adm, current_product.copy())
            elif state == "movement" and MOVEMENT_CODE.fullmatch(first) and len(row) >= 20:
                movement_rows += 1
                # Relatórios agrupados por vendedor listam todos os resumos de
                # produtos antes da tabela de movimentos. O ADM correto de cada
                # movimento está na coluna Produto (índice 3).
                movement_adm = row[3].replace(".", "").lstrip("0") or "0"
                movement_product = products.get(movement_adm) or reference_products.get(movement_adm)
                if movement_product is None:
                    movements_without_product += 1
                else:
                    products.setdefault(movement_adm, movement_product.copy())
                    descriptions[movement_adm].add(movement_product["description"])
                    movement_date = parse_date(row[1])
                    if movement_date is None:
                        invalid_dates += 1
                    else:
                        if not movement_product["categoryCode"]:
                            categories.setdefault("", "Sem categoria")
                        else:
                            categories[movement_product["categoryCode"]] = movement_product["category"]
                        total_item = br_number(row[8])
                        freight = br_number(row[9])
                        other = br_number(row[10])
                        interest = br_number(row[11])
                        tac = br_number(row[12])
                        discount = br_number(row[13])
                        credit = br_number(row[14])
                        sale = br_number(row[15])
                        reported_cost = br_number(row[16])
                        base_present = br_number(row[18])
                        margin_present = br_number(row[19])
                        profit_present = base_present * margin_present / 100
                        # Alguns relatórios Santri exportam um custo pontual com
                        # estouro de inteiro (próximo de 2^64). Nessa situação,
                        # recompomos o custo pela base e margem oficiais da linha.
                        cost_limit = max(abs(sale), abs(base_present), 1.0) * 50
                        cost = reported_cost if abs(reported_cost) <= cost_limit else base_present - profit_present
                        event = {
                            **movement_product,
                            "adm": movement_adm,
                            "movement": first.replace(".", ""),
                            "date": movement_date,
                            "quantity": br_number(row[6]),
                            "unitPrice": br_number(row[7]),
                            "gross": total_item + freight + other + interest + tac,
                            "freight": freight,
                            "discount": discount,
                            "credit": credit,
                            "sale": sale,
                            "cost": cost,
                            "base_present": base_present,
                            "profit": sale - cost,
                            "profit_present": profit_present,
                        }
                        events.append(event)
            elif any(row):
                ignored_rows += 1

            element.clear()
            parent = element.getparent()
            if parent is not None:
                while element.getprevious() is not None:
                    del parent[0]

    if not events:
        raise RuntimeError("Nenhum movimento válido foi encontrado no relatório.")

    min_date = min(event["date"] for event in events)
    max_date = max(event["date"] for event in events)
    closed_end = min(max_date, datetime.now(ZoneInfo("America/Sao_Paulo")).date() - timedelta(days=1))
    fixed_periods = fixed_period_bounds(closed_end)
    current_start, current_end = last_closed_week(max_date)
    previous_start = current_start - timedelta(days=7)
    previous_end = current_end - timedelta(days=7)

    current_all = period_metrics(events, current_start, current_end).json()
    previous_all = period_metrics(events, previous_start, previous_end).json()
    overall_delta = metric_delta(current_all, previous_all)

    category_rows: list[dict[str, Any]] = []
    total_current_sale = current_all["sale"] or 0
    for code, name in categories.items():
        predicate = lambda event, c=code: event["categoryCode"] == c
        current = period_metrics(events, current_start, current_end, predicate).json()
        previous = period_metrics(events, previous_start, previous_end, predicate).json()
        delta = metric_delta(current, previous)
        share = round(current["sale"] / total_current_sale * 100, 4) if total_current_sale else 0

        weekly_history = []
        declines = 0
        for offset in range(11, -1, -1):
            week_start = current_start - timedelta(days=7 * offset)
            week_end = week_start + timedelta(days=5)
            week = period_metrics(events, week_start, week_end, predicate).json()
            weekly_history.append({"start": week_start.isoformat(), "end": week_end.isoformat(), **week})
        for index in range(max(1, len(weekly_history) - 4), len(weekly_history)):
            before = weekly_history[index - 1]["sale"]
            now = weekly_history[index]["sale"]
            if before and now < before:
                declines += 1

        row = {
            "code": code,
            "name": name,
            "current": current,
            "previous": previous,
            "delta": delta,
            "share": share,
            "diagnosis": diagnosis(delta["salePercent"], delta["marginPp"]),
            "priority": priority(current, delta, share, declines),
            "weekly": weekly_history,
        }
        category_rows.append(row)
    category_rows.sort(key=lambda row: row["current"]["sale"], reverse=True)

    def entity_rows(key_name: str, label_name: str) -> list[dict[str, Any]]:
        keys = sorted({event[key_name] for event in events})
        rows = []
        for key in keys:
            predicate = lambda event, k=key: event[key_name] == k
            current = period_metrics(events, current_start, current_end, predicate).json()
            previous = period_metrics(events, previous_start, previous_end, predicate).json()
            total = period_metrics(events, min_date, max_date, predicate).json()
            if total["sale"] == 0 and total["quantity"] == 0:
                continue
            rows.append({label_name: key, "current": current, "previous": previous, "total": total,
                         "delta": metric_delta(current, previous)})
        rows.sort(key=lambda row: row["current"]["sale"], reverse=True)
        return rows

    brand_rows = entity_rows("brand", "name")

    product_agg: dict[str, Metrics] = defaultdict(Metrics)
    product_current: dict[str, Metrics] = defaultdict(Metrics)
    product_previous: dict[str, Metrics] = defaultdict(Metrics)
    product_weekly: dict[str, dict[str, Metrics]] = defaultdict(lambda: defaultdict(Metrics))
    product_daily: dict[str, dict[str, Metrics]] = defaultdict(lambda: defaultdict(Metrics))
    product_monthly: dict[str, dict[str, Metrics]] = defaultdict(lambda: defaultdict(Metrics))
    month_index = closed_end.year * 12 + closed_end.month - 1 - 11
    last_twelve_start = date(month_index // 12, month_index % 12 + 1, 1)
    current_month_start = closed_end.replace(day=1)
    product_fixed: dict[str, dict[str, dict[str, Metrics]]] = {
        code: {
            side: defaultdict(Metrics)
            for side in ("current", "previous")
        }
        for code in ("mtd", "mty")
    }
    for event in events:
        adm = event["adm"]
        product_agg[adm].add(event)
        if current_start <= event["date"] <= current_end:
            product_current[adm].add(event)
        if previous_start <= event["date"] <= previous_end:
            product_previous[adm].add(event)
        week_start, _ = week_bounds(event["date"])
        if current_start - timedelta(days=77) <= week_start <= current_start:
            product_weekly[adm][week_start.isoformat()].add(event)
        if current_month_start <= event["date"] <= closed_end:
            product_daily[adm][event["date"].isoformat()].add(event)
        if last_twelve_start <= event["date"] <= closed_end:
            product_monthly[adm][event["date"].strftime("%Y-%m")].add(event)
        for code, sides in fixed_periods.items():
            for side, (start, end) in sides.items():
                if start <= event["date"] <= end:
                    product_fixed[code][side][adm].add(event)

    product_rows = []
    for adm, master in products.items():
        total = product_agg[adm].json()
        current = product_current[adm].json()
        previous = product_previous[adm].json()
        periods = {}
        for code in ("mtd", "mty"):
            fixed_current = product_fixed[code]["current"][adm].json()
            fixed_previous = product_fixed[code]["previous"][adm].json()
            periods[code] = {
                "current": fixed_current,
                "previous": fixed_previous,
                "delta": metric_delta(fixed_current, fixed_previous),
            }
        weekly = []
        for offset in range(11, -1, -1):
            start = current_start - timedelta(days=offset * 7)
            week = product_weekly[adm][start.isoformat()].json()
            weekly.append({
                "start": start.isoformat(),
                "sale": week["sale"],
                "quantity": week["quantity"],
                "profitPresent": week["profitPresent"],
                "margin": week["margin"],
            })
        daily = []
        for day, metrics in sorted(product_daily[adm].items()):
            item = metrics.json()
            daily.append({
                "date": day,
                "sale": item["sale"],
                "quantity": item["quantity"],
                "basePresent": item["basePresent"],
                "profitPresent": item["profitPresent"],
                "transactions": item["transactions"],
            })
        monthly = []
        for month, metrics in sorted(product_monthly[adm].items()):
            item = metrics.json()
            monthly.append({
                "date": f"{month}-01",
                "sale": item["sale"],
                "quantity": item["quantity"],
                "basePresent": item["basePresent"],
                "profitPresent": item["profitPresent"],
                "transactions": item["transactions"],
            })
        product_rows.append({
            **master,
            "current": current,
            "previous": previous,
            "total": total,
            "delta": metric_delta(current, previous),
            "periods": periods,
            "weekly": weekly,
            "daily": daily,
            "monthly": monthly,
        })
    product_rows.sort(key=lambda row: row["current"]["sale"], reverse=True)

    weekly_overall = []
    for offset in range(51, -1, -1):
        start = current_start - timedelta(days=offset * 7)
        end = start + timedelta(days=5)
        weekly_overall.append({"start": start.isoformat(), "end": end.isoformat(),
                               **period_metrics(events, start, end).json()})

    months: dict[str, Metrics] = defaultdict(Metrics)
    for event in events:
        months[event["date"].strftime("%Y-%m")].add(event)
    monthly = [{"month": month, **metrics.json()} for month, metrics in sorted(months.items())]

    date_overall: dict[str, Metrics] = defaultdict(Metrics)
    date_category: dict[tuple[str, str], Metrics] = defaultdict(Metrics)
    date_brand: dict[tuple[str, str], Metrics] = defaultdict(Metrics)
    date_category_brand: dict[tuple[str, str, str], Metrics] = defaultdict(Metrics)
    for event in events:
        day = event["date"].isoformat()
        date_overall[day].add(event)
        date_category[(day, event["categoryCode"])].add(event)
        date_brand[(day, event["brand"])].add(event)
        date_category_brand[(day, event["categoryCode"], event["brand"])].add(event)

    daily = {
        "overall": [{"date": day, **metrics.json()} for day, metrics in sorted(date_overall.items())],
        "categories": [
            {"date": day, "categoryCode": category, **metrics.json()}
            for (day, category), metrics in sorted(date_category.items())
        ],
        "brands": [
            {"date": day, "brand": brand, **metrics.json()}
            for (day, brand), metrics in sorted(date_brand.items())
        ],
        "categoryBrands": [
            {"date": day, "categoryCode": category, "brand": brand, **metrics.json()}
            for (day, category, brand), metrics in sorted(date_category_brand.items())
        ],
    }

    divergent_descriptions = [
        {"adm": adm, "descriptions": sorted(names)}
        for adm, names in descriptions.items()
        if len(names) > 1
    ]
    missing_brand = sum(1 for product in products.values() if product["brand"] == "Sem marca")
    missing_category = sum(1 for product in products.values() if not product["categoryCode"])

    payload = {
        "meta": {
            "title": "TRADE PERFORMANCE · J. Cruzeiro",
            "source": source.name,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "emittedAt": emitted_at,
            "availableStart": min_date.isoformat(),
            "availableEnd": max_date.isoformat(),
            "recordsImported": len(events),
            "movementRows": movement_rows,
            "productCount": len(products),
            "transactionCount": len({event["movement"] for event in events}),
            "categoryCount": len(categories),
            "brandCount": len({event["brand"] for event in events}),
            "comparison": {
                "currentStart": current_start.isoformat(),
                "currentEnd": current_end.isoformat(),
                "previousStart": previous_start.isoformat(),
                "previousEnd": previous_end.isoformat(),
                "label": "Última semana fechada × semana anterior",
            },
            "marginBasis": "Lucro presente = Base lucro pres. × %Lucro pres. da linha; margem consolidada = Σ lucro presente ÷ Σ Base lucro pres.",
            "dataCapabilities": {
                "stores": False,
                "sellers": False,
                "targets": False,
                "stock": False,
                "tradeSnapshot": False,
                "reason": "O ODS anexado não contém loja, vendedor, meta, estoque ou snapshot estruturado da reunião.",
            },
        },
        "overall": {"current": current_all, "previous": previous_all, "delta": overall_delta},
        "categories": category_rows,
        "brands": brand_rows,
        "topProducts": product_rows[:100],
        "weekly": weekly_overall,
        "monthly": monthly,
        "daily": daily,
        "quality": {
            "invalidDates": invalid_dates,
            "movementsWithoutProduct": movements_without_product,
            "ignoredRows": ignored_rows,
            "missingBrandProducts": missing_brand,
            "missingCategoryProducts": missing_category,
            "divergentDescriptions": divergent_descriptions[:200],
            "duplicateAdmCount": len(divergent_descriptions),
            "notes": [
                "Apresentação - Reunião Trade.pptx não foi anexada nesta execução.",
                "TOP 10 SKU.xlsx não foi anexado nesta execução.",
                "Loja e vendedor não existem nas colunas de movimento do ODS recebido.",
                "As páginas sem base oficial exibem Dados insuficientes; nenhuma meta foi simulada.",
            ],
        },
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    products_output = output.with_name("products.json.gz")
    with gzip.open(output, "wt", encoding="utf-8", compresslevel=9) as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
    with gzip.open(products_output, "wt", encoding="utf-8", compresslevel=9) as handle:
        json.dump(
            {
                "generatedAt": payload["meta"]["generatedAt"],
                "comparison": payload["meta"]["comparison"],
                "products": product_rows,
            },
            handle,
            ensure_ascii=False,
            separators=(",", ":"),
        )
    return payload


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Uso: python3 scripts/import_sales_data.py /caminho/relatorio.ods [saida.json]")
    source = Path(sys.argv[1]).expanduser().resolve()
    if not source.exists():
        raise SystemExit(f"Arquivo não encontrado: {source}")
    output = (
        Path(sys.argv[2]).expanduser().resolve()
        if len(sys.argv) > 2
        else Path(__file__).resolve().parents[1] / "public" / "data" / "dashboard.json.gz"
    )
    reference = Path(sys.argv[3]).expanduser().resolve() if len(sys.argv) > 3 else None
    payload = importer(source, output, reference)
    summary = {
        "output": str(output),
        "records": payload["meta"]["recordsImported"],
        "period": [payload["meta"]["availableStart"], payload["meta"]["availableEnd"]],
        "comparison": payload["meta"]["comparison"],
        "saleCurrent": payload["overall"]["current"]["sale"],
        "salePrevious": payload["overall"]["previous"]["sale"],
        "marginCurrent": payload["overall"]["current"]["margin"],
        "marginPrevious": payload["overall"]["previous"]["margin"],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
