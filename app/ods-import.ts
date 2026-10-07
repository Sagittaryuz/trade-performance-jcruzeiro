import type { BrandMovementData, DashboardData, Delta, Metrics, Product, ProductData, SellerData } from "./types";

type Master = Omit<Product, "current" | "previous" | "total" | "delta" | "periods" | "weekly" | "daily" | "monthly">;
type Acc = {
  sale: number; gross: number; freight: number; discount: number; quantity: number;
  cost: number; basePresent: number; profit: number; profitPresent: number;
  transactions: Set<string>; skus: Set<string>;
};

const emptyAcc = (): Acc => ({ sale: 0, gross: 0, freight: 0, discount: 0, quantity: 0, cost: 0, basePresent: 0, profit: 0, profitPresent: 0, transactions: new Set(), skus: new Set() });
const getAcc = (map: Map<string, Acc>, key: string) => {
  let value = map.get(key);
  if (!value) { value = emptyAcc(); map.set(key, value); }
  return value;
};
const add = (acc: Acc, row: { sale: number; gross: number; freight: number; discount: number; quantity: number; cost: number; basePresent: number; profit: number; profitPresent: number; movement: string; adm: string; isSale: boolean }) => {
  acc.sale += row.sale; acc.gross += row.gross; acc.freight += row.freight; acc.discount += row.discount;
  acc.quantity += row.quantity; acc.cost += row.cost; acc.basePresent += row.basePresent;
  acc.profit += row.profit; acc.profitPresent += row.profitPresent;
  if (row.isSale) acc.transactions.add(row.movement);
  acc.skus.add(row.adm);
};
const merge = (target: Acc, source: Acc) => {
  target.sale += source.sale; target.gross += source.gross; target.freight += source.freight; target.discount += source.discount;
  target.quantity += source.quantity; target.cost += source.cost; target.basePresent += source.basePresent;
  target.profit += source.profit; target.profitPresent += source.profitPresent;
  source.transactions.forEach((id) => target.transactions.add(id)); source.skus.forEach((id) => target.skus.add(id));
};
const rounded = (n: number, places = 2) => Number(n.toFixed(places));
const metrics = (a?: Acc): Metrics => {
  const value = a ?? emptyAcc();
  const tx = value.transactions.size;
  const grossBase = value.gross || value.sale + value.discount;
  const basePresent = rounded(value.basePresent);
  const profitPresent = rounded(value.profitPresent);
  return {
    sale: rounded(value.sale), gross: rounded(value.gross), freight: rounded(value.freight), discount: rounded(value.discount),
    discountRate: grossBase ? rounded(value.discount / grossBase * 100, 4) : null,
    quantity: rounded(value.quantity, 3), cost: rounded(value.cost), basePresent,
    profit: rounded(value.profit), profitPresent,
    margin: basePresent ? rounded(profitPresent / basePresent * 100, 4) : null,
    transactions: tx, skus: value.skus.size,
    ticket: tx ? rounded(value.sale / tx) : null,
    averagePrice: value.quantity ? rounded(value.sale / value.quantity, 4) : null,
  };
};
const percent = (current: number | null, previous: number | null) => current == null || previous == null || previous === 0 ? null : rounded((current / previous - 1) * 100, 4);
const delta = (current: Metrics, previous: Metrics): Delta => ({
  saleAbsolute: rounded(current.sale - previous.sale), salePercent: percent(current.sale, previous.sale),
  marginPp: current.margin == null || previous.margin == null ? null : rounded(current.margin - previous.margin, 4),
  profitPresentAbsolute: rounded(current.profitPresent - previous.profitPresent),
  profitPresentPercent: percent(current.profitPresent, previous.profitPresent),
  quantityPercent: percent(current.quantity, previous.quantity), ticketPercent: percent(current.ticket, previous.ticket),
});
const inRange = (date: string, start: string, end: string) => date >= start && date <= end;
const sumRange = (map: Map<string, Acc>, start: string, end: string, prefix = "") => {
  const out = emptyAcc();
  for (const [key, value] of map) {
    const date = prefix ? key.slice(prefix.length) : key;
    if ((!prefix || key.startsWith(prefix)) && inRange(date, start, end)) merge(out, value);
  }
  return out;
};
const iso = (date: Date) => date.toISOString().slice(0, 10);
const shiftDays = (value: string, days: number) => { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return iso(date); };
const monthStart = (value: string) => `${value.slice(0, 7)}-01`;
const yearStart = (value: string) => `${value.slice(0, 4)}-01-01`;
const priorYear = (value: string) => `${Number(value.slice(0, 4)) - 1}${value.slice(4)}`;
const monday = (value: string) => { const date = new Date(`${value}T12:00:00Z`); const day = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() - day + 1); return iso(date); };
const brNumber = (raw: unknown) => {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  let value = String(raw ?? "").trim().replace(/R\$/g, "").replace(/\s/g, "");
  if (value.includes(",")) value = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0;
};
const parseDate = (raw: unknown) => {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return iso(raw);
  const value = String(raw ?? "").trim();
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return "";
  const year = match[3].length === 2 ? Number(match[3]) + 2000 : Number(match[3]);
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
};
const storeFromLabel = (raw: unknown) => {
  const value = String(raw ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (value.includes("CATEDRAL") || /^\s*3\s*-/.test(value)) return "Catedral";
  if (value.includes("MINEIROS") || /^\s*6\s*-/.test(value)) return "Mineiros";
  if (value.includes("RHARO") || /^\s*8\s*-/.test(value)) return "Rharo";
  if (value.includes("ABDALA") || /^\s*10\s*-/.test(value)) return "Said Abdala";
  if (value.includes("RIO VERDE") || /^\s*11\s*-/.test(value)) return "Rio Verde";
  if (value.includes("MATRIZ") || /^\s*[12]\s*-/.test(value)) return "Matriz";
  return "";
};
const cellValue = (cell: unknown) => {
  if (cell == null) return "";
  if (typeof cell !== "object") return cell;
  const item = cell as { v?: unknown; w?: string };
  return item.w ?? item.v ?? "";
};
const decodeXml = (value: string) => value
  .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function parseRowXml(xml: string) {
  const row: string[] = [];
  const cellPattern = /<table:(table-cell|covered-table-cell)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:\1>)/g;
  let match: RegExpExecArray | null;
  while ((match = cellPattern.exec(xml)) && row.length < 30) {
    const attributes = match[2] ?? "";
    const body = match[3] ?? "";
    const repeatMatch = attributes.match(/table:number-columns-repeated="(\d+)"/);
    const repeat = Math.min(Number(repeatMatch?.[1] ?? 1), 30 - row.length);
    const text = decodeXml(body.replace(/<[^>]+>/g, "").trim());
    const fallback = attributes.match(/office:(?:value|date-value|time-value)="([^"]*)"/)?.[1] ?? "";
    const value = text || decodeXml(fallback);
    for (let index = 0; index < repeat; index++) row.push(value);
  }
  while (row.length && row[row.length - 1] === "") row.pop();
  return row;
}

async function* readOdsRows(file: File, onProgress?: (message: string) => void) {
  const header = new DataView(await file.slice(0, 80).arrayBuffer());
  if (header.getUint32(0, true) !== 0x04034b50) throw new Error("O arquivo não possui uma estrutura ODS válida.");
  const method = header.getUint16(8, true);
  const compressedSize = header.getUint32(18, true);
  const uncompressedSize = header.getUint32(22, true);
  const nameLength = header.getUint16(26, true);
  const extraLength = header.getUint16(28, true);
  const name = new TextDecoder().decode(await file.slice(30, 30 + nameLength).arrayBuffer());
  if (name !== "content.xml" || method !== 8 || !compressedSize) throw new Error("A ODS não contém content.xml compactado no formato esperado.");
  const start = 30 + nameLength + extraLength;
  const compressed = file.slice(start, start + compressedSize);
  if (typeof DecompressionStream === "undefined") throw new Error("Este navegador não oferece a descompactação necessária. Use uma versão atual do Chrome ou Edge.");
  const reader = compressed.stream().pipeThrough(new DecompressionStream("deflate-raw")).pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "", processed = 0, nextProgress = 100_000_000;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    processed += value.length;
    buffer += value;
    for (;;) {
      const rowStart = buffer.indexOf("<table:table-row");
      if (rowStart < 0) { if (buffer.length > 64) buffer = buffer.slice(-64); break; }
      const openEnd = buffer.indexOf(">", rowStart);
      if (openEnd < 0) { buffer = buffer.slice(rowStart); break; }
      if (buffer[openEnd - 1] === "/") { buffer = buffer.slice(openEnd + 1); continue; }
      const rowEnd = buffer.indexOf("</table:table-row>", openEnd);
      if (rowEnd < 0) { buffer = buffer.slice(rowStart); break; }
      const rowXml = buffer.slice(openEnd + 1, rowEnd);
      buffer = buffer.slice(rowEnd + 18);
      yield parseRowXml(rowXml);
    }
    if (processed >= nextProgress) {
      const percentage = uncompressedSize ? Math.min(99, Math.round(processed / uncompressedSize * 100)) : 0;
      onProgress?.(`Lendo os movimentos… ${percentage}%`);
      nextProgress += 100_000_000;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
}
const diagnose = (sales: number | null, margin: number | null) => {
  if (sales == null || margin == null) return "Sem base comparativa";
  if (sales > 1 && margin > .2) return "Crescimento saudável";
  if (sales > 1) return "Crescimento com perda de rentabilidade";
  if (margin > .2) return "Margem melhor, mas perda de volume";
  if (Math.abs(sales) <= 1 && Math.abs(margin) <= .2) return "Estável";
  return "Categoria crítica";
};

export type OfficialClosing = { totalLiquid: number; start: string; end: string };
export type OdsImportResult = { dashboard: DashboardData; products: ProductData; sellers?: SellerData; brandMovements?: BrandMovementData; metadata: { fileName: string; availableStart: string; availableEnd: string; totalLiquid: number; recordsImported: number } };

export async function processSalesOds(file: File, onProgress?: (message: string) => void, referenceProducts: Product[] = [], referenceSellers: SellerData | null = null): Promise<OdsImportResult> {
  onProgress?.("Abrindo a planilha…");

  const products = new Map<string, Master>();
  const descriptions = new Map<string, Set<string>>();
  const categories = new Map<string, string>();
  const brands = new Set<string>();
  const referenceByAdm = new Map(referenceProducts.map((product) => [product.adm, product]));
  const sellerByCode = new Map((referenceSellers?.sellers ?? []).map((seller) => [seller.code.replace(/^0+/, "") || "0", seller]));
  const knownCategoryCodes = new Set(referenceProducts.map((product) => product.categoryCode).filter(Boolean));
  const knownCategoryNames = new Set(referenceProducts.map((product) => product.category).filter(Boolean));
  const overallDaily = new Map<string, Acc>();
  const categoryDaily = new Map<string, Acc>();
  const brandDaily = new Map<string, Acc>();
  const categoryBrandDaily = new Map<string, Acc>();
  const productDaily = new Map<string, Acc>();
  const productTotal = new Map<string, Acc>();
  const storeDaily = new Map<string, Acc>();
  const sellerDaily = new Map<string, Acc>();
  const storeProducts = new Map<string, Acc>();
  const brandStoreDaily = new Map<string, Acc>();
  const brandStoreMonthly = new Map<string, Acc>();
  const productStoreDaily = new Map<string, Acc>();
  const productStoreMonthly = new Map<string, Acc>();
  const movementOwner = new Map<string, string>();
  let category = { code: "", name: "Sem categoria" }, subcategory = { code: "", name: "Sem subcategoria" }, group = { code: "", name: "Sem agrupamento" };
  let currentSeller: { code: string; name: string; store: string } | null = null;
  let current: Master | null = null;
  let state: "group" | "product" | "movement" = "group";
  let movementRows = 0, records = 0, invalidDates = 0, withoutProduct = 0, ignoredRows = 0, sellerMovementRows = 0;
  const sharedSellerRows = 0;
  let minDate = "9999-12-31", maxDate = "0000-00-00";
  const groupPattern = /^\d{3}(?:\.\d{3}){0,3}$/;
  const movementPattern = /^\d{1,3}(?:\.\d{3})+$/;
  const productPattern = /^\d+$/;
  type MovementEvent = Parameters<typeof add>[1];
  type MovementSeller = { code: string; name: string; store: string } | null;
  const movementDates = new Map<string, string>();
  const movementDateSamples = new Map<string, Array<[number, string]>>();
  let inferredDates = 0;
  let sameIntervalDates = 0;
  let bracketChoiceDates = 0;
  let reportStart = "";
  let reportEnd = "";
  let hasFilterSection = false, hasSellerGrouping = false, onlyReceivedOrders = false;
  let automaticReturnsDisabled = false, commercialCost = false, omitsClientGroup = false, mentionsAffiliatedWorks = false;
  let productHeaders = 0, movementHeaders = 0, explicitDatesOutsideRange = 0;
  let reportTotalLiquid: number | null = null;
  const reportStores = new Set<string>();
  const sellerControlSales = new Map<string, number>();
  const sellerControlCodes = new Set<string>();
  const sellerCorrectionTargets = new Map<string, { date: string; product: Master; seller: NonNullable<MovementSeller>; magnitude: number }>();
  const pendingMovements: Array<{ dateKey: string; event: MovementEvent; product: Master; seller: MovementSeller }> = [];
  const recordEvent = (date: string, event: MovementEvent, movementProduct: Master, seller: MovementSeller) => {
    if (!movementProduct.categoryCode) categories.set("", "Sem categoria");
    else categories.set(movementProduct.categoryCode, movementProduct.category);
    brands.add(movementProduct.brand);
    add(getAcc(overallDaily, date), event);
    add(getAcc(categoryDaily, `${movementProduct.categoryCode}|${date}`), event);
    add(getAcc(brandDaily, `${movementProduct.brand}|${date}`), event);
    add(getAcc(categoryBrandDaily, `${movementProduct.categoryCode}|${movementProduct.brand}|${date}`), event);
    add(getAcc(productDaily, `${movementProduct.adm}|${date}`), event);
    add(getAcc(productTotal, movementProduct.adm), event);
    if (seller) {
      const sellerKey = `${seller.store}|${seller.code}|${seller.name}`;
      movementOwner.set(`${seller.store}|${seller.code}|${event.movement}`, seller.code);
      const month = date.slice(0, 7);
      add(getAcc(storeDaily, `${seller.store}|${date}`), event);
      add(getAcc(sellerDaily, `${seller.store}|${seller.code}|${seller.name}|${date}`), event);
      add(getAcc(storeProducts, `${seller.store}|${movementProduct.adm}`), event);
      add(getAcc(brandStoreDaily, `${seller.store}|${movementProduct.brand}|${date}`), event);
      add(getAcc(brandStoreMonthly, `${seller.store}|${month}|${movementProduct.brand}`), event);
      add(getAcc(productStoreDaily, `${seller.store}|${movementProduct.brand}|${movementProduct.adm}|${date}`), event);
      add(getAcc(productStoreMonthly, `${seller.store}|${month}|${movementProduct.brand}|${movementProduct.adm}`), event);
      const target = sellerCorrectionTargets.get(sellerKey);
      if (!target || Math.abs(event.sale) > target.magnitude) sellerCorrectionTargets.set(sellerKey, { date, product: movementProduct, seller, magnitude: Math.abs(event.sale) });
      sellerMovementRows++;
    }
    records++;
    if (date < minDate) minDate = date;
    if (date > maxDate) maxDate = date;
  };

  let index = 0;
  for await (const sourceRow of readOdsRows(file, onProgress)) {
    const row = sourceRow.map(cellValue);
    const first = String(row[0] ?? "").trim();
    const normalizedLine = row.map((value) => String(value ?? "")).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    if (normalizedLine.includes("FILTROS SELECIONADOS")) hasFilterSection = true;
    const listedStore = storeFromLabel(normalizedLine);
    if (hasFilterSection && listedStore) reportStores.add(listedStore);
    if (normalizedLine.includes("AGRUPADOR") && normalizedLine.includes("VENDEDOR")) hasSellerGrouping = true;
    if (normalizedLine.includes("APENAS PEDIDOS RECEBIDOS")) onlyReceivedOrders = true;
    if (/DEVOLUCAO AUTOMATICA.*\bNAO\b/.test(normalizedLine)) automaticReturnsDisabled = true;
    if (normalizedLine.includes("CUSTO COMERCIAL")) commercialCost = true;
    if (normalizedLine.includes("OMITIR GRUPO DE CLIENTES")) omitsClientGroup = true;
    if (normalizedLine.includes("OBRA COLIGADA")) mentionsAffiliatedWorks = true;
    if (normalizedLine.includes("DATA DE RECEBIMENTO")) {
      const dates = normalizedLine.match(/\d{1,2}\/\d{1,2}\/\d{2,4}/g) ?? [];
      if (dates.length >= 2) { reportStart = parseDate(dates[0]); reportEnd = parseDate(dates[1]); }
    }
    if (String(row[1] ?? "").trim().toUpperCase() === "TOTAL" && row.length >= 17) {
      if (reportTotalLiquid != null) throw new Error("A atualização foi bloqueada: a ODS contém mais de um Total geral.");
      reportTotalLiquid = brNumber(row[16]);
    }
    if (first === "Produto" && row.length > 4) { state = "product"; productHeaders++; }
    else if (first === "Movimento" && row.length > 4) {
      if (String(row[19] ?? "").replace(/\s/g, "").toLocaleLowerCase("pt-BR") !== "%lucropres.") throw new Error("A coluna de margem precisa ser %Lucro pres. na posição esperada.");
      state = "movement"; movementHeaders++;
    } else if (/^\d+$/.test(first) && row.length >= 24 && storeFromLabel(row[4])) {
      const code = first.replace(/^0+/, "") || "0";
      const seller = sellerByCode.get(code);
      const store = storeFromLabel(row[4]) || seller?.store || "";
      currentSeller = store ? { code, name: String(row[1] ?? seller?.name ?? "").trim(), store } : null;
      if (currentSeller) {
        const sellerKey = `${currentSeller.store}|${currentSeller.code}|${currentSeller.name}`;
        if (sellerControlCodes.has(currentSeller.code)) throw new Error(`A ODS repetiu o vendedor ${currentSeller.code} em mais de um agrupamento. Exporte novamente agrupando somente por Vendedor.`);
        sellerControlCodes.add(currentSeller.code);
        sellerControlSales.set(sellerKey, brNumber(row[16]));
      }
      state = "group";
    } else if (groupPattern.test(first) && row.length >= 26) {
      const segments = first.split(".").length;
      const item = { code: first, name: String(row[1] ?? "").trim() };
      if (segments === 1) {
        const seller = sellerByCode.get(item.code.replace(/^0+/, "") || "0");
        const store = storeFromLabel(row[4]) || seller?.store || "";
        currentSeller = store ? { code: item.code.replace(/^0+/, "") || "0", name: item.name, store } : null;
        if (!referenceProducts.length || knownCategoryCodes.has(item.code) || knownCategoryNames.has(item.name)) category = item;
        else category = { code: "", name: "Sem categoria" };
      }
      else if (segments === 3) subcategory = item;
      else if (segments === 4) group = item;
      state = "group";
    } else if (state === "product" && productPattern.test(first) && row.length >= 5) {
      const adm = first.replace(/^0+/, "") || "0";
      const brandRaw = String(row[3] ?? "").trim();
      const brand = brandRaw.replace(/^\d+\s*-\s*/, "").trim() || "Sem marca";
      const reference = referenceByAdm.get(adm);
      current = { adm, description: String(row[1] ?? "").trim(), ncm: String(row[2] ?? "").trim(), brand, brandRaw, originalCode: String(row[4] ?? "").trim(), categoryCode: reference?.categoryCode ?? category.code, category: reference?.category ?? category.name, subcategoryCode: reference?.subcategoryCode ?? subcategory.code, subcategory: reference?.subcategory ?? subcategory.name, groupCode: reference?.groupCode ?? group.code, group: reference?.group ?? group.name };
      if (current.categoryCode) categories.set(current.categoryCode, current.category);
      products.set(adm, products.get(adm) ?? current);
      brands.add(brand);
      const names = descriptions.get(adm) ?? new Set<string>(); names.add(current.description); descriptions.set(adm, names);
    } else if (state === "movement" && movementPattern.test(first) && row.length >= 20) {
      movementRows++;
      // In reports grouped by seller, the product summary is listed before the
      // movement table. Every movement identifies its own product in column 4;
      // relying on `current` would assign the whole seller block to the last SKU.
      const movementAdm = String(row[3] ?? "").trim().replace(/\./g, "").replace(/^0+/, "") || "0";
      const movementProduct = products.get(movementAdm) ?? referenceByAdm.get(movementAdm);
      if (!movementProduct) { withoutProduct++; continue; }
      // The official Santri closing is filtered by "Data de recebimento".
      // Row[1] is only the order closing timestamp and can put a sale in a
      // different day/month from the Finance report.
      const parsedMovement = first.replace(/\./g, "");
      const dateKey = `${currentSeller?.code ?? "__ALL__"}|${parsedMovement}`;
      const parsedDate = parseDate(row[2]);
      if (parsedDate && reportStart && reportEnd && !inRange(parsedDate, reportStart, reportEnd)) explicitDatesOutsideRange++;
      // Santri lists sales as seven-digit movements (e.g. 2.289.927) and
      // returns as six-digit movements (e.g. 358.030). Return rows are printed
      // as positive values in the detail, but are subtracted in every product,
      // seller and company subtotal. Preserve that accounting sign here.
      const isSale = first.split(".").length >= 3;
      const sign = isSale ? 1 : -1;
      if (parsedDate) {
        movementDates.set(dateKey, parsedDate);
        const sampleKey = `${currentSeller?.code ?? "__ALL__"}|${isSale ? "S" : "R"}`;
        const samples = movementDateSamples.get(sampleKey) ?? [];
        samples.push([Number(parsedMovement), parsedDate]);
        movementDateSamples.set(sampleKey, samples);
        const globalSampleKey = `__GLOBAL__|${isSale ? "S" : "R"}`;
        const globalSamples = movementDateSamples.get(globalSampleKey) ?? [];
        globalSamples.push([Number(parsedMovement), parsedDate]);
        movementDateSamples.set(globalSampleKey, globalSamples);
      }
      const freight = brNumber(row[9]) * sign;
      const sale = brNumber(row[15]) * sign;
      const basePresent = brNumber(row[18]) * sign;
      const profitPresent = basePresent * brNumber(row[19]) / 100;
      const reportedCost = brNumber(row[16]) * sign;
      const costLimit = Math.max(Math.abs(sale), Math.abs(basePresent), 1) * 50;
      const cost = Math.abs(reportedCost) <= costLimit ? reportedCost : basePresent - profitPresent;
      const event = { adm: movementProduct.adm, movement: parsedMovement, isSale, quantity: brNumber(row[6]) * sign, gross: (brNumber(row[8]) + brNumber(row[9]) + brNumber(row[10]) + brNumber(row[11]) + brNumber(row[12])) * sign, freight, discount: brNumber(row[13]) * sign, sale, cost, basePresent, profit: sale - cost, profitPresent };
      if (referenceSellers && !currentSeller) {
        ignoredRows++;
        continue;
      }
      const date = parsedDate || movementDates.get(dateKey);
      if (date) recordEvent(date, event, movementProduct, currentSeller);
      else pendingMovements.push({ dateKey, event, product: movementProduct, seller: currentSeller });
    } else if (row.some((value) => String(value ?? "").trim())) ignoredRows++;
    index++;
    if (index > 0 && index % 50000 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  movementDateSamples.forEach((samples, key) => {
    const unique = new Map<number, string>();
    for (const [movement, date] of samples) {
      if ((!reportStart || date >= reportStart) && (!reportEnd || date <= reportEnd)) unique.set(movement, date);
    }
    movementDateSamples.set(key, [...unique].sort((a, b) => a[0] - b[0]));
  });
  const bracketedMovementDate = (pending: typeof pendingMovements[number]) => {
    const sellerCode = pending.dateKey.slice(0, pending.dateKey.indexOf("|"));
    const type = pending.event.isSale ? "S" : "R";
    // Pedido é uma sequência global da operação. Usar primeiro os vizinhos
    // globais evita que um vendedor com poucos pedidos faça o acumulativo
    // saltar vários dias. O recorte por vendedor fica apenas como contingência.
    const sourceSamples = movementDateSamples.get(`__GLOBAL__|${type}`) ?? movementDateSamples.get(`${sellerCode}|${type}`);
    const samples = sourceSamples;
    if (!samples?.length) return "";
    const target = Number(pending.event.movement);
    let low = 0, high = samples.length;
    while (low < high) { const middle = (low + high) >> 1; if (samples[middle][0] < target) low = middle + 1; else high = middle; }
    const before = low > 0 ? samples[low - 1] : undefined;
    const after = low < samples.length ? samples[low] : undefined;
    if (before && after && before[1] === after[1]) {
      sameIntervalDates++;
      return before[1];
    }
    if (!before) return after?.[1] ?? "";
    if (!after) return before[1];
    bracketChoiceDates++;
    // Quando os dois pedidos-limite pertencem a fechamentos diferentes, o
    // número do acumulativo decide para qual extremidade do intervalo ele vai.
    // Domingos e feriados não são deslocados: continuam sendo datas válidas de
    // fechamento dentro do intervalo, ainda que a loja não tenha aberto.
    return Math.abs(target - before[0]) < Math.abs(after[0] - target) ? before[1] : after[1];
  };
  for (const pending of pendingMovements) {
    const exactDate = movementDates.get(pending.dateKey);
    const estimatedDate = bracketedMovementDate(pending);
    const date = exactDate || estimatedDate || reportEnd;
    if (!exactDate && date) inferredDates++;
    if (date) recordEvent(date, pending.event, pending.product, pending.seller);
    else invalidDates++;
  }
  if (!records) throw new Error("Nenhum movimento válido foi encontrado na ODS.");
  if (!reportStart || !reportEnd) throw new Error("A ODS detalhada não informa o intervalo de Data de recebimento nos filtros.");
  if (reportStart > reportEnd) throw new Error("A atualização foi bloqueada: o início do período é posterior ao último dia fechado.");
  if (!hasFilterSection || !hasSellerGrouping) throw new Error("A atualização foi bloqueada: exporte o relatório com o agrupador Vendedor e mantenha a seção Filtros selecionados.");
  if (!onlyReceivedOrders || !automaticReturnsDisabled || !commercialCost) throw new Error("A atualização foi bloqueada: use Apenas pedidos recebidos, Devolução automática = Não e Tipo de custo de compra = Custo comercial.");
  if (!omitsClientGroup || !mentionsAffiliatedWorks) throw new Error("A atualização foi bloqueada: marque 'Omitir grupo de clientes — 13 - OBRA COLIGADA' na ODS detalhada.");
  if (!productHeaders || !movementHeaders || movementHeaders !== productHeaders) throw new Error("A atualização foi bloqueada: a estrutura de Produtos e Movimentos está incompleta ou foi alterada pelo exportador.");
  if (explicitDatesOutsideRange) throw new Error(`A atualização foi bloqueada: ${explicitDatesOutsideRange} movimentos possuem Data de recebimento fora do período declarado.`);
  if (withoutProduct || invalidDates || !sellerControlSales.size || !referenceSellers) throw new Error("A atualização foi bloqueada: existem movimentos sem produto, data ou vínculo válido de vendedor e loja.");

  const requiredStores = ["Matriz", "Catedral", "Mineiros", "Rharo", "Said Abdala", "Rio Verde"];
  const missingStores = requiredStores.filter((store) => !reportStores.has(store));
  if (missingStores.length) throw new Error(`A atualização foi bloqueada: os filtros da ODS não incluem as lojas ${missingStores.join(", ")}.`);
  if (!(reportTotalLiquid != null && Number.isFinite(reportTotalLiquid))) throw new Error("A atualização foi bloqueada: o Total líquido geral não foi encontrado na própria ODS.");

  // The seller header is the internal accounting control in the same ODS. It
  // is rounded at the report level, while detail rows can differ by cents.
  // Reconcile every seller independently, then carry only those cent-level
  // adjustments through all product, brand, store and network aggregates.
  const applyCorrection = (target: NonNullable<ReturnType<typeof sellerCorrectionTargets.get>>, correction: number) => {
    const { date, product, seller } = target;
    const sellerKey = `${seller.store}|${seller.code}|${seller.name}`;
    const keys: Array<[Map<string, Acc>, string]> = [
      [overallDaily, date], [categoryDaily, `${product.categoryCode}|${date}`], [brandDaily, `${product.brand}|${date}`],
      [categoryBrandDaily, `${product.categoryCode}|${product.brand}|${date}`], [productDaily, `${product.adm}|${date}`], [productTotal, product.adm],
      [storeDaily, `${seller.store}|${date}`], [sellerDaily, `${sellerKey}|${date}`], [storeProducts, `${seller.store}|${product.adm}`],
      [brandStoreDaily, `${seller.store}|${product.brand}|${date}`], [brandStoreMonthly, `${seller.store}|${date.slice(0, 7)}|${product.brand}`],
      [productStoreDaily, `${seller.store}|${product.brand}|${product.adm}|${date}`], [productStoreMonthly, `${seller.store}|${date.slice(0, 7)}|${product.brand}|${product.adm}`],
    ];
    keys.forEach(([map, key]) => { getAcc(map, key).sale += correction; });
  };
  let sellerControlTotal = 0, detailedTotalBeforeCorrection = 0;
  for (const [sellerKey, controlSale] of sellerControlSales) {
    sellerControlTotal += controlSale;
    const detail = metrics(sumRange(sellerDaily, reportStart, reportEnd, `${sellerKey}|`)).sale;
    detailedTotalBeforeCorrection += detail;
    const gap = rounded(controlSale - detail);
    const tolerance = Math.max(0.05, Math.abs(controlSale) * 0.00001);
    if (Math.abs(gap) > tolerance) throw new Error(`A atualização foi bloqueada: o vendedor ${sellerKey.split("|")[2]} diverge ${rounded(gap)} do subtotal impresso na própria ODS.`);
    if (!gap) continue;
    const target = sellerCorrectionTargets.get(sellerKey);
    if (!target) throw new Error(`A atualização foi bloqueada: não foi possível conciliar o subtotal do vendedor ${sellerKey.split("|")[2]}.`);
    applyCorrection(target, gap);
  }
  sellerControlTotal = rounded(sellerControlTotal);
  detailedTotalBeforeCorrection = rounded(detailedTotalBeforeCorrection);
  const reportGap = rounded(reportTotalLiquid - sellerControlTotal);
  if (Math.abs(reportGap) > 0.05) throw new Error(`A atualização foi bloqueada: os subtotais dos vendedores divergem ${reportGap.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} do Total líquido geral da própria ODS.`);
  if (reportGap) {
    const networkTarget = [...sellerCorrectionTargets.values()].sort((a, b) => b.magnitude - a.magnitude)[0];
    if (!networkTarget) throw new Error("A atualização foi bloqueada: não foi possível aplicar a reconciliação centesimal do Total líquido geral.");
    applyCorrection(networkTarget, reportGap);
  }
  const internalControlTotal = rounded(reportTotalLiquid);
  const reconciledTotal = metrics(sumRange(overallDaily, reportStart, reportEnd)).sale;
  if (Math.abs(reconciledTotal - internalControlTotal) > 0.01) throw new Error("A atualização foi bloqueada: a reconciliação interna da ODS não fechou após os ajustes centesimais.");

  const todaySaoPaulo = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const effectiveMinDate = reportStart || minDate;
  const effectiveMaxDate = reportEnd || maxDate;
  // A operação pode enviar o fechamento do próprio dia depois do expediente.
  // Bloqueamos apenas datas futuras; pela manhã, o relatório deve terminar no
  // dia anterior, enquanto à noite o próprio dia completo é aceito.
  const closedEnd = effectiveMaxDate <= todaySaoPaulo ? effectiveMaxDate : todaySaoPaulo;
  const mtd = { currentStart: monthStart(closedEnd), currentEnd: closedEnd, previousStart: priorYear(monthStart(closedEnd)), previousEnd: priorYear(closedEnd), label: "Mês até a data × mesmo período do ano anterior" };
  const mty = { currentStart: yearStart(closedEnd), currentEnd: closedEnd, previousStart: priorYear(yearStart(closedEnd)), previousEnd: priorYear(closedEnd), label: "Ano até a data × mesmo período do ano anterior" };
  const lastSaturday = (() => { const date = new Date(`${effectiveMaxDate}T12:00:00Z`); const diff = (date.getUTCDay() - 6 + 7) % 7; return shiftDays(effectiveMaxDate, -diff); })();
  const currentStart = shiftDays(lastSaturday, -5), currentEnd = lastSaturday, previousStart = shiftDays(currentStart, -7), previousEnd = shiftDays(currentEnd, -7);
  const comparison = { currentStart, currentEnd, previousStart, previousEnd, label: "Última semana fechada × semana anterior" };
  const nestByEntity = (source: Map<string, Acc>) => {
    const nested = new Map<string, Map<string, Acc>>();
    for (const [key, value] of source) {
      const split = key.lastIndexOf("|");
      const entity = key.slice(0, split), date = key.slice(split + 1);
      let dates = nested.get(entity);
      if (!dates) { dates = new Map(); nested.set(entity, dates); }
      dates.set(date, value);
    }
    return nested;
  };
  const categoriesByDate = nestByEntity(categoryDaily);
  const brandsByDate = nestByEntity(brandDaily);
  const productsByDate = nestByEntity(productDaily);
  const currentOverall = metrics(sumRange(overallDaily, currentStart, currentEnd));
  const previousOverall = metrics(sumRange(overallDaily, previousStart, previousEnd));
  const overall = { current: currentOverall, previous: previousOverall, delta: delta(currentOverall, previousOverall) };

  onProgress?.("Consolidando categorias, marcas, lojas, vendedores e produtos…");
  const categoryRows = [...categories].map(([code, name]) => {
    const dates = categoriesByDate.get(code) ?? new Map<string, Acc>();
    const now = metrics(sumRange(dates, currentStart, currentEnd));
    const before = metrics(sumRange(dates, previousStart, previousEnd));
    const change = delta(now, before);
    const share = currentOverall.sale ? rounded(now.sale / currentOverall.sale * 100, 4) : 0;
    const weekly = Array.from({ length: 12 }, (_, i) => {
      const start = shiftDays(currentStart, (i - 11) * 7); const end = shiftDays(start, 5);
      return { start, end, ...metrics(sumRange(dates, start, end)) };
    });
    return { code, name, current: now, previous: before, delta: change, share, diagnosis: diagnose(change.salePercent, change.marginPp), priority: "Média" as const, weekly };
  }).sort((a, b) => b.current.sale - a.current.sale);
  const brandRows = [...brands].map((name) => {
    const dates = brandsByDate.get(name) ?? new Map<string, Acc>();
    const now = metrics(sumRange(dates, currentStart, currentEnd));
    const before = metrics(sumRange(dates, previousStart, previousEnd));
    const total = metrics(sumRange(dates, effectiveMinDate, effectiveMaxDate));
    return { name, current: now, previous: before, total, delta: delta(now, before) };
  }).sort((a, b) => b.current.sale - a.current.sale);

  const productRows: Product[] = [...products].map(([adm, master]) => {
    const dates = productsByDate.get(adm) ?? new Map<string, Acc>();
    const now = metrics(sumRange(dates, currentStart, currentEnd));
    const before = metrics(sumRange(dates, previousStart, previousEnd));
    const periods = Object.fromEntries(([['mtd', mtd], ['mty', mty]] as const).map(([code, period]) => {
      const periodNow = metrics(sumRange(dates, period.currentStart, period.currentEnd));
      const periodBefore = metrics(sumRange(dates, period.previousStart, period.previousEnd));
      return [code, { current: periodNow, previous: periodBefore, delta: delta(periodNow, periodBefore) }];
    })) as Product["periods"];
    // O detalhe diário exibido no produto fica restrito ao mês atual. O
    // histórico comparativo por loja/SKU é mantido uma única vez no payload de
    // movimentos, evitando duplicar dezenas de megabytes em products.json.
    const daily = [...dates].map(([date, value]) => ({ date, ...pickTrend(metrics(value)) })).filter((item) => item.date >= monthStart(closedEnd) && item.date <= closedEnd).sort((a, b) => a.date.localeCompare(b.date));
    const monthMap = new Map<string, Acc>();
    for (const [date, value] of dates) merge(getAcc(monthMap, date.slice(0, 7)), value);
    const earliestMonth = (() => { const date = new Date(`${monthStart(closedEnd)}T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() - 11); return iso(date).slice(0, 7); })();
    const monthly = [...monthMap].filter(([month]) => month >= earliestMonth).sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({ date: `${month}-01`, ...pickTrend(metrics(value)) }));
    const weekly = Array.from({ length: 12 }, (_, i) => { const start = shiftDays(currentStart, (i - 11) * 7); const value = metrics(sumRange(dates, start, shiftDays(start, 5))); return { start, sale: value.sale, quantity: value.quantity, profitPresent: value.profitPresent, margin: value.margin }; });
    const total = metrics(productTotal.get(adm));
    return { ...master, current: now, previous: before, total, delta: delta(now, before), periods, weekly, daily, monthly };
  }).sort((a, b) => b.current.sale - a.current.sale);

  const overallMonths = new Map<string, Acc>(); for (const [date, value] of overallDaily) merge(getAcc(overallMonths, date.slice(0, 7)), value);
  const monthly = [...overallMonths].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => ({ month, ...metrics(value) }));
  const weekly = Array.from({ length: 52 }, (_, i) => { const start = shiftDays(currentStart, (i - 51) * 7); return { start, end: shiftDays(start, 5), ...metrics(sumRange(overallDaily, start, shiftDays(start, 5))) }; });
  const fact = (date: string, value: Acc, extra = {}) => ({ date, ...extra, ...metrics(value) });
  const compactMetrics = (value: Acc) => {
    const item = metrics(value);
    return { sale: item.sale, quantity: item.quantity, basePresent: item.basePresent, profitPresent: item.profitPresent, margin: item.margin, transactions: item.transactions };
  };
  let sellersPayload: SellerData | undefined;
  let brandMovementsPayload: BrandMovementData | undefined;
  if (referenceSellers && sellerMovementRows) {
    const sellerTotals = new Map<string, Acc>();
    for (const [key, value] of sellerDaily) merge(getAcc(sellerTotals, key.slice(0, key.lastIndexOf("|"))), value);
    const storeTotals = new Map<string, Acc>();
    for (const [key, value] of storeDaily) merge(getAcc(storeTotals, key.slice(0, key.lastIndexOf("|"))), value);
    const sellerRows = [...sellerTotals].map(([key, value]) => {
      const first = key.indexOf("|"), second = key.indexOf("|", first + 1);
      const item = metrics(value);
      return { store: key.slice(0, first), code: key.slice(first + 1, second), name: key.slice(second + 1), sale: item.sale, cost: item.cost, profitPresent: item.profitPresent, basePresent: item.basePresent, margin: item.margin };
    }).sort((a, b) => b.sale - a.sale);
    const storeRows = referenceSellers.stores.map((referenceStore) => {
      const value = storeTotals.get(referenceStore.name) ?? emptyAcc();
      const item = metrics(value);
      const topProducts = [...storeProducts].filter(([key]) => key.startsWith(`${referenceStore.name}|`)).map(([key, productValue]) => {
        const adm = key.slice(referenceStore.name.length + 1);
        const master = products.get(adm) ?? referenceByAdm.get(adm);
        const productMetrics = metrics(productValue);
        return { adm, description: master?.description ?? "Produto não identificado", brand: master?.brand ?? "Sem marca", sale: productMetrics.sale, quantity: productMetrics.quantity, profitPresent: productMetrics.profitPresent, basePresent: productMetrics.basePresent };
      }).sort((a, b) => b.sale - a.sale).slice(0, 10);
      return { name: referenceStore.name, sellerCount: sellerRows.filter((seller) => seller.store === referenceStore.name).length, sale: item.sale, profitPresent: item.profitPresent, basePresent: item.basePresent, margin: item.margin, detailSale: item.sale, reconciliationGap: 0, share: 0, topProducts };
    });
    const storeSale = storeRows.reduce((sum, store) => sum + store.sale, 0);
    storeRows.forEach((store) => { store.share = storeSale ? store.sale / storeSale * 100 : 0; });
    const storeDailyRows = [...storeDaily].map(([key, value]) => { const split = key.lastIndexOf("|"); return { store: key.slice(0, split), date: key.slice(split + 1), ...compactMetrics(value) }; }).sort((a, b) => a.date.localeCompare(b.date) || a.store.localeCompare(b.store));
    const sellerDailyRows = [...sellerDaily].map(([key, value]) => {
      const last = key.lastIndexOf("|"), first = key.indexOf("|"), second = key.indexOf("|", first + 1);
      return { store: key.slice(0, first), code: key.slice(first + 1, second), name: key.slice(second + 1, last), date: key.slice(last + 1), ...compactMetrics(value) };
    }).sort((a, b) => a.date.localeCompare(b.date) || a.store.localeCompare(b.store) || a.name.localeCompare(b.name));
    sellersPayload = {
      meta: { source: file.name, stores: storeRows.length, sellers: sellerRows.length, productRows: products.size, distinctAdm: products.size, matchedDistinctAdm: products.size, matchRate: 100, matchedRows: records, descriptionMismatches: 0, overflowRows: 0, periodCapability: "dated_movements", periodNote: "Movimentos atribuídos à loja pelo vínculo cadastrado de cada vendedor; datas obtidas nas próprias movimentações.", officialSale: storeSale, detailSale: storeSale, reconciliationRate: 100, movementRows: sellerMovementRows, movementSale: storeSale, movementTransactions: movementOwner.size, sharedMovementRowsRemoved: sharedSellerRows, duplicateMovementRowsRemoved: 0, movementReconciliationRate: storeSale && currentOverall.sale ? storeSale / metrics(sumRange(overallDaily, effectiveMinDate, effectiveMaxDate)).sale * 100 : 0, availableStart: effectiveMinDate, availableEnd: closedEnd, marginBasis: "%Lucro pres. dos movimentos; consolidado ponderado por Base lucro pres." },
      stores: storeRows, sellers: sellerRows, storeDaily: storeDailyRows, sellerDaily: sellerDailyRows, unmatchedAdm: [],
    };
    const brandMonthly = [...brandStoreMonthly].map(([key, value]) => { const first = key.indexOf("|"), second = key.indexOf("|", first + 1); return { store: key.slice(0, first), month: key.slice(first + 1, second), brand: key.slice(second + 1), ...compactMetrics(value) }; });
    const productMonthly = [...productStoreMonthly].map(([key, value]) => {
      const first = key.indexOf("|"), second = key.indexOf("|", first + 1), last = key.lastIndexOf("|");
      const adm = key.slice(last + 1); const master = products.get(adm) ?? referenceByAdm.get(adm);
      return { store: key.slice(0, first), month: key.slice(first + 1, second), brand: key.slice(second + 1, last), adm, description: master?.description ?? "Produto não identificado", ...compactMetrics(value) };
    });
    const productDailyRows = [...productStoreDaily].map(([key, value]) => {
      const first = key.indexOf("|"), second = key.indexOf("|", first + 1), last = key.lastIndexOf("|");
      const adm = key.slice(second + 1, last); const master = products.get(adm) ?? referenceByAdm.get(adm);
      return { store: key.slice(0, first), brand: key.slice(first + 1, second), adm, description: master?.description ?? "Produto não identificado", date: key.slice(last + 1), ...compactMetrics(value) };
    });
    // Keep one compact date map per entity. Scanning the complete movement map
    // once for every brand/product made full-history imports needlessly quadratic.
    const brandStoreByDate = nestByEntity(brandStoreDaily);
    const productStoreByDate = nestByEntity(productStoreDaily);
    const storeBrandPairs = [...brandStoreByDate.keys()];
    const brandPeriods = ([['mtd', mtd], ['mty', mty]] as const).flatMap(([period, range]) => {
      const rows = storeBrandPairs.flatMap((pair) => {
        const split = pair.indexOf("|");
        const store = pair.slice(0, split), brand = pair.slice(split + 1);
        const dates = brandStoreByDate.get(pair) ?? new Map<string, Acc>();
        return ([['current', range.currentStart, range.currentEnd], ['previous', range.previousStart, range.previousEnd]] as const).map(([side, start, end]) => ({ store, brand, period, side, ...compactMetrics(sumRange(dates, start, end)) }));
      });
      const allRows = referenceSellers.stores.flatMap(({ name: store }) => ([['current', range.currentStart, range.currentEnd], ['previous', range.previousStart, range.previousEnd]] as const).map(([side, start, end]) => ({ store, brand: "__ALL__", period, side, ...compactMetrics(sumRange(storeDaily, start, end, `${store}|`)) })));
      return [...rows, ...allRows];
    });
    const storeProductPairs = [...productStoreByDate.keys()];
    const productPeriods = ([['mtd', mtd], ['mty', mty]] as const).flatMap(([period, range]) => storeProductPairs.flatMap((pair) => {
      const first = pair.indexOf("|"), second = pair.indexOf("|", first + 1);
      const store = pair.slice(0, first), brand = pair.slice(first + 1, second), adm = pair.slice(second + 1);
      const dates = productStoreByDate.get(pair) ?? new Map<string, Acc>();
      const master = products.get(adm) ?? referenceByAdm.get(adm);
      return ([['current', range.currentStart, range.currentEnd], ['previous', range.previousStart, range.previousEnd]] as const).map(([side, start, end]) => ({ store, brand, adm, description: master?.description ?? "Produto não identificado", period, side, ...compactMetrics(sumRange(dates, start, end)) }));
    }));
    brandMovementsPayload = { meta: { source: file.name, availableStart: effectiveMinDate, availableEnd: closedEnd, brands: brands.size, brandMonthlyRows: brandMonthly.length, productMonthlyRows: productMonthly.length, movementRowsRead: sellerMovementRows, marginBasis: "%Lucro pres. dos movimentos; consolidado ponderado por Base lucro pres." }, brands: [...brands].sort(), brandMonthly, productMonthly, productDaily: productDailyRows, brandPeriods, productPeriods };
  }
  const dashboard: DashboardData = {
    meta: { title: "TRADE PERFORMANCE · J. Cruzeiro", source: file.name, generatedAt: new Date().toISOString(), emittedAt: new Date().toISOString(), availableStart: effectiveMinDate, availableEnd: effectiveMaxDate, recordsImported: records, movementRows, productCount: products.size, transactionCount: metrics(sumRange(overallDaily, effectiveMinDate, effectiveMaxDate)).transactions, categoryCount: categories.size, brandCount: brands.size, comparison, marginBasis: "Lucro presente = Base lucro pres. × %Lucro pres. da linha; margem consolidada = Σ lucro presente ÷ Σ Base lucro pres.", dataCapabilities: { stores: Boolean(sellersPayload), sellers: Boolean(sellersPayload), targets: false, stock: false, tradeSnapshot: false, reason: sellersPayload ? "Vendedores reconhecidos pelo código e vinculados às respectivas lojas; datas obtidas nas movimentações." : "Esta ODS não trouxe agrupadores de vendedor reconhecidos no cadastro atual." } },
    overall, categories: categoryRows, brands: brandRows, topProducts: productRows.slice(0, 100), weekly, monthly,
    daily: {
      overall: [...overallDaily].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => fact(date, value)),
      categories: [...categoryDaily].map(([key, value]) => { const split = key.lastIndexOf("|"); return fact(key.slice(split + 1), value, { categoryCode: key.slice(0, split) }); }),
      brands: [...brandDaily].map(([key, value]) => { const split = key.lastIndexOf("|"); return fact(key.slice(split + 1), value, { brand: key.slice(0, split) }); }),
      categoryBrands: [...categoryBrandDaily].map(([key, value]) => { const last = key.lastIndexOf("|"); const first = key.indexOf("|"); return fact(key.slice(last + 1), value, { categoryCode: key.slice(0, first), brand: key.slice(first + 1, last) }); }),
    },
    quality: { invalidDates, movementsWithoutProduct: withoutProduct, ignoredRows, missingBrandProducts: [...products.values()].filter((p) => p.brand === "Sem marca").length, missingCategoryProducts: [...products.values()].filter((p) => !p.categoryCode).length, duplicateAdmCount: [...descriptions.values()].filter((names) => names.size > 1).length, divergentDescriptions: [...descriptions].filter(([, names]) => names.size > 1).slice(0, 200).map(([adm, names]) => ({ adm, descriptions: [...names].sort() })), notes: ["A própria ODS foi conciliada vendedor a vendedor: subtotais internos, movimentos, lojas, produtos e rede fecharam no mesmo Total líquido.", `Total detalhado antes dos ajustes centesimais: ${detailedTotalBeforeCorrection.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}; total interno conciliado: ${internalControlTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`, "O cadastro de produtos preserva as relações entre categorias, marcas e ADMs.", sellersPayload ? "Lojas e vendedores foram atualizados pelo código do vendedor e pelas datas das movimentações." : "Nenhum vendedor da ODS foi reconhecido no cadastro atual; lojas e vendedores foram preservados.", inferredDates ? `${inferredDates} linhas acumulativas sem data explícita foram posicionadas entre o último pedido fechado anterior e o primeiro pedido fechado seguinte (${sameIntervalDates} no mesmo fechamento; ${bracketChoiceDates} pela proximidade dentro do intervalo). Domingos e feriados permanecem válidos quando delimitam o fechamento.` : "Todas as linhas de movimento trouxeram data explícita.", "Todas as margens foram calculadas exclusivamente a partir da coluna %Lucro pres."] },
  };
  return { dashboard, products: { generatedAt: dashboard.meta.generatedAt, comparison, products: productRows }, sellers: sellersPayload, brandMovements: brandMovementsPayload, metadata: { fileName: file.name, availableStart: effectiveMinDate, availableEnd: closedEnd, totalLiquid: internalControlTotal, recordsImported: records } };
}

function pickTrend(value: Metrics) {
  return { sale: value.sale, quantity: value.quantity, basePresent: value.basePresent, profitPresent: value.profitPresent, transactions: value.transactions };
}

export async function gzipJson(value: unknown, name: string) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const compressed = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new File([await new Response(compressed).blob()], name, { type: "application/json" });
}
