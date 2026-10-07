import type { BrandMovementData, DashboardData, Metrics, ProductData, SellerData } from "./types";
import type { OdsImportResult, OfficialClosing } from "./ods-import";

const additive = ["sale", "gross", "freight", "discount", "quantity", "cost", "basePresent", "profit", "profitPresent", "transactions"] as const;
const rounded = (value: number, places = 2) => Number((Number.isFinite(value) ? value : 0).toFixed(places));
const calculate = (source: Partial<Metrics> = {}): Metrics => {
  const value = Object.fromEntries(additive.map((key) => [key, rounded(Number(source[key] ?? 0), key === "quantity" ? 3 : 2)])) as unknown as Metrics;
  const grossBase = value.gross || value.sale + value.discount;
  value.discountRate = grossBase ? rounded(value.discount / grossBase * 100, 4) : null;
  value.margin = value.basePresent ? rounded(value.profitPresent / value.basePresent * 100, 4) : null;
  value.ticket = value.transactions ? rounded(value.sale / value.transactions) : null;
  value.averagePrice = value.quantity ? rounded(value.sale / value.quantity, 4) : null;
  value.skus = Number(source.skus ?? 0);
  return value;
};
const combine = (left: Partial<Metrics> | undefined, right: Partial<Metrics> | undefined, sign = 1) => calculate(Object.fromEntries(additive.map((key) => [key, Number(left?.[key] ?? 0) + sign * Number(right?.[key] ?? 0)])));
const sum = (rows: Array<Partial<Metrics>>): Metrics => rows.reduce<Metrics>((total, row) => combine(total, row), calculate());
const percentage = (current: number | null, previous: number | null) => current == null || previous == null || previous === 0 ? null : rounded((current / previous - 1) * 100, 4);
const delta = (current: Metrics, previous: Metrics) => ({ saleAbsolute: rounded(current.sale - previous.sale), salePercent: percentage(current.sale, previous.sale), marginPp: current.margin == null || previous.margin == null ? null : rounded(current.margin - previous.margin, 4), profitPresentAbsolute: rounded(current.profitPresent - previous.profitPresent), profitPresentPercent: percentage(current.profitPresent, previous.profitPresent), quantityPercent: percentage(current.quantity, previous.quantity), ticketPercent: percentage(current.ticket, previous.ticket) });
const zero = () => calculate();
const measured = ["sale", "quantity", "basePresent", "profitPresent"] as const;
const assertClose = (label: string, expected: Partial<Metrics>, actual: Partial<Metrics>) => {
  for (const key of measured) {
    // Daily/entity facts are stored at cent precision, so summing hundreds of
    // independently rounded profit/base rows can legitimately accumulate a
    // few cents even when the unrounded source is identical.
    const tolerance = key === "quantity" ? 0.001 : key === "sale" ? 0.05 : 1;
    const gap = rounded(Number(actual[key] ?? 0) - Number(expected[key] ?? 0), key === "quantity" ? 3 : 2);
    if (Math.abs(gap) > tolerance) throw new Error(`A atualização foi bloqueada: ${label} diverge do consolidado em ${key} (${gap}).`);
  }
};
const renameStore = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map(renameStore) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renameStore(item)])) as T;
  return (value === "R. Haro" ? "Rharo" : value) as T;
};

function mergeOfficialMtdImport(existing: { dashboard: DashboardData; products: ProductData; sellers: SellerData; brands: BrandMovementData }, incoming: OdsImportResult, closing: OfficialClosing, targetSide: "current" | "previous") {
  const dashboard = structuredClone(existing.dashboard);
  const products = structuredClone(existing.products);
  const sellers = renameStore(structuredClone(existing.sellers));
  const brands = renameStore(structuredClone(existing.brands));
  const start = closing.start, end = closing.end, month = start.slice(0, 7);
  const inPeriod = (date: string) => date >= start && date <= end;
  const overlay = <T>(oldRows: T[], newRows: T[], date: (row: T) => string) => [...oldRows.filter((row) => !inPeriod(date(row))), ...newRows.filter((row) => inPeriod(date(row)))];

  for (const key of ["overall", "categories", "brands", "categoryBrands"] as const) dashboard.daily[key] = overlay(dashboard.daily[key], incoming.dashboard.daily[key], (row) => row.date) as never;
  const monthGroups = new Map<string, Array<Partial<Metrics>>>();
  for (const row of dashboard.daily.overall) { const key = row.date.slice(0, 7); const rows = monthGroups.get(key) ?? []; rows.push(row); monthGroups.set(key, rows); }
  dashboard.monthly = [...monthGroups].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => ({ month: key, ...sum(rows) }));
  dashboard.meta.availableEnd = end > dashboard.meta.availableEnd ? end : dashboard.meta.availableEnd;
  dashboard.meta.generatedAt = new Date().toISOString(); dashboard.meta.emittedAt = dashboard.meta.generatedAt;
  dashboard.quality.notes = [...new Set([...dashboard.quality.notes, "O MTD vigente é substituído pelo intervalo oficial da ODS; o histórico anterior permanece preservado."])];

  const byAdm = new Map(products.products.map((product) => [product.adm, product]));
  const incomingByAdm = new Map(incoming.products.products.map((product) => [product.adm, product]));
  for (const latest of incoming.products.products) if (!byAdm.has(latest.adm)) byAdm.set(latest.adm, structuredClone(latest));
  // The incoming ODS is authoritative for the complete interval. Iterating the
  // union is essential: an ADM absent from the new report must become zero,
  // otherwise a sale from the prior upload survives as a ghost value.
  for (const current of byAdm.values()) {
    const latest = incomingByAdm.get(current.adm);
    const oldMtd = current.periods.mtd[targetSide];
    const newMtd = latest?.periods.mtd.current ?? zero();
    current.periods.mtd[targetSide] = newMtd;
    current.periods.mtd.delta = delta(current.periods.mtd.current, current.periods.mtd.previous);
    current.periods.mty[targetSide] = combine(combine(current.periods.mty[targetSide], oldMtd, -1), newMtd);
    current.periods.mty.delta = delta(current.periods.mty.current, current.periods.mty.previous);
    current.total = combine(combine(current.total, oldMtd, -1), newMtd);
    current.daily = targetSide === "current" ? (latest?.daily ?? []) : current.daily;
    current.monthly = [...(current.monthly ?? []).filter((row) => row.date.slice(0, 7) !== month), ...(latest?.monthly ?? []).filter((row) => row.date.slice(0, 7) === month)].sort((a, b) => a.date.localeCompare(b.date));
  }
  products.products = [...byAdm.values()]; products.generatedAt = dashboard.meta.generatedAt;
  dashboard.meta.productCount = products.products.length;

  if (!incoming.sellers || !incoming.brandMovements) throw new Error("A ODS detalhada não trouxe lojas, vendedores e marcas suficientes para atualizar o MTD.");
  sellers.storeDaily = overlay(sellers.storeDaily, renameStore(incoming.sellers.storeDaily), (row) => row.date);
  sellers.sellerDaily = overlay(sellers.sellerDaily, renameStore(incoming.sellers.sellerDaily), (row) => row.date);
  const sellerGroups = new Map<string, typeof sellers.sellerDaily>();
  for (const row of sellers.sellerDaily) { const key = `${row.store}|${row.code}|${row.name}`; const rows = sellerGroups.get(key) ?? []; rows.push(row); sellerGroups.set(key, rows); }
  const priorSellers = new Map(sellers.sellers.map((row) => [`${row.store}|${row.code}|${row.name}`, row]));
  sellers.sellers = [...sellerGroups].map(([key, rows]) => { const [store, code, name] = key.split("|"); const value = sum(rows); return { ...(priorSellers.get(key) ?? {}), store, code, name, sale: value.sale, basePresent: value.basePresent, profitPresent: value.profitPresent, margin: value.margin } as typeof sellers.sellers[number]; }).sort((a, b) => b.sale - a.sale);
  const storeGroups = new Map<string, typeof sellers.storeDaily>();
  for (const row of sellers.storeDaily) { const rows = storeGroups.get(row.store) ?? []; rows.push(row); storeGroups.set(row.store, rows); }
  const priorStores = new Map(sellers.stores.map((row) => [row.name, row]));
  sellers.stores = [...storeGroups].map(([name, rows]) => { const value = sum(rows); const prior = priorStores.get(name); return { ...prior!, name, sellerCount: sellers.sellers.filter((seller) => seller.store === name).length, sale: value.sale, detailSale: value.sale, basePresent: value.basePresent, profitPresent: value.profitPresent, margin: value.margin, reconciliationGap: 0 }; });
  const networkSale = sellers.stores.reduce((total, store) => total + store.sale, 0); sellers.stores.forEach((store) => { store.share = networkSale ? store.sale / networkSale * 100 : 0; });
  sellers.meta.availableEnd = dashboard.meta.availableEnd;

  brands.brandMonthly = [...brands.brandMonthly.filter((row) => row.month !== month), ...renameStore(incoming.brandMovements.brandMonthly.filter((row) => row.month === month))];
  brands.productMonthly = [...brands.productMonthly.filter((row) => row.month !== month), ...renameStore(incoming.brandMovements.productMonthly.filter((row) => row.month === month))];
  const replaceSide = <T extends { period: string; side: string }>(oldRows: T[], newRows: T[], key: (row: T) => string) => {
    const remap = (row: T) => ({ ...row, side: targetSide }) as T;
    const incomingMtd = newRows.filter((row) => row.period === "mtd" && row.side === "current").map(remap);
    const result = new Map(oldRows.filter((row) => !(row.period === "mtd" && row.side === targetSide)).map((row) => [key(row), row]));
    const oldMtd = new Map(oldRows.filter((row) => row.period === "mtd" && row.side === targetSide).map((row) => [key(row).replace(`|mtd|${targetSide}`, ""), row]));
    const newMtd = new Map(incomingMtd.map((row) => [key(row).replace(`|mtd|${targetSide}`, ""), row]));
    for (const row of incomingMtd) result.set(key(row), row);
    for (const entity of new Set([...oldMtd.keys(), ...newMtd.keys()])) {
      const ytdKey = `${entity}|mty|${targetSide}`;
      const oldYtd = result.get(ytdKey);
      if (!oldYtd) continue;
      result.set(ytdKey, { ...oldYtd, ...combine(combine(oldYtd, oldMtd.get(entity), -1), newMtd.get(entity)) });
    }
    return [...result.values()];
  };
  brands.brandPeriods = replaceSide(brands.brandPeriods ?? [], renameStore(incoming.brandMovements.brandPeriods ?? []), (row) => `${row.store}|${row.brand}|${row.period}|${row.side}`);
  brands.productPeriods = replaceSide(brands.productPeriods ?? [], renameStore(incoming.brandMovements.productPeriods ?? []), (row) => `${row.store}|${row.brand}|${row.adm}|${row.period}|${row.side}`);
  brands.meta.availableEnd = dashboard.meta.availableEnd;

  const official = sum(dashboard.daily.overall.filter((row) => inPeriod(row.date)));
  assertClose("categorias", official, sum(dashboard.daily.categories.filter((row) => inPeriod(row.date))));
  assertClose("marcas", official, sum(dashboard.daily.brands.filter((row) => inPeriod(row.date))));
  assertClose("produtos", official, sum(products.products.map((product) => product.periods.mtd[targetSide])));
  assertClose("lojas", official, sum(sellers.storeDaily.filter((row) => inPeriod(row.date))));
  assertClose("marcas por loja", official, sum((brands.brandPeriods ?? []).filter((row) => row.period === "mtd" && row.side === targetSide && row.brand !== "__ALL__")));
  assertClose("produtos por loja", official, sum((brands.productPeriods ?? []).filter((row) => row.period === "mtd" && row.side === targetSide)));
  return { dashboard: renameStore(dashboard), products: renameStore(products), sellers, brands };
}

export function mergeCurrentMtdImport(existing: { dashboard: DashboardData; products: ProductData; sellers: SellerData; brands: BrandMovementData }, incoming: OdsImportResult, closing: OfficialClosing) {
  return mergeOfficialMtdImport(existing, incoming, closing, "current");
}

/** Used to repair an official prior-year MTD without rebuilding unrelated history. */
export function mergePreviousMtdImport(existing: { dashboard: DashboardData; products: ProductData; sellers: SellerData; brands: BrandMovementData }, incoming: OdsImportResult, closing: OfficialClosing) {
  return mergeOfficialMtdImport(existing, incoming, closing, "previous");
}

type DailyMetric = Partial<Metrics> & { date: string };
const isoDate = (value: Date) => value.toISOString().slice(0, 10);
const periodRanges = (end: string) => {
  const year = Number(end.slice(0, 4)), previousYear = year - 1, monthDay = end.slice(5), month = end.slice(5, 7);
  return {
    mtd: { currentStart: `${year}-${month}-01`, currentEnd: end, previousStart: `${previousYear}-${month}-01`, previousEnd: `${previousYear}-${monthDay}` },
    mty: { currentStart: `${year}-01-01`, currentEnd: end, previousStart: `${previousYear}-01-01`, previousEnd: `${previousYear}-${monthDay}` },
  };
};
const sumDated = <T extends DailyMetric>(rows: T[], start: string, end: string) => sum(rows.filter((row) => row.date >= start && row.date <= end));
const overlayByKey = <T>(oldRows: T[], newRows: T[], key: (row: T) => string) => {
  const result = new Map(oldRows.map((row) => [key(row), row]));
  newRows.forEach((row) => result.set(key(row), row));
  return [...result.values()];
};
const groupMetrics = <T>(rows: T[], key: (row: T) => string, value: (row: T) => Partial<Metrics>) => {
  const groups = new Map<string, Array<Partial<Metrics>>>();
  rows.forEach((row) => { const name = key(row); const values = groups.get(name) ?? []; values.push(value(row)); groups.set(name, values); });
  return new Map([...groups].map(([name, values]) => [name, sum(values)]));
};
const groupRows = <T>(rows: T[], key: (row: T) => string) => {
  const groups = new Map<string, T[]>();
  rows.forEach((row) => { const name = key(row); const values = groups.get(name) ?? []; values.push(row); groups.set(name, values); });
  return groups;
};

/**
 * Advances the consolidated base with a daily or accumulated range. The ODS
 * remains authoritative inside its declared interval; all earlier facts stay
 * stored and the period summaries are rebuilt from those persisted facts.
 */
export function mergeIncrementalImport(
  existing: { dashboard: DashboardData; products: ProductData; sellers: SellerData; brands: BrandMovementData },
  incoming: OdsImportResult,
  closing: OfficialClosing,
  acceptedClosedDates: string[] = [],
) {
  if (!incoming.sellers || !incoming.brandMovements) throw new Error("A ODS diária não trouxe lojas, vendedores, marcas e produtos suficientes.");
  const dashboard = renameStore(structuredClone(existing.dashboard));
  const products = renameStore(structuredClone(existing.products));
  const sellers = renameStore(structuredClone(existing.sellers));
  const brands = renameStore(structuredClone(existing.brands));
  const incomingSellers = renameStore(incoming.sellers);
  const incomingBrands = renameStore(incoming.brandMovements);
  const end = closing.end;
  const ranges = periodRanges(end);

  dashboard.daily.overall = overlayByKey(dashboard.daily.overall, incoming.dashboard.daily.overall, (row) => row.date).sort((a, b) => a.date.localeCompare(b.date));
  dashboard.daily.categories = overlayByKey(dashboard.daily.categories, incoming.dashboard.daily.categories, (row) => `${row.categoryCode}|${row.date}`);
  const overallMonths = groupMetrics(dashboard.daily.overall, (row) => row.date.slice(0, 7), (row) => row);
  dashboard.monthly = [...overallMonths].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({ month, ...value }));
  dashboard.meta.availableEnd = end;
  dashboard.meta.generatedAt = new Date().toISOString();
  dashboard.meta.emittedAt = dashboard.meta.generatedAt;
  dashboard.meta.source = incoming.metadata.fileName;
  dashboard.meta.recordsImported += incoming.metadata.recordsImported;
  dashboard.meta.movementRows += incoming.dashboard.meta.movementRows;
  dashboard.quality.notes = [...new Set([
    ...dashboard.quality.notes,
    "A base histórica permanece consolidada; cada ODS diária substitui apenas os dias declarados no relatório.",
    ...(acceptedClosedDates.length ? [`Exceção operacional aceita para ${acceptedClosedDates.join(", ")}: feriado ou unidade sem expediente.`] : []),
  ])];

  const mergedProductDaily = overlayByKey(brands.productDaily ?? [], incomingBrands.productDaily ?? [], (row) => `${row.store}|${row.brand}|${row.adm}|${row.date}`);
  const networkProductFacts = groupMetrics(mergedProductDaily, (row) => `${row.adm}|${row.date}`, (row) => row);
  const networkProductRows = groupRows([...networkProductFacts].map(([key, value]) => { const split = key.lastIndexOf("|"); return { adm: key.slice(0, split), date: key.slice(split + 1), ...value }; }), (row) => row.adm);

  const incomingProducts = new Map(incoming.products.products.map((product) => [product.adm, product]));
  const allProducts = new Map(products.products.map((product) => [product.adm, product]));
  incoming.products.products.forEach((product) => { if (!allProducts.has(product.adm)) allProducts.set(product.adm, structuredClone(product)); });
  const networkBrandFacts = groupMetrics(mergedProductDaily, (row) => `${row.brand}|${row.date}`, (row) => row);
  dashboard.daily.brands = [...networkBrandFacts].map(([key, value]) => { const split = key.lastIndexOf("|"); return { brand: key.slice(0, split), date: key.slice(split + 1), ...value }; });
  const categoryBrandFacts = groupMetrics(mergedProductDaily, (row) => `${allProducts.get(row.adm)?.categoryCode ?? ""}|${row.brand}|${row.date}`, (row) => row);
  dashboard.daily.categoryBrands = [...categoryBrandFacts].map(([key, value]) => { const first = key.indexOf("|"), last = key.lastIndexOf("|"); return { categoryCode: key.slice(0, first), brand: key.slice(first + 1, last), date: key.slice(last + 1), ...value }; });
  for (const product of allProducts.values()) {
    const latest = incomingProducts.get(product.adm);
    const facts = networkProductRows.get(product.adm) ?? [];
    product.daily = facts.filter((row) => row.date >= `${end.slice(0, 7)}-01` && row.date <= end).map((row) => ({ date: row.date, sale: row.sale, quantity: row.quantity, basePresent: row.basePresent, profitPresent: row.profitPresent, transactions: row.transactions }));
    const monthGroups = groupMetrics(facts, (row) => row.date.slice(0, 7), (row) => row);
    product.monthly = [...monthGroups].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({ date: `${month}-01`, sale: value.sale, quantity: value.quantity, basePresent: value.basePresent, profitPresent: value.profitPresent, transactions: value.transactions }));
    for (const [period, range] of Object.entries(ranges) as Array<["mtd" | "mty", typeof ranges.mtd]>) {
      const current = sumDated(facts, range.currentStart, range.currentEnd);
      const previous = sumDated(facts, range.previousStart, range.previousEnd);
      product.periods[period] = { current, previous, delta: delta(current, previous) };
    }
    product.current = product.periods.mtd.current;
    product.previous = product.periods.mtd.previous;
    product.delta = product.periods.mtd.delta;
    product.total = sum(facts);
  }
  products.products = [...allProducts.values()].sort((a, b) => b.periods.mtd.current.sale - a.periods.mtd.current.sale);
  products.generatedAt = dashboard.meta.generatedAt;
  products.comparison = { ...products.comparison, currentEnd: end, previousEnd: `${Number(end.slice(0, 4)) - 1}-${end.slice(5)}` };
  dashboard.topProducts = products.products.slice(0, 100);
  dashboard.meta.productCount = products.products.length;

  sellers.storeDaily = overlayByKey(sellers.storeDaily, incomingSellers.storeDaily, (row) => `${row.store}|${row.date}`);
  sellers.sellerDaily = overlayByKey(sellers.sellerDaily ?? [], incomingSellers.sellerDaily ?? [], (row) => `${row.store}|${row.code}|${row.name}|${row.date}`);
  const sellerTotals = groupMetrics(sellers.sellerDaily ?? [], (row) => `${row.store}|${row.code}|${row.name}`, (row) => row);
  sellers.sellers = [...sellerTotals].map(([key, value]) => { const [store, code, name] = key.split("|"); return { store, code, name, sale: value.sale, cost: value.cost, profitPresent: value.profitPresent, basePresent: value.basePresent, margin: value.margin }; }).sort((a, b) => b.sale - a.sale);
  const storeTotals = groupMetrics(sellers.storeDaily, (row) => row.store, (row) => row);
  const priorStores = new Map(sellers.stores.map((store) => [store.name, store]));
  sellers.stores = [...storeTotals].map(([name, value]) => ({ ...(priorStores.get(name) ?? { topProducts: [] }), name, sellerCount: sellers.sellers.filter((seller) => seller.store === name).length, sale: value.sale, detailSale: value.sale, basePresent: value.basePresent, profitPresent: value.profitPresent, margin: value.margin, reconciliationGap: 0, share: 0 }));
  const networkSale = sellers.stores.reduce((total, store) => total + store.sale, 0);
  sellers.stores.forEach((store) => { store.share = networkSale ? store.sale / networkSale * 100 : 0; });
  sellers.meta.availableEnd = end;
  sellers.meta.source = incoming.metadata.fileName;

  brands.productDaily = mergedProductDaily;
  brands.brandDaily = undefined;
  const brandDailyFacts = [...groupMetrics(brands.productDaily, (row) => `${row.store}|${row.brand}|${row.date}`, (row) => row)].map(([key, value]) => { const first = key.indexOf("|"), last = key.lastIndexOf("|"); return { store: key.slice(0, first), brand: key.slice(first + 1, last), date: key.slice(last + 1), ...value }; });
  const brandMonthGroups = groupMetrics(brandDailyFacts, (row) => `${row.store}|${row.date.slice(0, 7)}|${row.brand}`, (row) => row);
  brands.brandMonthly = [...brandMonthGroups].map(([key, value]) => { const first = key.indexOf("|"), second = key.indexOf("|", first + 1); return { store: key.slice(0, first), month: key.slice(first + 1, second), brand: key.slice(second + 1), ...value }; });
  const descriptionByAdm = new Map([...allProducts].map(([adm, product]) => [adm, product.description]));
  const productMonthGroups = groupMetrics(brands.productDaily, (row) => `${row.store}|${row.date.slice(0, 7)}|${row.brand}|${row.adm}`, (row) => row);
  brands.productMonthly = [...productMonthGroups].map(([key, value]) => { const parts = key.split("|"); return { store: parts[0], month: parts[1], brand: parts[2], adm: parts[3], description: descriptionByAdm.get(parts[3]) ?? "Produto não identificado", ...value }; });
  const brandEntities = groupRows(brandDailyFacts, (row) => `${row.store}|${row.brand}`);
  brands.brandPeriods = (["mtd", "mty"] as const).flatMap((period) => [...brandEntities].flatMap(([key, rows]) => { const [store, brand] = key.split("|"); const range = ranges[period]; return (["current", "previous"] as const).map((side) => ({ store, brand, period, side, ...sumDated(rows, side === "current" ? range.currentStart : range.previousStart, side === "current" ? range.currentEnd : range.previousEnd) })); }));
  const productEntities = groupRows(brands.productDaily, (row) => `${row.store}|${row.brand}|${row.adm}`);
  brands.productPeriods = (["mtd", "mty"] as const).flatMap((period) => [...productEntities].flatMap(([key, rows]) => { const [store, brand, adm] = key.split("|"); const range = ranges[period]; return (["current", "previous"] as const).map((side) => ({ store, brand, adm, description: descriptionByAdm.get(adm) ?? "Produto não identificado", period, side, ...sumDated(rows, side === "current" ? range.currentStart : range.previousStart, side === "current" ? range.currentEnd : range.previousEnd) })); }));
  // Synthetic network rows are used by the unfiltered brand screen.
  for (const period of ["mtd", "mty"] as const) for (const store of sellers.stores.map((row) => row.name)) for (const side of ["current", "previous"] as const) {
    const range = ranges[period]; const rows = sellers.storeDaily.filter((row) => row.store === store);
    brands.brandPeriods.push({ store, brand: "__ALL__", period, side, ...sumDated(rows, side === "current" ? range.currentStart : range.previousStart, side === "current" ? range.currentEnd : range.previousEnd) });
  }
  brands.brands = [...new Set(brandDailyFacts.map((row) => row.brand))].sort();
  brands.meta.availableEnd = end;
  brands.meta.source = incoming.metadata.fileName;
  brands.meta.brands = brands.brands.length;
  brands.meta.brandMonthlyRows = brands.brandMonthly.length;
  brands.meta.productMonthlyRows = brands.productMonthly.length;

  const importedOfficial = sum(incoming.dashboard.daily.overall.filter((row) => row.date >= closing.start && row.date <= closing.end));
  if (Math.abs(importedOfficial.sale - closing.totalLiquid) > 0.05) throw new Error("A atualização foi bloqueada: o Total líquido importado diverge da consolidação diária.");
  assertClose("lojas", importedOfficial, sum(incomingSellers.storeDaily.filter((row) => row.date >= closing.start && row.date <= closing.end)));
  return { dashboard, products, sellers, brands };
}
