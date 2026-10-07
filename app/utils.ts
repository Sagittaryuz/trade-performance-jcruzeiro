import type { Category, Comparison, DashboardData, Delta, Fact, Filters, FixedComparisons, Metrics } from "./types";

const SYSTEM_CATEGORY_EXCLUSIONS = new Set(["CONSUMO", "DECORACAO", "DECORACOES", "PRODUTOS INATIVOS", "SEM CATEGORIA"]);

function normalizedCategoryName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
}

export function isDetailedCategory(name: string) {
  return !SYSTEM_CATEGORY_EXCLUSIONS.has(normalizedCategoryName(name));
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const brlFull = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
});
const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

export const formatCurrency = (value: number, full = false) =>
  (full ? brlFull : brl).format(Number.isFinite(value) ? value : 0);
export const formatNumber = (value: number) => number.format(Number.isFinite(value) ? value : 0);
export const formatPercent = (value: number | null, decimals = 1) =>
  value == null || !Number.isFinite(value) ? "Sem base" : `${value.toFixed(decimals).replace(".", ",")}%`;
export const formatPp = (value: number | null) =>
  value == null || !Number.isFinite(value) ? "Sem base" : `${value > 0 ? "+" : ""}${value.toFixed(2).replace(".", ",")} p.p.`;
export const formatDate = (value: string) => {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
};
export const formatMonth = (value: string) => {
  const [year, month] = value.split("-");
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" })
    .format(new Date(`${year}-${month}-01T12:00:00Z`))
    .replace(" de ", "/");
};
export const signed = (value: number | null, suffix = "%") =>
  value == null ? "Sem base" : `${value > 0 ? "+" : ""}${value.toFixed(1).replace(".", ",")}${suffix}`;

export const emptyMetrics = (): Metrics => ({
  sale: 0,
  gross: 0,
  freight: 0,
  discount: 0,
  discountRate: null,
  quantity: 0,
  cost: 0,
  basePresent: 0,
  profit: 0,
  profitPresent: 0,
  margin: null,
  transactions: 0,
  skus: 0,
  ticket: null,
  averagePrice: null,
});

export function aggregateFacts(facts: Fact[], start: string, end: string): Metrics {
  const result = emptyMetrics();
  for (const fact of facts) {
    if (fact.date < start || fact.date > end) continue;
    result.sale += fact.sale;
    result.gross += fact.gross;
    result.freight += fact.freight;
    result.discount += fact.discount;
    result.quantity += fact.quantity;
    result.cost += fact.cost;
    result.basePresent += fact.basePresent;
    result.profit += fact.profit;
    result.profitPresent += fact.profitPresent;
    result.transactions += fact.transactions;
  }
  result.margin = result.basePresent ? (result.profitPresent / result.basePresent) * 100 : null;
  result.discountRate = result.gross ? (result.discount / result.gross) * 100 : null;
  result.ticket = result.transactions ? result.sale / result.transactions : null;
  result.averagePrice = result.quantity ? result.sale / result.quantity : null;
  return result;
}

export const calcDelta = (current: Metrics, previous: Metrics): Delta => {
  const change = (a: number | null, b: number | null) =>
    a == null || b == null || b === 0 ? null : (a / b - 1) * 100;
  return {
    saleAbsolute: current.sale - previous.sale,
    salePercent: change(current.sale, previous.sale),
    marginPp: current.margin == null || previous.margin == null ? null : current.margin - previous.margin,
    profitPresentAbsolute: current.profitPresent - previous.profitPresent,
    profitPresentPercent: change(current.profitPresent, previous.profitPresent),
    quantityPercent: change(current.quantity, previous.quantity),
    ticketPercent: change(current.ticket, previous.ticket),
  };
};

export function addDays(value: string, days: number) {
  const target = new Date(`${value}T12:00:00Z`);
  target.setUTCDate(target.getUTCDate() + days);
  return target.toISOString().slice(0, 10);
}

export function fixedComparisons(maxDate: string): FixedComparisons {
  const year = Number(maxDate.slice(0, 4));
  const month = maxDate.slice(5, 7);
  const monthDay = maxDate.slice(5);
  const previousYear = year - 1;
  return {
    mtd: {
      currentStart: `${year}-${month}-01`,
      currentEnd: maxDate,
      previousStart: `${previousYear}-${month}-01`,
      previousEnd: `${previousYear}-${monthDay}`,
      label: "MTD · mês até o último fechamento × mesmo período do ano anterior",
    },
    mty: {
      currentStart: `${year}-01-01`,
      currentEnd: maxDate,
      previousStart: `${previousYear}-01-01`,
      previousEnd: `${previousYear}-${monthDay}`,
      label: "YTD · janeiro até o último fechamento × mesmo período do ano anterior",
    },
  };
}

export function diagnosis(sale: number | null, margin: number | null) {
  if (sale == null || margin == null) return "Sem base comparativa";
  const saleState = sale >= -1 && sale <= 1 ? 0 : sale > 1 ? 1 : -1;
  const marginState = margin >= -0.2 && margin <= 0.2 ? 0 : margin > 0.2 ? 1 : -1;
  if (saleState === 0 && marginState === 0) return "Estável";
  if (saleState >= 0 && marginState > 0) return "Crescimento saudável";
  if (saleState > 0 && marginState <= 0) return "Crescimento com perda de rentabilidade";
  if (saleState <= 0 && marginState > 0) return "Margem melhor, mas perda de volume";
  return "Categoria crítica";
}

export function factsForFilters(data: DashboardData, filters: Filters) {
  if (filters.category && filters.brand) {
    return data.daily.categoryBrands.filter((fact) => fact.categoryCode === filters.category && fact.brand === filters.brand);
  }
  if (filters.category) return data.daily.categories.filter((fact) => fact.categoryCode === filters.category);
  if (filters.brand) return data.daily.brands.filter((fact) => fact.brand === filters.brand);
  return data.daily.overall;
}

export function deriveOverall(data: DashboardData, filters: Filters, comparison: Comparison) {
  const noDimension = !filters.category && !filters.brand && !filters.product;
  const isDefault = comparison.currentStart === data.meta.comparison.currentStart
    && comparison.currentEnd === data.meta.comparison.currentEnd
    && comparison.previousStart === data.meta.comparison.previousStart
    && comparison.previousEnd === data.meta.comparison.previousEnd;
  if (noDimension && isDefault) return data.overall;
  const facts = factsForFilters(data, filters);
  const current = aggregateFacts(facts, comparison.currentStart, comparison.currentEnd);
  const previous = aggregateFacts(facts, comparison.previousStart, comparison.previousEnd);
  return { current, previous, delta: calcDelta(current, previous) };
}

export function deriveCategories(data: DashboardData, filters: Filters, comparison: Comparison): Category[] {
  const detailedCategories = data.categories.filter((category) => isDetailedCategory(category.name));
  const names = new Map(detailedCategories.map((category) => [category.code, category]));
  const codes = filters.category ? [filters.category].filter((code) => names.has(code)) : detailedCategories.map((category) => category.code);
  const isDefault = comparison.currentStart === data.meta.comparison.currentStart
    && comparison.currentEnd === data.meta.comparison.currentEnd
    && comparison.previousStart === data.meta.comparison.previousStart
    && comparison.previousEnd === data.meta.comparison.previousEnd;
  if (isDefault && !filters.brand) {
    const exactRows = codes.map((code) => names.get(code)!).filter(Boolean);
    const total = exactRows.reduce((sum, row) => sum + row.current.sale, 0);
    return exactRows
      .map((row) => ({ ...row, share: total ? (row.current.sale / total) * 100 : 0 }))
      .sort((a, b) => b.current.sale - a.current.sale);
  }
  const rows = codes.map((code) => {
    const source = names.get(code)!;
    const facts = filters.brand
      ? data.daily.categoryBrands.filter((fact) => fact.categoryCode === code && fact.brand === filters.brand)
      : data.daily.categories.filter((fact) => fact.categoryCode === code);
    const current = aggregateFacts(facts, comparison.currentStart, comparison.currentEnd);
    const previous = aggregateFacts(facts, comparison.previousStart, comparison.previousEnd);
    const delta = calcDelta(current, previous);
    return { ...source, current, previous, delta, diagnosis: diagnosis(delta.salePercent, delta.marginPp) };
  });
  const total = rows.reduce((sum, row) => sum + row.current.sale, 0);
  return rows
    .map((row) => ({ ...row, share: total ? (row.current.sale / total) * 100 : 0 }))
    .sort((a, b) => b.current.sale - a.current.sale);
}

export function downloadCsv(filename: string, rows: Array<Record<string, string | number | null>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = `\uFEFF${headers.map(escape).join(";")}\n${rows.map((row) => headers.map((key) => escape(row[key])).join(";")).join("\n")}`;
  const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}
