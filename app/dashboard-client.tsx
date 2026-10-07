"use client";

import { Children, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Boxes,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Database,
  Download,
  FileBarChart,
  FileSpreadsheet,
  Gauge,
  Layers3,
  Menu,
  Loader2,
  PackageSearch,
  Percent,
  Printer,
  Search,
  ShieldAlert,
  ShoppingBasket,
  Store,
  Tag,
  Target,
  TrendingDown,
  UploadCloud,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import {
  CartesianGrid,
  Bar,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import {
  HashRouter,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import type {
  BrandMovementData,
  BrandMovementRow,
  Category,
  Comparison,
  DashboardData,
  Filters,
  Metrics,
  Product,
  ProductData,
  ProductMovementRow,
  ProductPeriodRow,
  SellerData,
} from "./types";
import {
  addDays,
  aggregateFacts,
  calcDelta,
  deriveCategories,
  deriveOverall,
  downloadCsv,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  fixedComparisons,
  isDetailedCategory,
  signed,
} from "./utils";

const NAV = [
  ["/", "Visão Geral", Gauge],
  ["/categorias", "Categorias", Layers3],
  ["/lojas", "Lojas", Store],
  ["/marcas", "Marcas", Tag],
  ["/produtos", "Produtos / SKU", PackageSearch],
  ["/vendedores", "Vendedores", Users],
  ["/metas", "Metas", Target],
  ["/trade", "Comparativo Trade", Activity],
  ["/relatorios", "Relatórios", FileBarChart],
  ["/qualidade", "Qualidade dos Dados", Database],
] as const;

const diagnosisColor: Record<string, string> = {
  "Crescimento saudável": "#15a36d",
  "Crescimento com perda de rentabilidade": "#f2aa1f",
  "Margem melhor, mas perda de volume": "#1c64b7",
  "Categoria crítica": "#e2242e",
  Estável: "#8a94a6",
  "Sem base comparativa": "#b5bdc9",
};

async function fetchCompressedJson<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("A base tratada não foi encontrada.");
  const bytes = await response.arrayBuffer();
  const view = new Uint8Array(bytes);
  if (view[0] === 0x1f && view[1] === 0x8b) {
    const decompressed = new Blob([bytes])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    return new Response(decompressed).json() as Promise<T>;
  }
  return JSON.parse(new TextDecoder().decode(view)) as T;
}

const isGitHubPages = () =>
  typeof window !== "undefined" &&
  window.location.hostname.endsWith("github.io");

function publicAssetUrl(path: string) {
  const clean = path.replace(/^\/+/, "");
  return isGitHubPages()
    ? `/trade-performance-jcruzeiro/${clean}`
    : `/${clean}`;
}

async function fetchImportedOrStatic<T>(
  apiUrl: string,
  staticUrl: string,
): Promise<T> {
  if (isGitHubPages()) return fetchCompressedJson<T>(publicAssetUrl(staticUrl));
  try {
    return await fetchCompressedJson<T>(apiUrl, AbortSignal.timeout(2500));
  } catch {
    return fetchCompressedJson<T>(staticUrl);
  }
}

function useProducts(enabled = true) {
  const [data, setData] = useState<ProductData | null>(null);
  useEffect(() => {
    if (!enabled || data) return;
    fetchImportedOrStatic<ProductData>(
      "/api/data/products",
      "/data/products.json.gz",
    ).then((payload) =>
      setData({
        ...payload,
        products: payload.products.map((product) =>
          normalizedUiLabel(product.category) === "SEM CATEGORIA"
            ? { ...product, category: "" }
            : product,
        ),
      }),
    );
  }, [enabled, data]);
  return { data, loading: enabled && !data };
}

function useSellers() {
  const [data, setData] = useState<SellerData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetchImportedOrStatic<SellerData>(
      "/api/data/sellers",
      "/data/sellers.json.gz",
    )
      .then(setData)
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "Erro ao carregar lojas e vendedores.",
        ),
      );
  }, []);
  return { data, error };
}

function useBrandMovements() {
  const [data, setData] = useState<BrandMovementData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetchImportedOrStatic<BrandMovementData>(
      "/api/data/brands",
      "/data/brands.json.gz",
    )
      .then(setData)
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "Erro ao carregar marcas por loja.",
        ),
      );
  }, []);
  return { data, error };
}

function Change({
  value,
  suffix = "%",
  inverse = false,
}: {
  value: number | null;
  suffix?: string;
  inverse?: boolean;
}) {
  if (value == null) return <span className="change neutral">Sem base</span>;
  const positive = inverse ? value <= 0 : value >= 0;
  return (
    <span className={`change ${positive ? "positive" : "negative"}`}>
      {value >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
      {signed(value, suffix)}
    </span>
  );
}

function MetricCard({
  label,
  value,
  previous,
  change,
  icon: Icon,
  tone = "blue",
  subtitle,
  inverse = false,
}: {
  label: string;
  value: string;
  previous?: string;
  change?: number | null;
  icon: typeof Gauge;
  tone?: "blue" | "red" | "green" | "yellow";
  subtitle?: string;
  inverse?: boolean;
}) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-top">
        <span>{label}</span>
        <span className="metric-icon">
          <Icon size={18} />
        </span>
      </div>
      <strong>{value}</strong>
      <div className="metric-bottom">
        {change !== undefined ? (
          <Change value={change} inverse={inverse} />
        ) : (
          <span className="muted-small">{subtitle}</span>
        )}
        {previous && <span className="previous">Anterior: {previous}</span>}
      </div>
    </article>
  );
}

function SectionTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

function AnalysisPair({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="analysis-pair">
      <header className="analysis-pair-heading">
        <div>
          <h2>{title}</h2>
        </div>
        <p>{description}</p>
      </header>
      <div className="analysis-pair-sequence">
        {Children.map(children, (child, index) => (
          <div className="analysis-pair-item" key={index}>
            {child}
          </div>
        ))}
      </div>
    </section>
  );
}

function PeriodBadge({
  comparison,
  code,
}: {
  comparison: Comparison;
  code?: "MTD" | "YTD";
}) {
  return (
    <div className="period-badge">
      <CalendarDays size={16} />
      <span>
        {code && <strong>{code}</strong>}
        <b>
          {formatDate(comparison.currentStart)}–
          {formatDate(comparison.currentEnd)}
        </b>{" "}
        vs. {formatDate(comparison.previousStart)}–
        {formatDate(comparison.previousEnd)}
      </span>
    </div>
  );
}

type PeriodMode = "month" | "year";
type ChartMode = "evolution" | "comparison";
type TrendSource = {
  date: string;
  sale: number;
  basePresent: number;
  profitPresent: number;
  transactions: number;
  quantity?: number;
};

const STORE_FILTERS = [
  {
    name: "Matriz",
    dataName: "Matriz",
    image: publicAssetUrl("/stores/matriz.png"),
    tone: "blue",
  },
  {
    name: "Catedral",
    dataName: "Catedral",
    image: publicAssetUrl("/stores/catedral.png"),
    tone: "red",
  },
  {
    name: "Mineiros",
    dataName: "Mineiros",
    image: publicAssetUrl("/stores/mineiros.png"),
    tone: "yellow",
  },
  {
    name: "Rharo",
    dataName: "Rharo",
    image: publicAssetUrl("/stores/rharo.png"),
    tone: "violet",
  },
  {
    name: "Said Abdala",
    dataName: "Said Abdala",
    image: publicAssetUrl("/stores/said-abdala.png"),
    tone: "orange",
  },
  {
    name: "Rio Verde",
    dataName: "Rio Verde",
    image: publicAssetUrl("/stores/rio-verde.png"),
    tone: "green",
  },
] as const;

function GlobalFilterDock({
  mode,
  setMode,
  selectedStores,
  setSelectedStores,
}: {
  mode: PeriodMode;
  setMode: (mode: PeriodMode) => void;
  selectedStores: string[];
  setSelectedStores: (stores: string[]) => void;
}) {
  const toggleStore = (store: string) => {
    if (selectedStores.includes(store)) {
      if (selectedStores.length === 1) return;
      setSelectedStores(selectedStores.filter((item) => item !== store));
    } else setSelectedStores([...selectedStores, store]);
  };
  const allSelected = selectedStores.length === STORE_FILTERS.length;
  return (
    <section className="global-filter-dock" aria-label="Filtros globais">
      <div className="filter-dock-expanded">
        <div className="filter-dock-title">
          <span>FILTROS</span>
          <small>
            {allSelected
              ? "Todas as unidades"
              : `${selectedStores.length} unidades`}
          </small>
        </div>
        <div
          className="period-selector"
          role="group"
          aria-label="Período da análise"
        >
          <button
            className={mode === "month" ? "active" : ""}
            onClick={() => setMode("month")}
          >
            MÊS
          </button>
          <button
            className={mode === "year" ? "active" : ""}
            onClick={() => setMode("year")}
          >
            ANO
          </button>
        </div>
        <div className="store-filter-grid">
          {STORE_FILTERS.map((store) => {
            const selected = selectedStores.includes(store.dataName);
            return (
              <button
                key={store.dataName}
                className={`store-filter-card ${store.tone}${selected ? " selected" : ""}`}
                aria-pressed={selected}
                onClick={() => toggleStore(store.dataName)}
              >
                <span
                  className="store-filter-photo"
                  style={{ backgroundImage: `url(${store.image})` }}
                />
                <i className="store-filter-check">
                  {selected ? <CheckCircle2 size={14} /> : null}
                </i>
                <b>{store.name}</b>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ChartViewSwitch({
  value,
  onChange,
}: {
  value: ChartMode;
  onChange: (mode: ChartMode) => void;
}) {
  return (
    <div
      className={`chart-view-switch ${value}`}
      role="group"
      aria-label="Modo do gráfico"
    >
      <span className="switch-glider" />
      <button
        className={value === "evolution" ? "active" : ""}
        onClick={() => onChange("evolution")}
      >
        EVOLUÇÃO
      </button>
      <button
        className={value === "comparison" ? "active" : ""}
        onClick={() => onChange("comparison")}
      >
        COMPARATIVO
      </button>
    </div>
  );
}

function aggregateTrendRows(rows: TrendSource[], start: string, end: string) {
  let sale = 0;
  let basePresent = 0;
  let profitPresent = 0;
  let transactions = 0;
  let quantity = 0;
  let hasQuantity = false;
  for (const row of rows) {
    if (row.date < start || row.date > end) continue;
    sale += row.sale;
    basePresent += row.basePresent;
    profitPresent += row.profitPresent;
    transactions += row.transactions;
    if (typeof row.quantity === "number" && Number.isFinite(row.quantity)) {
      quantity += row.quantity;
      hasQuantity = true;
    }
  }
  return {
    sale,
    margin: basePresent ? (profitPresent / basePresent) * 100 : null,
    ticket: transactions ? sale / transactions : null,
    quantity: hasQuantity ? quantity : null,
  };
}

function buildTrendSeries(
  rows: TrendSource[],
  mode: PeriodMode,
  cutoff: string,
) {
  if (mode === "month") {
    const dayCount = Number(cutoff.slice(8, 10));
    const prefix = cutoff.slice(0, 8);
    return Array.from({ length: dayCount }, (_, index) => {
      const date = `${prefix}${String(index + 1).padStart(2, "0")}`;
      return {
        key: date,
        label: formatDate(date).slice(0, 5),
        ...aggregateTrendRows(rows, date, date),
      };
    });
  }
  const endMonth = new Date(`${cutoff.slice(0, 7)}-01T12:00:00Z`);
  return Array.from({ length: endMonth.getUTCMonth() + 1 }, (_, index) => {
    const date = new Date(Date.UTC(endMonth.getUTCFullYear(), index, 1, 12));
    const month = date.toISOString().slice(0, 7);
    const naturalEnd = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    )
      .toISOString()
      .slice(0, 10);
    const end = naturalEnd > cutoff ? cutoff : naturalEnd;
    const label = new Intl.DateTimeFormat("pt-BR", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    })
      .format(date)
      .replace(" de ", "/");
    return {
      key: month,
      label,
      ...aggregateTrendRows(rows, `${month}-01`, end),
    };
  });
}

function buildComparisonTrendSeries(
  rows: TrendSource[],
  mode: PeriodMode,
  cutoff: string,
) {
  const currentYear = Number(cutoff.slice(0, 4));
  const previousYear = currentYear - 1;
  const month = cutoff.slice(5, 7);
  const count = mode === "month" ? Number(cutoff.slice(8, 10)) : Number(month);
  return Array.from({ length: count }, (_, index) => {
    const currentStart =
      mode === "month"
        ? `${currentYear}-${month}-${String(index + 1).padStart(2, "0")}`
        : `${currentYear}-${String(index + 1).padStart(2, "0")}-01`;
    const previousStart =
      mode === "month"
        ? `${previousYear}-${month}-${String(index + 1).padStart(2, "0")}`
        : `${previousYear}-${String(index + 1).padStart(2, "0")}-01`;
    const monthEnd = (year: number, monthIndex: number) =>
      new Date(Date.UTC(year, monthIndex, 0)).toISOString().slice(0, 10);
    const currentEnd =
      mode === "month"
        ? currentStart
        : index + 1 === Number(month)
          ? cutoff
          : monthEnd(currentYear, index + 1);
    const previousEnd =
      mode === "month"
        ? previousStart
        : index + 1 === Number(month)
          ? `${previousYear}-${cutoff.slice(5)}`
          : monthEnd(previousYear, index + 1);
    const current = aggregateTrendRows(rows, currentStart, currentEnd);
    const previous = aggregateTrendRows(rows, previousStart, previousEnd);
    const label =
      mode === "month"
        ? String(index + 1).padStart(2, "0")
        : new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" })
            .format(new Date(`${currentStart}T12:00:00Z`))
            .replace(".", "");
    return {
      key: currentStart,
      label,
      sale: percentDifference(current.sale, previous.sale),
      margin: marginDifferencePp(current.margin, previous.margin),
      ticket: percentDifference(current.ticket, previous.ticket),
      quantity: percentDifference(current.quantity, previous.quantity),
    };
  });
}

function paddedDomain(
  rows: Array<Record<string, unknown>>,
  key: string,
): [number, number] {
  const values = rows
    .map((row) => row[key])
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    );
  if (!values.length) return [-1, 1];
  const min = Math.min(...values),
    max = Math.max(...values);
  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.15, 1);
    return [min - padding, max + padding];
  }
  const padding = (max - min) * 0.14;
  return [min - padding, max + padding];
}

function formatTrendQuantity(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? formatNumber(value)
    : "—";
}

function PerformanceTrendChart({
  rows,
  mode,
  cutoff,
  title = "Desempenho dos quatro indicadores",
}: {
  rows: TrendSource[];
  mode: PeriodMode;
  cutoff: string;
  title?: string;
}) {
  const [chartMode, setChartMode] = useState<ChartMode>("evolution");
  const trend = useMemo(
    () => buildTrendSeries(rows, mode, cutoff),
    [rows, mode, cutoff],
  );
  const comparisonTrend = useMemo(
    () => buildComparisonTrendSeries(rows, mode, cutoff),
    [rows, mode, cutoff],
  );
  const chartData = chartMode === "evolution" ? trend : comparisonTrend;
  const comparative = chartMode === "comparison";
  return (
    <section className="panel universal-trend-panel liquid-chart">
      <SectionTitle
        title={title}
        description={
          comparative
            ? "Diferença entre 2026 e 2025 no mesmo intervalo."
            : mode === "month"
              ? "Dia a dia, do primeiro dia do mês até ontem."
              : "Mês a mês, de janeiro até o mês atual."
        }
        action={<ChartViewSwitch value={chartMode} onChange={setChartMode} />}
      />
      <div className="universal-trend-chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            barCategoryGap="10%"
            margin={{ top: 24, right: 14, bottom: 0, left: 4 }}
          >
            <CartesianGrid stroke="#dbe4ef" vertical={false} />
            <XAxis
              dataKey="label"
              interval={0}
              tick={{ fontSize: 9, fill: "#55657a" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="sale"
              tickFormatter={(value) =>
                comparative
                  ? `${Math.round(value)}%`
                  : `${Math.round(value / 1000)}k`
              }
              tick={{ fontSize: 9, fill: "#55657a" }}
              axisLine={false}
              tickLine={false}
              domain={comparative ? ["auto", "auto"] : [0, "auto"]}
            />
            <YAxis
              yAxisId="margin"
              orientation="right"
              hide
              domain={paddedDomain(chartData, "margin")}
            />
            <YAxis
              yAxisId="ticket"
              orientation="right"
              hide
              domain={paddedDomain(chartData, "ticket")}
            />
            <YAxis
              yAxisId="quantity"
              orientation="right"
              hide
              domain={paddedDomain(chartData, "quantity")}
            />
            {comparative && (
              <ReferenceLine yAxisId="sale" y={0} stroke="#8f9bad" />
            )}
            <Tooltip
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <div className="trend-tooltip">
                    <b>{label}</b>
                    <span>
                      Venda{" "}
                      <strong>
                        {comparative
                          ? signed(
                              Number(
                                payload.find((item) => item.dataKey === "sale")
                                  ?.value ?? 0,
                              ),
                              "%",
                            )
                          : formatCurrency(
                              Number(
                                payload.find((item) => item.dataKey === "sale")
                                  ?.value ?? 0,
                              ),
                              true,
                            )}
                      </strong>
                    </span>
                    <span>
                      Margem{" "}
                      <strong>
                        {comparative
                          ? signed(
                              Number(
                                payload.find(
                                  (item) => item.dataKey === "margin",
                                )?.value ?? 0,
                              ),
                              "%",
                            )
                          : formatPercent(
                              Number(
                                payload.find(
                                  (item) => item.dataKey === "margin",
                                )?.value,
                              ),
                              2,
                            )}
                      </strong>
                    </span>
                    <span>
                      Ticket médio{" "}
                      <strong>
                        {comparative
                          ? signed(
                              Number(
                                payload.find(
                                  (item) => item.dataKey === "ticket",
                                )?.value ?? 0,
                              ),
                              "%",
                            )
                          : formatCurrency(
                              Number(
                                payload.find(
                                  (item) => item.dataKey === "ticket",
                                )?.value ?? 0,
                              ),
                              true,
                            )}
                      </strong>
                    </span>
                    <span>
                      Quantidade{" "}
                      <strong>
                        {comparative
                          ? signed(
                              Number(
                                payload.find(
                                  (item) => item.dataKey === "quantity",
                                )?.value ?? 0,
                              ),
                              "%",
                            )
                          : formatTrendQuantity(
                              payload.find(
                                (item) => item.dataKey === "quantity",
                              )?.value,
                            )}
                      </strong>
                    </span>
                  </div>
                ) : null
              }
            />
            <Bar
              yAxisId="sale"
              dataKey="sale"
              name="Venda"
              fill="#1c64b7"
              radius={[5, 5, 0, 0]}
              maxBarSize={76}
            />
            <Line
              yAxisId="margin"
              type="monotone"
              dataKey="margin"
              name="Margem"
              stroke="#e2242e"
              strokeWidth={3.5}
              dot={{ r: 4, fill: "#e2242e", stroke: "#fff", strokeWidth: 1.5 }}
              activeDot={{ r: 6 }}
              connectNulls
            />
            <Line
              yAxisId="ticket"
              type="monotone"
              dataKey="ticket"
              name="Ticket médio"
              stroke="#15a36d"
              strokeWidth={3.5}
              dot={{ r: 4, fill: "#15a36d", stroke: "#fff", strokeWidth: 1.5 }}
              activeDot={{ r: 6 }}
              connectNulls
            />
            <Line
              yAxisId="quantity"
              type="monotone"
              dataKey="quantity"
              name="Quantidade"
              stroke="#f2b705"
              strokeWidth={3.5}
              dot={{ r: 4, fill: "#f2b705", stroke: "#fff", strokeWidth: 1.5 }}
              activeDot={{ r: 6 }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-key">
        <span>
          <i className="sale" />
          Venda{comparative ? " · var. %" : ""}
        </span>
        <span>
          <i className="margin" />
          Margem{comparative ? " · var. %" : ""}
        </span>
        <span>
          <i className="ticket" />
          Ticket médio{comparative ? " · var. %" : ""}
        </span>
        <span>
          <i className="quantity" />
          Quantidade{comparative ? " · var. %" : ""}
        </span>
      </div>
    </section>
  );
}

type StorePeriodMetrics = {
  sale: number;
  profitPresent: number;
  basePresent: number;
  quantity: number;
  transactions: number;
  margin: number | null;
  ticket: number | null;
};

function aggregateStorePeriod(
  rows: SellerData["storeDaily"],
  start: string,
  end: string,
): StorePeriodMetrics {
  const result = {
    sale: 0,
    profitPresent: 0,
    basePresent: 0,
    quantity: 0,
    transactions: 0,
    margin: null as number | null,
    ticket: null as number | null,
  };
  for (const row of rows) {
    if (row.date < start || row.date > end) continue;
    result.sale += row.sale;
    result.profitPresent += row.profitPresent;
    result.basePresent += row.basePresent;
    result.quantity += row.quantity;
    result.transactions += row.transactions;
  }
  result.margin = result.basePresent
    ? (result.profitPresent / result.basePresent) * 100
    : null;
  result.ticket = result.transactions
    ? result.sale / result.transactions
    : null;
  return result;
}

function aggregateMovementRows(
  rows: Array<BrandMovementRow | ProductMovementRow | ProductPeriodRow>,
): StorePeriodMetrics {
  const result = {
    sale: 0,
    profitPresent: 0,
    basePresent: 0,
    quantity: 0,
    transactions: 0,
    margin: null as number | null,
    ticket: null as number | null,
  };
  for (const row of rows) {
    result.sale += row.sale;
    result.profitPresent += row.profitPresent;
    result.basePresent += row.basePresent;
    result.quantity += row.quantity;
    result.transactions += row.transactions;
  }
  result.margin = result.basePresent
    ? (result.profitPresent / result.basePresent) * 100
    : null;
  result.ticket = result.transactions
    ? result.sale / result.transactions
    : null;
  return result;
}

function storeScopedProducts(
  products: Product[],
  movementData: BrandMovementData | null,
  selectedStores: string[],
  periodKey: "mtd" | "mty",
) {
  const periodRows = movementData?.productPeriods;
  if (!periodRows?.length || selectedStores.length === STORE_FILTERS.length)
    return products;
  const selectedSet = new Set(selectedStores);
  const grouped = new Map<
    string,
    { current: ProductPeriodRow[]; previous: ProductPeriodRow[] }
  >();
  for (const row of periodRows) {
    if (row.period !== periodKey || !selectedSet.has(row.store)) continue;
    const item = grouped.get(row.adm) ?? { current: [], previous: [] };
    item[row.side].push(row);
    grouped.set(row.adm, item);
  }
  return products.flatMap((product) => {
    const rows = grouped.get(product.adm);
    if (!rows) return [];
    const currentScoped = aggregateMovementRows(rows.current);
    const previousScoped = aggregateMovementRows(rows.previous);
    const current = { ...product.periods[periodKey].current, ...currentScoped };
    const previous = {
      ...product.periods[periodKey].previous,
      ...previousScoped,
    };
    return [
      {
        ...product,
        periods: {
          ...product.periods,
          [periodKey]: {
            current,
            previous,
            delta: calcDelta(current, previous),
          },
        },
      },
    ];
  });
}

function aggregateProductPeriodMetrics(
  products: Product[],
  periodKey: "mtd" | "mty",
  side: "current" | "previous",
): Metrics {
  const template = products[0]?.periods[periodKey][side];
  const result = {
    ...(template ?? {
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
    }),
    sale: 0,
    quantity: 0,
    basePresent: 0,
    profitPresent: 0,
    transactions: 0,
  };
  for (const product of products) {
    const item = product.periods[periodKey][side];
    result.sale += item.sale;
    result.quantity += item.quantity;
    result.basePresent += item.basePresent;
    result.profitPresent += item.profitPresent;
    result.transactions += item.transactions;
  }
  result.margin = result.basePresent
    ? (result.profitPresent / result.basePresent) * 100
    : null;
  result.ticket = result.transactions
    ? result.sale / result.transactions
    : null;
  return result;
}

function storeScopedCategories(
  data: DashboardData,
  products: Product[] | null,
  movementData: BrandMovementData | null,
  selectedStores: string[],
  comparison: Comparison,
  periodKey: "mtd" | "mty",
) {
  const base = deriveCategories(
    data,
    { category: "", brand: "", product: "" },
    comparison,
  );
  if (
    !products ||
    !movementData?.productPeriods?.length ||
    selectedStores.length === STORE_FILTERS.length
  )
    return base;
  const scopedProducts = storeScopedProducts(
    products,
    movementData,
    selectedStores,
    periodKey,
  );
  const byCategory = new Map<string, Product[]>();
  for (const product of scopedProducts) {
    const list = byCategory.get(product.categoryCode) ?? [];
    list.push(product);
    byCategory.set(product.categoryCode, list);
  }
  return base
    .flatMap((category) => {
      const categoryProducts = byCategory.get(category.code);
      if (!categoryProducts?.length) return [];
      const current = categoryProducts.reduce(
        (sum, product) => {
          const item = product.periods[periodKey].current;
          sum.sale += item.sale;
          sum.quantity += item.quantity;
          sum.basePresent += item.basePresent;
          sum.profitPresent += item.profitPresent;
          sum.transactions += item.transactions;
          return sum;
        },
        {
          ...category.current,
          sale: 0,
          quantity: 0,
          basePresent: 0,
          profitPresent: 0,
          transactions: 0,
        },
      );
      current.margin = current.basePresent
        ? (current.profitPresent / current.basePresent) * 100
        : null;
      current.ticket = current.transactions
        ? current.sale / current.transactions
        : null;
      const previous = categoryProducts.reduce(
        (sum, product) => {
          const item = product.periods[periodKey].previous;
          sum.sale += item.sale;
          sum.quantity += item.quantity;
          sum.basePresent += item.basePresent;
          sum.profitPresent += item.profitPresent;
          sum.transactions += item.transactions;
          return sum;
        },
        {
          ...category.previous,
          sale: 0,
          quantity: 0,
          basePresent: 0,
          profitPresent: 0,
          transactions: 0,
        },
      );
      previous.margin = previous.basePresent
        ? (previous.profitPresent / previous.basePresent) * 100
        : null;
      previous.ticket = previous.transactions
        ? previous.sale / previous.transactions
        : null;
      return [
        { ...category, current, previous, delta: calcDelta(current, previous) },
      ];
    })
    .sort((a, b) => b.current.sale - a.current.sale);
}

function StoresPage({
  sellerData,
  availableEnd,
  mode,
  selectedStores,
}: {
  sellerData: SellerData | null;
  availableEnd: string;
  mode: PeriodMode;
  selectedStores: string[];
}) {
  if (!sellerData)
    return <LoadingState label="Carregando desempenho das lojas…" />;
  const cutoff =
    sellerData.meta.availableEnd < availableEnd
      ? sellerData.meta.availableEnd
      : availableEnd;
  const comparison =
    mode === "month"
      ? fixedComparisons(cutoff).mtd
      : fixedComparisons(cutoff).mty;
  const selectedSet = new Set(selectedStores);
  const scopedDaily = sellerData.storeDaily.filter((row) =>
    selectedSet.has(row.store),
  );
  const networkCurrent = aggregateStorePeriod(
    scopedDaily,
    comparison.currentStart,
    comparison.currentEnd,
  );
  const networkPrevious = aggregateStorePeriod(
    scopedDaily,
    comparison.previousStart,
    comparison.previousEnd,
  );
  const storeRows = sellerData.stores
    .filter((store) => selectedSet.has(store.name))
    .map((store) => {
      const facts = sellerData.storeDaily.filter(
        (row) => row.store === store.name,
      );
      const current = aggregateStorePeriod(
        facts,
        comparison.currentStart,
        comparison.currentEnd,
      );
      const previous = aggregateStorePeriod(
        facts,
        comparison.previousStart,
        comparison.previousEnd,
      );
      return { name: store.name, current, previous };
    })
    .sort((a, b) => b.current.sale - a.current.sale);
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="eyebrow">
            <span /> PAINEL GERAL DAS LOJAS
          </span>
          <h1>Desempenho por unidade</h1>
          <p>
            Rede e lojas comparadas no mesmo recorte, sempre fechadas até{" "}
            {formatDate(cutoff)}.
          </p>
        </div>
        <span className="data-badge success">
          <CheckCircle2 size={15} /> {sellerData.meta.stores} lojas
        </span>
      </div>
      <section className="network-summary">
        <div className="period-performance-heading">
          <div>
            <span>{mode === "month" ? "MTD" : "YTD"}</span>
            <h2>Resultado da rede</h2>
          </div>
          <PeriodBadge
            code={mode === "month" ? "MTD" : "YTD"}
            comparison={comparison}
          />
        </div>
        <div className="metric-grid">
          <MetricCard
            label="Venda da rede"
            value={formatCurrency(networkCurrent.sale)}
            previous={formatCurrency(networkPrevious.sale)}
            change={percentDifference(
              networkCurrent.sale,
              networkPrevious.sale,
            )}
            icon={CircleDollarSign}
          />
          <MetricCard
            label="Margem da rede"
            value={formatPercent(networkCurrent.margin, 2)}
            previous={formatPercent(networkPrevious.margin, 2)}
            change={marginDifferencePp(
              networkCurrent.margin,
              networkPrevious.margin,
            )}
            icon={Percent}
            tone="red"
          />
          <MetricCard
            label="Ticket médio"
            value={
              networkCurrent.ticket == null
                ? "—"
                : formatCurrency(networkCurrent.ticket)
            }
            previous={
              networkPrevious.ticket == null
                ? "—"
                : formatCurrency(networkPrevious.ticket)
            }
            change={percentDifference(
              networkCurrent.ticket,
              networkPrevious.ticket,
            )}
            icon={ShoppingBasket}
            tone="green"
          />
          <MetricCard
            label="Quantidade"
            value={formatNumber(networkCurrent.quantity)}
            previous={formatNumber(networkPrevious.quantity)}
            change={percentDifference(
              networkCurrent.quantity,
              networkPrevious.quantity,
            )}
            icon={Boxes}
            tone="yellow"
          />
        </div>
      </section>
      <AnalysisPair
        title="Ranking e comparativo das lojas"
        description="Primeiro, consulte os números completos; depois, leia as diferenças no gráfico."
      >
        <section className="panel store-ranking">
          <SectionTitle
            title="Ranking das lojas"
            description={`${mode === "month" ? "MTD" : "YTD"} · quatro indicadores contra 2025.`}
          />
          <div className="table-scroll">
            <table className="simple-table comparison-table">
              <ComparisonTableHead identity={["#", "Loja"]} />
              <tbody>
                {storeRows.map((row, index) => (
                  <tr key={row.name}>
                    <td>{index + 1}º</td>
                    <td>
                      <b>{row.name}</b>
                    </td>
                    <ComparisonMetricCells
                      current={row.current}
                      previous={row.previous}
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <PerformanceComparisonChart
          rows={storeRows}
          title="Comparativo entre lojas"
          description="Venda em barras; margem em vermelho; ticket médio em verde; quantidade em amarelo."
          height={340}
        />
      </AnalysisPair>
      <PerformanceTrendChart
        rows={scopedDaily}
        mode={mode}
        cutoff={cutoff}
        title={
          selectedStores.length === STORE_FILTERS.length
            ? "Desempenho da rede"
            : "Desempenho das unidades selecionadas"
        }
      />
    </>
  );
}

function SellersPage({
  sellerData,
  mode,
  availableEnd,
  selectedStores,
}: {
  sellerData: SellerData | null;
  mode: PeriodMode;
  availableEnd: string;
  selectedStores: string[];
}) {
  const [search, setSearch] = useState("");
  if (!sellerData)
    return <LoadingState label="Carregando ranking de vendedores…" />;
  const cutoff =
    sellerData.meta.availableEnd < availableEnd
      ? sellerData.meta.availableEnd
      : availableEnd;
  const comparison =
    mode === "month"
      ? fixedComparisons(cutoff).mtd
      : fixedComparisons(cutoff).mty;
  const selectedSet = new Set(selectedStores);
  const daily = (sellerData.sellerDaily ?? []).filter((row) =>
    selectedSet.has(row.store),
  );
  const sellerKeys = [
    ...new Set(daily.map((row) => `${row.store}|${row.code}|${row.name}`)),
  ];
  const rows = sellerKeys
    .map((key) => {
      const [store, code, name] = key.split("|");
      const facts = daily.filter(
        (row) => row.store === store && row.code === code,
      );
      return {
        store,
        code,
        name,
        current: aggregateStorePeriod(
          facts,
          comparison.currentStart,
          comparison.currentEnd,
        ),
        previous: aggregateStorePeriod(
          facts,
          comparison.previousStart,
          comparison.previousEnd,
        ),
      };
    })
    .filter(
      (row) =>
        !search ||
        `${row.name} ${row.code} ${row.store}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => b.current.sale - a.current.sale);
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="eyebrow">
            <span /> PERFORMANCE COMERCIAL
          </span>
          <h1>Vendedores</h1>
          <p>
            Ranking recalculado com venda, margem, ticket médio e quantidade.
          </p>
        </div>
        <span className="data-badge">
          <Users size={15} /> {sellerData.meta.sellers} vendedores
        </span>
      </div>
      <AnalysisPair
        title="Ranking e evolução dos vendedores"
        description="A tabela detalha o desempenho individual; o gráfico apresenta a evolução consolidada da equipe."
      >
        <section className="panel">
          <div className="products-toolbar">
            <label className="search-box large">
              <Search size={17} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Pesquisar vendedor, código ou loja"
              />
            </label>
          </div>
          <div className="table-scroll">
            <table className="simple-table comparison-table">
              <ComparisonTableHead identity={["Posição", "Vendedor", "Loja"]} />
              <tbody>
                {rows.slice(0, 150).map((seller, index) => (
                  <tr key={`${seller.store}-${seller.code}`}>
                    <td>{index + 1}º</td>
                    <td>
                      <b>{seller.name}</b>
                      <small>Cód. {seller.code}</small>
                    </td>
                    <td>{seller.store}</td>
                    <ComparisonMetricCells
                      current={seller.current}
                      previous={seller.previous}
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <PerformanceTrendChart
          rows={daily.length ? daily : sellerData.storeDaily}
          mode={mode}
          cutoff={cutoff}
          title="Evolução da equipe comercial"
        />
      </AnalysisPair>
    </>
  );
}

type PeriodResult = ReturnType<typeof deriveOverall>;
type PeriodPerformanceResult = {
  current: Pick<Metrics, "sale" | "margin" | "ticket" | "quantity">;
  previous: Pick<Metrics, "sale" | "margin" | "ticket" | "quantity">;
  delta: Pick<
    ReturnType<typeof calcDelta>,
    "salePercent" | "marginPp" | "ticketPercent" | "quantityPercent"
  >;
};

function PeriodPerformance({
  result,
  comparison,
  mode,
  title = "Resultado consolidado",
}: {
  result: PeriodPerformanceResult;
  comparison: Comparison;
  mode: PeriodMode;
  title?: string;
}) {
  return (
    <section className="period-performance-block">
      <div className="period-performance-heading">
        <div>
          <span>{mode === "month" ? "MTD" : "YTD"}</span>
          <h2>{title}</h2>
        </div>
        <PeriodBadge
          code={mode === "month" ? "MTD" : "YTD"}
          comparison={comparison}
        />
      </div>
      <div className="metric-grid">
        <MetricCard
          label="Venda líquida"
          value={formatCurrency(result.current.sale)}
          previous={formatCurrency(result.previous.sale)}
          change={result.delta.salePercent}
          icon={CircleDollarSign}
        />
        <MetricCard
          label="Margem"
          value={formatPercent(result.current.margin, 2)}
          previous={formatPercent(result.previous.margin, 2)}
          change={result.delta.marginPp}
          icon={Percent}
          tone="red"
        />
        <MetricCard
          label="Ticket médio"
          value={
            result.current.ticket == null
              ? "—"
              : formatCurrency(result.current.ticket)
          }
          previous={
            result.previous.ticket == null
              ? "—"
              : formatCurrency(result.previous.ticket)
          }
          change={result.delta.ticketPercent}
          icon={ShoppingBasket}
          tone="green"
        />
        <MetricCard
          label="Quantidade"
          value={formatNumber(result.current.quantity)}
          previous={formatNumber(result.previous.quantity)}
          change={result.delta.quantityPercent}
          icon={Boxes}
          tone="yellow"
        />
      </div>
    </section>
  );
}

type ComparisonMetrics = Pick<
  Metrics,
  "sale" | "margin" | "ticket" | "quantity"
>;
type ComparisonChartRow = {
  name: string;
  current: ComparisonMetrics;
  previous: ComparisonMetrics;
};

function percentDifference(current: number | null, previous: number | null) {
  return current == null || previous == null || previous === 0
    ? null
    : (current / previous - 1) * 100;
}

function normalizedUiLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function marginDifferencePp(current: number | null, previous: number | null) {
  return current == null || previous == null ? null : current - previous;
}

type ComparableMetrics = Pick<
  Metrics,
  "sale" | "margin" | "ticket" | "quantity"
>;

const comparisonGroups = [
  ["sale", "Venda"],
  ["margin", "Margem"],
  ["ticket", "Ticket médio"],
  ["quantity", "Quantidade"],
] as const;

function ComparisonTableHead({ identity }: { identity: string[] }) {
  return (
    <thead className="comparison-table-head">
      <tr>
        {identity.map((label) => (
          <th key={label} rowSpan={2}>
            {label}
          </th>
        ))}
        {comparisonGroups.map(([key, label]) => (
          <th key={key} colSpan={3} className={`metric-group-title ${key}`}>
            {label}
          </th>
        ))}
      </tr>
      <tr>
        {comparisonGroups.flatMap(([key]) => [
          <th
            key={`${key}-previous`}
            className={`metric-subhead metric-start ${key}`}
          >
            2025
          </th>,
          <th key={`${key}-current`} className={`metric-subhead ${key}`}>
            2026
          </th>,
          <th key={`${key}-variation`} className={`metric-subhead ${key}`}>
            Variação %
          </th>,
        ])}
      </tr>
    </thead>
  );
}

function ComparisonMetricCells({
  current,
  previous,
}: {
  current: ComparableMetrics;
  previous: ComparableMetrics;
}) {
  const saleVariation = percentDifference(current.sale, previous.sale);
  const marginVariation = marginDifferencePp(current.margin, previous.margin);
  const ticketVariation = percentDifference(current.ticket, previous.ticket);
  const quantityVariation = percentDifference(
    current.quantity,
    previous.quantity,
  );
  return (
    <>
      <td className="metric-cell metric-start sale">
        {formatCurrency(previous.sale, true)}
      </td>
      <td className="metric-cell sale">
        <b>{formatCurrency(current.sale, true)}</b>
      </td>
      <td className="metric-cell sale">
        <Change value={saleVariation} />
      </td>
      <td className="metric-cell metric-start margin">
        {formatPercent(previous.margin, 2)}
      </td>
      <td className="metric-cell margin">
        <b>{formatPercent(current.margin, 2)}</b>
      </td>
      <td className="metric-cell margin">
        <Change value={marginVariation} />
      </td>
      <td className="metric-cell metric-start ticket">
        {previous.ticket == null ? "—" : formatCurrency(previous.ticket, true)}
      </td>
      <td className="metric-cell ticket">
        <b>
          {current.ticket == null ? "—" : formatCurrency(current.ticket, true)}
        </b>
      </td>
      <td className="metric-cell ticket">
        <Change value={ticketVariation} />
      </td>
      <td className="metric-cell metric-start quantity">
        {formatNumber(previous.quantity)}
      </td>
      <td className="metric-cell quantity">
        <b>{formatNumber(current.quantity)}</b>
      </td>
      <td className="metric-cell quantity">
        <Change value={quantityVariation} />
      </td>
    </>
  );
}

function metricColumnClass(id: string) {
  const value = id.toLowerCase();
  if (value.includes("sale"))
    return `metric-column sale${value.includes("previous") ? " metric-start" : ""}`;
  if (value.includes("margin"))
    return `metric-column margin${value.includes("previous") ? " metric-start" : ""}`;
  if (value.includes("ticket"))
    return `metric-column ticket${value.includes("previous") ? " metric-start" : ""}`;
  if (value.includes("quantity"))
    return `metric-column quantity${value.includes("previous") ? " metric-start" : ""}`;
  return "identity-column";
}

function ComparisonTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{
    payload?: ComparisonChartRow & {
      saleDiff: number | null;
      marginDiff: number | null;
      ticketDiff: number | null;
      quantityDiff: number | null;
    };
  }>;
  label?: string;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="comparison-tooltip">
      <b>{label ?? row.name}</b>
      <table>
        <thead>
          <tr>
            <th>Indicador</th>
            <th>2025</th>
            <th>2026</th>
            <th>Dif.</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Venda</td>
            <td>{formatCurrency(row.previous.sale, true)}</td>
            <td>{formatCurrency(row.current.sale, true)}</td>
            <td>
              <Change value={row.saleDiff} />
            </td>
          </tr>
          <tr>
            <td>Margem</td>
            <td>{formatPercent(row.previous.margin, 2)}</td>
            <td>{formatPercent(row.current.margin, 2)}</td>
            <td>
              <Change value={row.marginDiff} />
            </td>
          </tr>
          <tr>
            <td>Ticket médio</td>
            <td>
              {row.previous.ticket == null
                ? "—"
                : formatCurrency(row.previous.ticket, true)}
            </td>
            <td>
              {row.current.ticket == null
                ? "—"
                : formatCurrency(row.current.ticket, true)}
            </td>
            <td>
              <Change value={row.ticketDiff} />
            </td>
          </tr>
          <tr>
            <td>Quantidade</td>
            <td>{formatNumber(row.previous.quantity)}</td>
            <td>{formatNumber(row.current.quantity)}</td>
            <td>
              <Change value={row.quantityDiff} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function PerformanceComparisonChart({
  rows,
  title,
  description,
  height = 360,
  hideTitle = false,
}: {
  rows: ComparisonChartRow[];
  title: string;
  description: string;
  height?: number;
  hideTitle?: boolean;
}) {
  const [chartMode, setChartMode] = useState<ChartMode>("comparison");
  const comparative = chartMode === "comparison";
  const data = rows.map((row) => {
    const marginDiff = marginDifferencePp(
      row.current.margin,
      row.previous.margin,
    );
    return {
      ...row,
      saleDiff: comparative
        ? percentDifference(row.current.sale, row.previous.sale)
        : row.current.sale,
      marginDiff: comparative ? marginDiff : row.current.margin,
      ticketDiff: comparative
        ? percentDifference(row.current.ticket, row.previous.ticket)
        : row.current.ticket,
      quantityDiff: comparative
        ? percentDifference(row.current.quantity, row.previous.quantity)
        : row.current.quantity,
    };
  });
  return (
    <section className="panel comparison-chart-panel liquid-chart">
      {hideTitle ? (
        <div className="chart-switch-only">
          <ChartViewSwitch value={chartMode} onChange={setChartMode} />
        </div>
      ) : (
        <SectionTitle
          title={title}
          description={
            comparative
              ? description
              : "Valores consolidados de 2026 no período selecionado."
          }
          action={<ChartViewSwitch value={chartMode} onChange={setChartMode} />}
        />
      )}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            barCategoryGap="10%"
            margin={{
              top: 32,
              right: 18,
              bottom: rows.length > 10 ? 58 : 12,
              left: 4,
            }}
          >
            <CartesianGrid stroke="#dbe4ef" vertical={false} />
            <XAxis
              dataKey="name"
              interval={0}
              angle={rows.length > 10 ? -35 : 0}
              textAnchor={rows.length > 10 ? "end" : "middle"}
              height={rows.length > 10 ? 72 : 32}
              tick={{ fontSize: 8.5, fill: "#55657a" }}
            />
            <YAxis
              yAxisId="sale"
              tickFormatter={(value) =>
                comparative
                  ? `${Math.round(value)}%`
                  : `${Math.round(value / 1000)}k`
              }
              tick={{ fontSize: 9, fill: "#55657a" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="margin"
              orientation="right"
              hide
              domain={paddedDomain(data, "marginDiff")}
            />
            <YAxis
              yAxisId="ticket"
              orientation="right"
              hide
              domain={paddedDomain(data, "ticketDiff")}
            />
            <YAxis
              yAxisId="quantity"
              orientation="right"
              hide
              domain={paddedDomain(data, "quantityDiff")}
            />
            {comparative && (
              <ReferenceLine yAxisId="sale" y={0} stroke="#8f9bad" />
            )}
            <Tooltip
              cursor={{ fill: "rgb(28 100 183 / 5%)" }}
              content={(props) =>
                comparative ? (
                  <ComparisonTooltip {...props} />
                ) : props.active && props.payload?.length ? (
                  <div className="trend-tooltip">
                    <b>{props.label}</b>
                    <span>
                      Venda{" "}
                      <strong>
                        {formatCurrency(
                          Number(
                            props.payload.find(
                              (item) => item.dataKey === "saleDiff",
                            )?.value ?? 0,
                          ),
                          true,
                        )}
                      </strong>
                    </span>
                    <span>
                      Margem{" "}
                      <strong>
                        {formatPercent(
                          Number(
                            props.payload.find(
                              (item) => item.dataKey === "marginDiff",
                            )?.value,
                          ),
                          2,
                        )}
                      </strong>
                    </span>
                    <span>
                      Ticket médio{" "}
                      <strong>
                        {formatCurrency(
                          Number(
                            props.payload.find(
                              (item) => item.dataKey === "ticketDiff",
                            )?.value ?? 0,
                          ),
                          true,
                        )}
                      </strong>
                    </span>
                    <span>
                      Quantidade{" "}
                      <strong>
                        {formatTrendQuantity(
                          props.payload.find(
                            (item) => item.dataKey === "quantityDiff",
                          )?.value,
                        )}
                      </strong>
                    </span>
                  </div>
                ) : null
              }
            />
            <Bar
              yAxisId="sale"
              dataKey="saleDiff"
              name="Venda"
              fill="#1c64b7"
              radius={[5, 5, 0, 0]}
              maxBarSize={82}
            />
            <Line
              yAxisId="margin"
              type="monotone"
              dataKey="marginDiff"
              name="Margem"
              stroke="#e2242e"
              strokeWidth={3.5}
              dot={{ r: 4, fill: "#e2242e", stroke: "#fff", strokeWidth: 1.5 }}
              activeDot={{ r: 6 }}
              connectNulls
            />
            <Line
              yAxisId="ticket"
              type="monotone"
              dataKey="ticketDiff"
              name="Ticket médio"
              stroke="#15a36d"
              strokeWidth={3.5}
              dot={{ r: 4, fill: "#15a36d", stroke: "#fff", strokeWidth: 1.5 }}
              activeDot={{ r: 6 }}
              connectNulls
            />
            <Line
              yAxisId="quantity"
              type="monotone"
              dataKey="quantityDiff"
              name="Quantidade"
              stroke="#f2b705"
              strokeWidth={3.5}
              dot={{ r: 4, fill: "#f2b705", stroke: "#fff", strokeWidth: 1.5 }}
              activeDot={{ r: 6 }}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-key">
        <span>
          <i className="sale" />
          Venda{comparative ? " · var. %" : ""}
        </span>
        <span>
          <i className="margin" />
          Margem{comparative ? " · var. %" : ""}
        </span>
        <span>
          <i className="ticket" />
          Ticket médio{comparative ? " · var. %" : ""}
        </span>
        <span>
          <i className="quantity" />
          Quantidade{comparative ? " · var. %" : ""}
        </span>
      </div>
    </section>
  );
}

function Overview({
  data,
  mode,
  comparison,
  sellerData,
  products,
  movementData,
  selectedStores,
}: {
  data: DashboardData;
  mode: PeriodMode;
  comparison: Comparison;
  sellerData: SellerData | null;
  products: Product[] | null;
  movementData: BrandMovementData | null;
  selectedStores: string[];
}) {
  const navigate = useNavigate();
  const emptyFilters = { category: "", brand: "", product: "" };
  const selectedSet = new Set(selectedStores);
  const scopedStoreDaily = (sellerData?.storeDaily ?? []).filter((row) =>
    selectedSet.has(row.store),
  );
  const networkResult = deriveOverall(data, emptyFilters, comparison);
  const scopedCurrent = aggregateStorePeriod(
    scopedStoreDaily,
    comparison.currentStart,
    comparison.currentEnd,
  );
  const scopedPrevious = aggregateStorePeriod(
    scopedStoreDaily,
    comparison.previousStart,
    comparison.previousEnd,
  );
  const result: PeriodPerformanceResult = sellerData
    ? {
        current: scopedCurrent,
        previous: scopedPrevious,
        delta: {
          salePercent: percentDifference(
            scopedCurrent.sale,
            scopedPrevious.sale,
          ),
          marginPp: marginDifferencePp(
            scopedCurrent.margin,
            scopedPrevious.margin,
          ),
          ticketPercent: percentDifference(
            scopedCurrent.ticket,
            scopedPrevious.ticket,
          ),
          quantityPercent: percentDifference(
            scopedCurrent.quantity,
            scopedPrevious.quantity,
          ),
        },
      }
    : networkResult;
  const categories = useMemo(
    () =>
      storeScopedCategories(
        data,
        products,
        movementData,
        selectedStores,
        comparison,
        mode === "month" ? "mtd" : "mty",
      ),
    [data, products, movementData, selectedStores, comparison, mode],
  );
  return (
    <>
      <div className="page-intro overview-intro">
        <div>
          <span className="eyebrow">
            <span /> CENTRAL DE PERFORMANCE
          </span>
          <h1>Visão Geral</h1>
          <p>
            Overview da rede sem filtros, atualizado pelo período selecionado.
          </p>
        </div>
        <span className="data-badge success">
          <CheckCircle2 size={15} /> Fechado até{" "}
          {formatDate(data.meta.availableEnd)}
        </span>
      </div>
      <PeriodPerformance
        result={result}
        comparison={comparison}
        mode={mode}
        title="Resultado da rede"
      />
      <AnalysisPair
        title="Categorias que mais movimentam a rede"
        description="Consulte primeiro o comparativo completo e use o gráfico abaixo para identificar rapidamente as maiores diferenças."
      >
        <section className="panel overview-pair-table">
          <div className="overview-table-action">
            <button
              className="text-button"
              onClick={() => navigate("/categorias")}
            >
              Ver todas <ArrowRight size={15} />
            </button>
          </div>
          <div className="table-scroll">
            <table className="simple-table comparison-table">
              <ComparisonTableHead identity={["Categoria"]} />
              <tbody>
                {categories.slice(0, 8).map((row) => (
                  <tr
                    key={row.code}
                    onClick={() => navigate(`/categorias/${row.code}`)}
                  >
                    <td>
                      <b>{row.name}</b>
                      <small>{row.code}</small>
                    </td>
                    <ComparisonMetricCells
                      current={row.current}
                      previous={row.previous}
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <PerformanceComparisonChart
          rows={categories.slice(0, 12)}
          title="Performance das principais categorias"
          description="Venda, margem, ticket médio e quantidade, sempre em variação contra 2025."
          height={390}
          hideTitle
        />
      </AnalysisPair>
      <PerformanceTrendChart
        rows={sellerData ? scopedStoreDaily : data.daily.overall}
        mode={mode}
        cutoff={data.meta.availableEnd}
        title={
          selectedStores.length === STORE_FILTERS.length
            ? "Desempenho da rede"
            : "Desempenho das unidades selecionadas"
        }
      />
    </>
  );
}

function CategoryComparisonTable({
  rows,
  onOpen,
}: {
  rows: Category[];
  onOpen: (code: string) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="simple-table comparison-table consolidated-category-table">
        <ComparisonTableHead identity={["Categoria"]} />
        <tbody>
          {rows.map((row) => (
            <tr key={row.code} onClick={() => onOpen(row.code)}>
              <td>
                <div className="category-name">
                  <span className="code-pill">{row.code}</span>
                  <b>{row.name}</b>
                </div>
              </td>
              <ComparisonMetricCells
                current={row.current}
                previous={row.previous}
              />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CategoriesPage({
  data,
  products,
  movementData,
  mode,
  comparison,
  selectedStores,
}: {
  data: DashboardData;
  products: Product[] | null;
  movementData: BrandMovementData | null;
  mode: PeriodMode;
  comparison: Comparison;
  selectedStores: string[];
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const allRows = useMemo(
    () =>
      storeScopedCategories(
        data,
        products,
        movementData,
        selectedStores,
        comparison,
        mode === "month" ? "mtd" : "mty",
      ),
    [data, products, movementData, selectedStores, comparison, mode],
  );
  const rows = allRows.filter(
    (row) =>
      !search ||
      `${row.code} ${row.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="eyebrow">
            <span /> PORTFÓLIO COMERCIAL
          </span>
          <h1>Categorias</h1>
          <p>Tabela consolidada primeiro e leitura gráfica logo abaixo.</p>
        </div>
        <span className="data-badge success">
          <CheckCircle2 size={15} /> {mode === "month" ? "MTD" : "YTD"}
        </span>
      </div>
      <section className="scoped-search-panel">
        <label className="search-box large">
          <Search size={18} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pesquisar categoria"
          />
        </label>
      </section>
      <AnalysisPair
        title="Desempenho consolidado das categorias"
        description="Os números detalhados e a leitura visual permanecem juntos, na mesma sequência em todas as análises."
      >
        <section className="panel">
          <SectionTitle
            title="Tabela consolidada"
            description={`${rows.length} categorias no período selecionado. Clique em uma linha para detalhar.`}
          />
          <CategoryComparisonTable
            rows={rows}
            onOpen={(code) => navigate(`/categorias/${code}`)}
          />
        </section>
        <PerformanceComparisonChart
          rows={rows}
          title="Performance de cada grupo"
          description="Venda, margem, ticket médio e quantidade; valores representam a diferença contra 2025."
          height={430}
        />
      </AnalysisPair>
    </>
  );
}

function CategoryDetail({
  data,
  products,
  movementData = null,
  selectedStores = STORE_FILTERS.map((store) => store.dataName),
  mode,
  comparison,
}: {
  data: DashboardData;
  products: Product[] | null;
  movementData?: BrandMovementData | null;
  selectedStores?: string[];
  mode: PeriodMode;
  comparison: Comparison;
}) {
  const { code } = useParams();
  const navigate = useNavigate();
  const source = data.categories.find((item) => item.code === code);
  if (!source)
    return (
      <EmptyState
        title="Categoria não encontrada"
        description="O código solicitado não existe na base atual."
      />
    );
  if (!isDetailedCategory(source.name))
    return (
      <EmptyState
        title="Categoria incluída apenas nos totais"
        description="Esta categoria compõe o resultado da rede e das lojas, mas não possui análise detalhada."
      />
    );
  const periodKey = mode === "month" ? "mtd" : "mty";
  const scopedCategoryRows = storeScopedCategories(
    data,
    products,
    movementData,
    selectedStores,
    comparison,
    periodKey,
  );
  const category =
    scopedCategoryRows.find((item) => item.code === source.code) ??
    deriveCategories(
      data,
      { category: source.code, brand: "", product: "" },
      comparison,
    )[0] ??
    source;
  const categoryFacts = data.daily.categories.filter(
    (fact) => fact.categoryCode === code,
  );
  const scopedProductRows = storeScopedProducts(
    products ?? data.topProducts,
    movementData,
    selectedStores,
    periodKey,
  );
  const allCategoryProducts = scopedProductRows.filter(
    (product) => product.categoryCode === code,
  );
  const categoryProducts = [...allCategoryProducts]
    .sort(
      (a, b) =>
        b.periods[periodKey].current.sale - a.periods[periodKey].current.sale,
    )
    .slice(0, 50);
  const brandNames = [
    ...new Set(
      allCategoryProducts.map((product) => product.brand).filter(Boolean),
    ),
  ];
  const brandRows = brandNames
    .map((name) => {
      const brandProducts = allCategoryProducts.filter(
        (product) => product.brand === name,
      );
      return {
        name,
        current: aggregateProductPeriodMetrics(
          brandProducts,
          periodKey,
          "current",
        ),
        previous: aggregateProductPeriodMetrics(
          brandProducts,
          periodKey,
          "previous",
        ),
      };
    })
    .filter((row) => row.current.sale || row.previous.sale)
    .sort((a, b) => b.current.sale - a.current.sale);
  const productChartRows = categoryProducts
    .slice(0, 10)
    .map((product) => ({
      name: product.description,
      current: product.periods[periodKey].current,
      previous: product.periods[periodKey].previous,
    }));
  const openBrand = (name: string) =>
    navigate(`/marcas?marca=${encodeURIComponent(name)}`);
  const openProduct = (adm: string) =>
    navigate(`/produtos?produto=${encodeURIComponent(adm)}`);
  return (
    <>
      <button className="back-button" onClick={() => navigate(-1)}>
        <ArrowLeft size={16} /> Voltar
      </button>
      <div className="page-intro">
        <div>
          <span className="eyebrow">
            <span /> CATEGORIA {source.code}
          </span>
          <h1>{source.name}</h1>
          <p>
            Venda, margem, ticket médio e quantidade atualizados pelo período
            selecionado.
          </p>
        </div>
        <span
          className="diagnosis large"
          style={
            {
              "--diagnosis": diagnosisColor[category.diagnosis],
            } as React.CSSProperties
          }
        >
          {category.diagnosis}
        </span>
      </div>
      <PeriodPerformance
        result={category}
        comparison={comparison}
        mode={mode}
        title="Resultado da categoria"
      />
      <PerformanceTrendChart
        rows={categoryFacts}
        mode={mode}
        cutoff={data.meta.availableEnd}
      />
      <AnalysisPair
        title="Marcas vinculadas à categoria"
        description="A tabela completa precede o gráfico comparativo das principais marcas."
      >
        <section className="panel">
          <SectionTitle
            title="Marcas vinculadas à categoria"
            description={`${brandRows.length} marcas consolidadas. Clique em uma marca para abrir sua análise completa.`}
          />
          <div className="table-scroll">
            <table className="simple-table comparison-table interactive-table">
              <ComparisonTableHead identity={["Marca"]} />
              <tbody>
                {brandRows.map((brand) => (
                  <tr key={brand.name} onClick={() => openBrand(brand.name)}>
                    <td>
                      <b>{brand.name}</b>
                      <small>
                        Abrir desempenho da marca <ArrowRight size={12} />
                      </small>
                    </td>
                    <ComparisonMetricCells
                      current={brand.current}
                      previous={brand.previous}
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <PerformanceComparisonChart
          rows={brandRows.slice(0, 12)}
          title="Gráfico das marcas vinculadas"
          description="Comparativo de venda, margem, ticket médio e quantidade contra 2025."
          height={380}
        />
      </AnalysisPair>
      <AnalysisPair
        title="Ranking de produtos da categoria"
        description="A relação detalhada fica imediatamente ligada ao gráfico dos produtos com maior venda."
      >
        <section className="panel">
          <SectionTitle
            title="Ranking de produtos da categoria"
            description={`${mode === "month" ? "MTD" : "YTD"} · ${categoryProducts.length} produtos ordenados pela venda de 2026. Clique para abrir o produto.`}
          />
          <div className="table-scroll">
            <table className="simple-table comparison-table interactive-table product-ranking-table">
              <ComparisonTableHead
                identity={["Ranking", "ADM", "Produto", "Marca"]}
              />
              <tbody>
                {categoryProducts.map((product, index) => {
                  const period = product.periods[periodKey];
                  return (
                    <tr
                      key={product.adm}
                      onClick={() => openProduct(product.adm)}
                    >
                      <td className="product-rank">{index + 1}º</td>
                      <td>
                        <span className="code-pill">{product.adm}</span>
                      </td>
                      <td>
                        <b>{product.description}</b>
                        <small>
                          {product.group} · abrir produto{" "}
                          <ArrowRight size={12} />
                        </small>
                      </td>
                      <td>{product.brand}</td>
                      <ComparisonMetricCells
                        current={period.current}
                        previous={period.previous}
                      />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <PerformanceComparisonChart
          rows={productChartRows}
          title="Top 10 produtos da categoria"
          description="Os 10 produtos com maior venda em 2026, comparados ao mesmo período de 2025."
          height={430}
        />
      </AnalysisPair>
    </>
  );
}

function LegacyBrandsPage({ data }: { data: DashboardData }) {
  const { data: movementData, error } = useBrandMovements();
  const [brandInput, setBrandInput] = useState("");
  const [brandSearch, setBrandSearch] = useState("");
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [selectedStore, setSelectedStore] = useState("");
  const [productInput, setProductInput] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const cutoff = movementData
    ? movementData.meta.availableEnd < data.meta.availableEnd
      ? movementData.meta.availableEnd
      : data.meta.availableEnd
    : data.meta.availableEnd;
  const last12Months = useMemo(() => {
    const end = new Date(`${cutoff.slice(0, 7)}-01T12:00:00Z`);
    return Array.from({ length: 12 }, (_, index) => {
      const date = new Date(end);
      date.setUTCMonth(date.getUTCMonth() - (11 - index));
      return date.toISOString().slice(0, 7);
    });
  }, [cutoff]);
  const defaultBrand = useMemo(() => {
    if (!movementData) return "";
    const totals = new Map<string, number>();
    for (const row of movementData.brandMonthly) {
      if (!last12Months.includes(row.month)) continue;
      totals.set(row.brand, (totals.get(row.brand) ?? 0) + row.sale);
    }
    return (
      [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      movementData.brands[0] ??
      ""
    );
  }, [movementData, last12Months]);
  const activeBrands = selectedBrands.length
    ? selectedBrands
    : defaultBrand
      ? [defaultBrand]
      : [];
  if (error)
    return (
      <EmptyState
        title="Não foi possível abrir as marcas por loja"
        description={error}
      />
    );
  if (!movementData || !activeBrands.length)
    return <LoadingState label="Carregando marcas, lojas e produtos…" />;
  const activeBrandSet = new Set(activeBrands);
  const matchingBrands = movementData.brands
    .filter((brand) => brand.toLowerCase().includes(brandSearch.toLowerCase()))
    .slice(0, 12);
  const toggleBrand = (brand: string) => {
    setSelectedBrands((current) => {
      const base = current.length
        ? current
        : defaultBrand
          ? [defaultBrand]
          : [];
      if (base.includes(brand))
        return base.length === 1 ? base : base.filter((item) => item !== brand);
      return [...base, brand];
    });
    setBrandInput(brand);
    setSelectedStore("");
    setProductInput("");
    setProductSearch("");
  };
  const runBrandSearch = () => {
    const query = brandInput.trim();
    setBrandSearch(query);
    const exact = movementData.brands.find(
      (brand) => brand.toLowerCase() === query.toLowerCase(),
    );
    if (exact && !activeBrandSet.has(exact)) toggleBrand(exact);
  };
  const selectedBrandRows = movementData.brandMonthly.filter(
    (row) => activeBrandSet.has(row.brand) && last12Months.includes(row.month),
  );
  const overall = aggregateMovementRows(selectedBrandRows);
  const trend = last12Months.map((month) => {
    const metrics = aggregateMovementRows(
      selectedBrandRows.filter((row) => row.month === month),
    );
    return {
      month,
      label: new Intl.DateTimeFormat("pt-BR", {
        month: "short",
        year: "2-digit",
        timeZone: "UTC",
      })
        .format(new Date(`${month}-01T12:00:00Z`))
        .replace(" de ", "/"),
      ...metrics,
    };
  });
  const stores = [
    "Matriz",
    "Catedral",
    "Mineiros",
    "Rharo",
    "Said Abdala",
    "Rio Verde",
  ]
    .map((store) => ({
      store,
      metrics: aggregateMovementRows(
        selectedBrandRows.filter((row) => row.store === store),
      ),
    }))
    .sort((a, b) => b.metrics.sale - a.metrics.sale);
  const productRows = movementData.productMonthly.filter(
    (row) =>
      activeBrandSet.has(row.brand) &&
      last12Months.includes(row.month) &&
      (!selectedStore || row.store === selectedStore),
  );
  const productScopeTotal = aggregateMovementRows(productRows).sale;
  const productMap = new Map<
    string,
    {
      adm: string;
      brand: string;
      description: string;
      rows: ProductMovementRow[];
    }
  >();
  for (const row of productRows) {
    const key = `${row.brand}|${row.adm}`;
    const current = productMap.get(key) ?? {
      adm: row.adm,
      brand: row.brand,
      description: row.description,
      rows: [],
    };
    current.rows.push(row);
    productMap.set(key, current);
  }
  const products = [...productMap.values()]
    .map((product) => ({
      ...product,
      metrics: aggregateMovementRows(product.rows),
    }))
    .filter(
      (product) =>
        !productSearch ||
        `${product.adm} ${product.description} ${product.brand}`
          .toLowerCase()
          .includes(productSearch.toLowerCase()),
    )
    .sort((a, b) => b.metrics.sale - a.metrics.sale)
    .slice(0, 100);
  const selectionTitle =
    activeBrands.length === 1
      ? activeBrands[0]
      : `${activeBrands.length} marcas selecionadas`;
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="eyebrow">
            <span /> INDÚSTRIAS E FORNECEDORES
          </span>
          <h1>Marcas</h1>
          <p>
            Selecione uma ou mais marcas para acompanhar o montante, a evolução,
            as lojas e os produtos.
          </p>
        </div>
        <span className="data-badge">
          <Tag size={15} /> {movementData.meta.brands} marcas com movimentos
        </span>
      </div>
      <section className="brand-search-panel">
        <div>
          <label>
            <Search size={18} />
            <input
              value={brandInput}
              onChange={(event) => setBrandInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") runBrandSearch();
              }}
              placeholder="Digite uma marca para adicionar"
            />
          </label>
          <button className="btn primary" onClick={runBrandSearch}>
            <Search size={15} /> Pesquisar marca
          </button>
        </div>
        {brandSearch && (
          <div className="brand-results">
            {matchingBrands.map((brand) => (
              <button
                key={brand}
                aria-pressed={activeBrandSet.has(brand)}
                className={activeBrandSet.has(brand) ? "active" : ""}
                onClick={() => toggleBrand(brand)}
              >
                {activeBrandSet.has(brand) && <CheckCircle2 size={13} />}
                {brand}
              </button>
            ))}
            {!matchingBrands.length && <span>Nenhuma marca encontrada.</span>}
          </div>
        )}
        <div className="brand-selection-bar">
          <div>
            <span>Marcas selecionadas</span>
            <div className="brand-selection-chips">
              {activeBrands.map((brand) => (
                <button
                  key={brand}
                  disabled={activeBrands.length === 1}
                  onClick={() => toggleBrand(brand)}
                >
                  {brand}
                  {activeBrands.length > 1 && <X size={12} />}
                </button>
              ))}
            </div>
          </div>
          <div className="brand-selection-total">
            <span>Montante vendido · 12 meses</span>
            <b>{formatCurrency(overall.sale)}</b>
            <small>
              {activeBrands.length}{" "}
              {activeBrands.length === 1 ? "marca" : "marcas"}
            </small>
          </div>
        </div>
      </section>
      <section className="panel brand-trend-panel">
        <SectionTitle
          title={`${selectionTitle} — últimos 12 meses`}
          description={`Venda consolidada em barras e margem presente em linha · fechamento até ${formatDate(cutoff)}.`}
        />
        <div className="brand-trend-chart">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={trend}
              margin={{ top: 10, right: 20, left: 5, bottom: 0 }}
            >
              <CartesianGrid stroke="#e5eaf0" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="sale"
                tickFormatter={(value) => `${Math.round(value / 1000)}k`}
                tick={{ fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="margin"
                orientation="right"
                tickFormatter={(value) => `${value}%`}
                tick={{ fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(value, name) =>
                  name === "Venda"
                    ? formatCurrency(Number(value), true)
                    : formatPercent(Number(value), 2)
                }
              />
              <Bar
                yAxisId="sale"
                dataKey="sale"
                name="Venda"
                fill="#0b3b78"
                radius={[5, 5, 0, 0]}
              />
              <Line
                yAxisId="margin"
                type="monotone"
                dataKey="margin"
                name="Margem"
                stroke="#df1672"
                strokeWidth={2.8}
                dot={{ r: 3, fill: "#df1672" }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </section>
      <div className="section-block-heading">
        <div>
          <span>DESEMPENHO GERAL</span>
          <h2>{selectionTitle}</h2>
        </div>
        <small>Montante consolidado da rede nos últimos 12 meses</small>
      </div>
      <div className="metric-grid six">
        <MetricCard
          label="Montante vendido"
          value={formatCurrency(overall.sale)}
          icon={CircleDollarSign}
        />
        <MetricCard
          label="Margem"
          value={formatPercent(overall.margin, 2)}
          icon={Percent}
          tone={(overall.margin ?? 0) >= 0 ? "green" : "red"}
        />
        <MetricCard
          label="Lucro presente"
          value={formatCurrency(overall.profitPresent)}
          icon={WalletCards}
          tone={overall.profitPresent >= 0 ? "green" : "red"}
        />
        <MetricCard
          label="Ticket médio"
          value={
            overall.ticket == null ? "Sem base" : formatCurrency(overall.ticket)
          }
          icon={ShoppingBasket}
        />
        <MetricCard
          label="Transações por marca"
          value={formatNumber(overall.transactions)}
          icon={BarChart3}
        />
        <MetricCard
          label="Quantidade"
          value={formatNumber(overall.quantity)}
          icon={Boxes}
        />
      </div>
      <div className="section-block-heading stores-heading">
        <div>
          <span>DESEMPENHO POR LOJA</span>
          <h2>Selecione uma unidade para filtrar os produtos</h2>
        </div>
        <small>
          O montante das marcas selecionadas permanece consolidado acima.
        </small>
      </div>
      <div className="brand-store-cards">
        <button
          className={!selectedStore ? "active" : ""}
          onClick={() => setSelectedStore("")}
        >
          <span>GERAL</span>
          <b>{formatCurrency(overall.sale)}</b>
          <small>Margem {formatPercent(overall.margin, 2)}</small>
        </button>
        {stores.map(({ store, metrics }) => (
          <button
            key={store}
            className={selectedStore === store ? "active" : ""}
            onClick={() => setSelectedStore(store)}
          >
            <span>{store}</span>
            <b>{formatCurrency(metrics.sale)}</b>
            <small>
              {formatPercent(
                overall.sale ? (metrics.sale / overall.sale) * 100 : 0,
              )}{" "}
              do montante · margem {formatPercent(metrics.margin, 2)}
            </small>
          </button>
        ))}
      </div>
      <section className="panel brand-products-panel">
        <SectionTitle
          title={`Produtos das marcas — ${selectedStore || "Geral"}`}
          description={`${activeBrands.length} ${activeBrands.length === 1 ? "marca selecionada" : "marcas selecionadas"} · ${products.length} produtos exibidos.`}
        />
        <div className="products-toolbar">
          <label className="search-box large">
            <PackageSearch size={17} />
            <input
              value={productInput}
              onChange={(event) => setProductInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter")
                  setProductSearch(productInput.trim());
              }}
              placeholder="Pesquisar por ADM, produto ou marca"
            />
          </label>
          <button
            className="btn primary"
            onClick={() => setProductSearch(productInput.trim())}
          >
            <Search size={15} /> Pesquisar produto
          </button>
          {productSearch && (
            <button
              className="btn ghost"
              onClick={() => {
                setProductInput("");
                setProductSearch("");
              }}
            >
              <X size={15} /> Limpar
            </button>
          )}
        </div>
        <div className="simple-table-wrap">
          <table className="simple-table">
            <thead>
              <tr>
                <th>ADM</th>
                <th>Produto</th>
                <th>Marca</th>
                <th>Venda</th>
                <th>Participação</th>
                <th>Margem</th>
                <th>Ticket</th>
                <th>Transações</th>
                <th>Quantidade</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={`${product.brand}-${product.adm}`}>
                  <td>
                    <span className="code-pill">{product.adm}</span>
                  </td>
                  <td>
                    <b>{product.description}</b>
                  </td>
                  <td>{product.brand}</td>
                  <td>{formatCurrency(product.metrics.sale, true)}</td>
                  <td>
                    {formatPercent(
                      productScopeTotal
                        ? (product.metrics.sale / productScopeTotal) * 100
                        : 0,
                      2,
                    )}
                  </td>
                  <td>{formatPercent(product.metrics.margin, 2)}</td>
                  <td>
                    {product.metrics.ticket == null
                      ? "Sem base"
                      : formatCurrency(product.metrics.ticket, true)}
                  </td>
                  <td>{formatNumber(product.metrics.transactions)}</td>
                  <td>{formatNumber(product.metrics.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function BrandsPage({
  data,
  movementData,
  movementError,
  mode,
  comparison,
  selectedStores,
}: {
  data: DashboardData;
  movementData: BrandMovementData | null;
  movementError: string;
  mode: PeriodMode;
  comparison: Comparison;
  selectedStores: string[];
}) {
  const [searchParams] = useSearchParams();
  const requestedBrand = searchParams.get("marca") ?? "";
  const { data: productData } = useProducts(true);
  const allProducts = productData?.products ?? null;
  const [search, setSearch] = useState("");
  const [selectedBrand, setSelectedBrand] = useState(requestedBrand);
  const [productSearch, setProductSearch] = useState("");
  const brandNames =
    movementData?.brands ?? data.brands.map((brand) => brand.name);
  const matches = brandNames
    .filter(
      (brand) => !search || brand.toLowerCase().includes(search.toLowerCase()),
    )
    .slice(0, 18);
  if (movementError)
    return (
      <EmptyState
        title="Não foi possível abrir as marcas por loja"
        description={movementError}
      />
    );
  if (!movementData || !allProducts)
    return <LoadingState label="Carregando marcas, lojas e produtos…" />;
  const selectedStoreSet = new Set(selectedStores);
  const facts = selectedBrand
    ? data.daily.brands.filter((fact) => fact.brand === selectedBrand)
    : data.daily.overall;
  const periodKey = mode === "month" ? "mtd" : "mty";
  const periodRows = movementData.brandPeriods ?? [];
  const scopeBrand = selectedBrand || "__ALL__";
  const selectedPeriodRows = periodRows.filter((row) =>
    selectedStoreSet.has(row.store),
  );
  const exactScopeRows = selectedPeriodRows.filter(
    (row) => row.brand === scopeBrand && row.period === periodKey,
  );
  const networkCurrent = aggregateFacts(
    facts,
    comparison.currentStart,
    comparison.currentEnd,
  );
  const networkPrevious = aggregateFacts(
    facts,
    comparison.previousStart,
    comparison.previousEnd,
  );
  const current = exactScopeRows.length
    ? aggregateMovementRows(
        exactScopeRows.filter((row) => row.side === "current"),
      )
    : networkCurrent;
  const previous = exactScopeRows.length
    ? aggregateMovementRows(
        exactScopeRows.filter((row) => row.side === "previous"),
      )
    : networkPrevious;
  const result = {
    current,
    previous,
    delta: {
      salePercent: percentDifference(current.sale, previous.sale),
      marginPp: marginDifferencePp(current.margin, previous.margin),
      ticketPercent: percentDifference(current.ticket, previous.ticket),
      quantityPercent: percentDifference(current.quantity, previous.quantity),
    },
  };
  const comparableStores = [
    ...new Set(
      periodRows
        .filter(
          (row) =>
            row.brand === scopeBrand &&
            row.period === periodKey &&
            selectedStoreSet.has(row.store),
        )
        .map((row) => row.store),
    ),
  ]
    .map((store) => {
      const scoped = periodRows.filter(
        (row) =>
          row.store === store &&
          row.brand === scopeBrand &&
          row.period === periodKey,
      );
      const currentStore = aggregateMovementRows(
        scoped.filter((row) => row.side === "current"),
      );
      const previousStore = aggregateMovementRows(
        scoped.filter((row) => row.side === "previous"),
      );
      return { store, current: currentStore, previous: previousStore };
    })
    .filter((row) => row.current.sale || row.previous.sale)
    .sort((a, b) => b.current.sale - a.current.sale);
  const currentMonths =
    mode === "month"
      ? [comparison.currentEnd.slice(0, 7)]
      : Array.from(
          { length: Number(comparison.currentEnd.slice(5, 7)) },
          (_, index) =>
            `${comparison.currentEnd.slice(0, 4)}-${String(index + 1).padStart(2, "0")}`,
        );
  const fallbackStores = [
    ...new Set(
      movementData.brandMonthly
        .filter((row) => selectedStoreSet.has(row.store))
        .map((row) => row.store),
    ),
  ]
    .map((store) => ({
      store,
      current: aggregateMovementRows(
        movementData.brandMonthly.filter(
          (row) =>
            row.store === store &&
            (!selectedBrand || row.brand === selectedBrand) &&
            currentMonths.includes(row.month),
        ),
      ),
      previous: aggregateMovementRows([]),
    }))
    .filter((row) => row.current.sale)
    .sort((a, b) => b.current.sale - a.current.sale);
  const stores = comparableStores.length ? comparableStores : fallbackStores;
  const scopedTrendFacts: TrendSource[] =
    selectedStores.length === STORE_FILTERS.length
      ? facts
      : movementData.brandMonthly
          .filter(
            (row) =>
              selectedStoreSet.has(row.store) &&
              (!selectedBrand || row.brand === selectedBrand),
          )
          .map((row) => ({
            date: `${row.month}-01`,
            sale: row.sale,
            basePresent: row.basePresent,
            profitPresent: row.profitPresent,
            transactions: row.transactions,
            quantity: row.quantity,
          }));
  const products = allProducts
    .filter(
      (product) =>
        (!selectedBrand || product.brand === selectedBrand) &&
        (!productSearch ||
          `${product.adm} ${product.description} ${product.brand}`
            .toLowerCase()
            .includes(productSearch.toLowerCase())),
    )
    .filter(
      (product) =>
        product.periods[periodKey].current.sale ||
        product.periods[periodKey].previous.sale ||
        product.periods[periodKey].current.quantity ||
        product.periods[periodKey].previous.quantity,
    )
    .sort(
      (a, b) =>
        b.periods[periodKey].current.sale - a.periods[periodKey].current.sale,
    )
    .slice(0, 100);
  const productChartRows = products
    .slice(0, 10)
    .map((product) => ({
      name: product.description,
      current: product.periods[periodKey].current,
      previous: product.periods[periodKey].previous,
    }));
  const title = selectedBrand || "Todas as marcas";
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="eyebrow">
            <span /> INDÚSTRIAS E FORNECEDORES
          </span>
          <h1>Marcas</h1>
          <p>
            A página abre com toda a rede consolidada. Selecione uma marca para
            analisar somente seu desempenho.
          </p>
        </div>
        <span className="data-badge">
          <Tag size={15} /> {movementData.meta.brands} marcas
        </span>
      </div>
      <section className="scoped-search-panel brand-scope">
        <label className="search-box large">
          <Search size={18} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Pesquisar marca"
          />
        </label>
        <div className="brand-results">
          <button
            aria-pressed={!selectedBrand}
            className={!selectedBrand ? "active" : ""}
            onClick={() => setSelectedBrand("")}
          >
            <CheckCircle2 size={13} />
            Todas as marcas
          </button>
          {matches.map((brand) => (
            <button
              key={brand}
              aria-pressed={selectedBrand === brand}
              className={selectedBrand === brand ? "active" : ""}
              onClick={() => setSelectedBrand(brand)}
            >
              {selectedBrand === brand && <CheckCircle2 size={13} />}
              {brand}
            </button>
          ))}
        </div>
        {selectedBrand && (
          <div className="brand-selection-chips">
            <button onClick={() => setSelectedBrand("")}>
              {selectedBrand}
              <X size={12} />
            </button>
          </div>
        )}
      </section>
      <PeriodPerformance
        result={result}
        comparison={comparison}
        mode={mode}
        title={title}
      />
      <div className="section-block-heading stores-heading">
        <div>
          <span>DESEMPENHO POR LOJA</span>
          <h2>{title}</h2>
        </div>
        <small>Variações contra o mesmo período de 2025.</small>
      </div>
      <div className="brand-store-cards">
        {stores.map(({ store, current: now, previous: before }) => (
          <article key={store}>
            <span>{store}</span>
            <b>{formatCurrency(now.sale)}</b>
            <div className="brand-store-metrics">
              <small>
                Venda{" "}
                <Change value={percentDifference(now.sale, before.sale)} />
              </small>
              <small>
                Margem{" "}
                <Change value={marginDifferencePp(now.margin, before.margin)} />
              </small>
              <small>
                Ticket{" "}
                <Change value={percentDifference(now.ticket, before.ticket)} />
              </small>
              <small>
                Quantidade{" "}
                <Change
                  value={percentDifference(now.quantity, before.quantity)}
                />
              </small>
            </div>
          </article>
        ))}
      </div>
      <AnalysisPair
        title={`Produtos — ${title}`}
        description="A tabela analítica aparece primeiro; o gráfico dos principais produtos vem logo depois."
      >
        <section className="panel brand-products-panel">
          <SectionTitle
            title="Desempenho geral dos produtos"
            description={`${mode === "month" ? "MTD" : "YTD"} · comparação 2026 × 2025 · ${products.length} produtos de ${title}.`}
          />
          <div className="products-toolbar">
            <label className="search-box large">
              <PackageSearch size={17} />
              <input
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="Pesquisar ADM, produto ou marca"
              />
            </label>
            {productSearch && (
              <button
                className="btn ghost"
                onClick={() => setProductSearch("")}
              >
                <X size={15} /> Limpar
              </button>
            )}
          </div>
          <div className="table-scroll">
            <table className="simple-table comparison-table">
              <ComparisonTableHead identity={["ADM", "Produto", "Marca"]} />
              <tbody>
                {products.map((product) => {
                  const period = product.periods[periodKey];
                  return (
                    <tr key={`${product.brand}-${product.adm}`}>
                      <td>
                        <span className="code-pill">{product.adm}</span>
                      </td>
                      <td>
                        <b>{product.description}</b>
                      </td>
                      <td>{product.brand}</td>
                      <ComparisonMetricCells
                        current={period.current}
                        previous={period.previous}
                      />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        <PerformanceComparisonChart
          rows={productChartRows}
          title="Principais produtos"
          description="Os 10 produtos com maior venda no período, comparados com 2025."
          height={430}
        />
      </AnalysisPair>
      <PerformanceTrendChart
        rows={scopedTrendFacts}
        mode={mode}
        cutoff={data.meta.availableEnd}
        title={`${title} · desempenho`}
      />
    </>
  );
}

function ProductsPage({
  data,
  movementData,
  selectedStores,
  mode,
  products,
  loading,
}: {
  data: DashboardData;
  movementData: BrandMovementData | null;
  selectedStores: string[];
  mode: PeriodMode;
  products: Product[] | null;
  loading: boolean;
}) {
  const [searchParams] = useSearchParams();
  const requestedAdm = searchParams.get("produto") ?? "";
  const [pickerOpen, setPickerOpen] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [selectedAdms, setSelectedAdms] = useState<string[]>(
    requestedAdm ? [requestedAdm] : [],
  );
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const periodKey = mode === "month" ? "mtd" : "mty";
  const [sorting, setSorting] = useState<SortingState>([
    { id: "currentSale", desc: true },
  ]);
  const column = createColumnHelper<Product>();
  const columns = useMemo(
    () => [
      column.group({
        id: "identity",
        header: "Identificação",
        columns: [
          column.accessor("adm", {
            header: "ADM",
            cell: (info) => (
              <span className="code-pill">{info.getValue()}</span>
            ),
          }),
          column.accessor("description", {
            header: "Produto",
            cell: (info) => (
              <div className="product-name">
                <b>{info.getValue()}</b>
                <small>{info.row.original.group}</small>
              </div>
            ),
          }),
          column.accessor("brand", { header: "Marca" }),
          column.accessor("category", { header: "Categoria" }),
        ],
      }),
      column.group({
        id: "sale",
        header: "Venda",
        columns: [
          column.accessor((row) => row.periods[periodKey].previous.sale, {
            id: "previousSale",
            header: "2025",
            cell: (info) => formatCurrency(info.getValue(), true),
          }),
          column.accessor((row) => row.periods[periodKey].current.sale, {
            id: "currentSale",
            header: "2026",
            cell: (info) => <b>{formatCurrency(info.getValue(), true)}</b>,
          }),
          column.accessor((row) => row.periods[periodKey].delta.salePercent, {
            id: "saleVariation",
            header: "Variação %",
            cell: (info) => <Change value={info.getValue()} />,
          }),
        ],
      }),
      column.group({
        id: "margin",
        header: "Margem",
        columns: [
          column.accessor((row) => row.periods[periodKey].previous.margin, {
            id: "previousMargin",
            header: "2025",
            cell: (info) => formatPercent(info.getValue(), 2),
          }),
          column.accessor((row) => row.periods[periodKey].current.margin, {
            id: "currentMargin",
            header: "2026",
            cell: (info) => <b>{formatPercent(info.getValue(), 2)}</b>,
          }),
          column.accessor(
            (row) =>
              marginDifferencePp(
                row.periods[periodKey].current.margin,
                row.periods[periodKey].previous.margin,
              ),
            {
              id: "marginVariation",
              header: "Variação %",
              cell: (info) => <Change value={info.getValue()} />,
            },
          ),
        ],
      }),
      column.group({
        id: "ticket",
        header: "Ticket médio",
        columns: [
          column.accessor((row) => row.periods[periodKey].previous.ticket, {
            id: "previousTicket",
            header: "2025",
            cell: (info) =>
              info.getValue() == null
                ? "—"
                : formatCurrency(info.getValue()!, true),
          }),
          column.accessor((row) => row.periods[periodKey].current.ticket, {
            id: "currentTicket",
            header: "2026",
            cell: (info) => (
              <b>
                {info.getValue() == null
                  ? "—"
                  : formatCurrency(info.getValue()!, true)}
              </b>
            ),
          }),
          column.accessor((row) => row.periods[periodKey].delta.ticketPercent, {
            id: "ticketVariation",
            header: "Variação %",
            cell: (info) => <Change value={info.getValue()} />,
          }),
        ],
      }),
      column.group({
        id: "quantity",
        header: "Quantidade",
        columns: [
          column.accessor((row) => row.periods[periodKey].previous.quantity, {
            id: "previousQuantity",
            header: "2025",
            cell: (info) => formatNumber(info.getValue()),
          }),
          column.accessor((row) => row.periods[periodKey].current.quantity, {
            id: "currentQuantity",
            header: "2026",
            cell: (info) => <b>{formatNumber(info.getValue())}</b>,
          }),
          column.accessor(
            (row) => row.periods[periodKey].delta.quantityPercent,
            {
              id: "quantityVariation",
              header: "Variação %",
              cell: (info) => <Change value={info.getValue()} />,
            },
          ),
        ],
      }),
    ],
    [column, mode, periodKey],
  );
  const scopedProducts = useMemo(
    () =>
      storeScopedProducts(
        products ?? [],
        movementData,
        selectedStores,
        periodKey,
      ),
    [products, movementData, selectedStores, periodKey],
  );
  const selectedSet = useMemo(() => new Set(selectedAdms), [selectedAdms]);
  const tableProducts = useMemo(
    () =>
      selectedAdms.length
        ? scopedProducts.filter((product) => selectedSet.has(product.adm))
        : scopedProducts,
    [scopedProducts, selectedAdms, selectedSet],
  );
  const productOptions = useMemo(() => {
    const terms = productQuery
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return scopedProducts
      .filter((product) => {
        const content =
          `${product.adm} ${product.originalCode} ${product.description} ${product.brand} ${product.category}`.toLowerCase();
        return terms.every((term) => content.includes(term));
      })
      .sort(
        (a, b) =>
          b.periods[periodKey].current.sale - a.periods[periodKey].current.sale,
      )
      .slice(0, 60);
  }, [scopedProducts, productQuery, periodKey]);
  const selectedProducts = useMemo(
    () => scopedProducts.filter((product) => selectedSet.has(product.adm)),
    [scopedProducts, selectedSet],
  );
  useEffect(() => {
    if (
      !requestedAdm ||
      !scopedProducts.some((product) => product.adm === requestedAdm)
    )
      return;
    setSelectedAdms([requestedAdm]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [requestedAdm, scopedProducts]);
  const toggleProduct = (adm: string) =>
    setSelectedAdms((current) =>
      current.includes(adm)
        ? current.filter((item) => item !== adm)
        : [...current, adm],
    );
  useEffect(() => {
    if (!pickerOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (
        pickerRef.current &&
        !pickerRef.current.contains(event.target as Node)
      )
        setPickerOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [pickerOpen]);
  const table = useReactTable({
    data: tableProducts,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });
  if (loading || !products)
    return <LoadingState label="Carregando 8,6 mil produtos tratados…" />;
  const filteredProducts = table
    .getFilteredRowModel()
    .rows.map((row) => row.original);
  const trendRows = selectedAdms.length
    ? selectedProducts.flatMap((product) =>
        mode === "month" ? (product.daily ?? []) : (product.monthly ?? []),
      )
    : data.daily.overall;
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="eyebrow">
            <span /> CATÁLOGO ANALÍTICO
          </span>
          <h1>Produtos / SKU</h1>
          <p>
            Pesquisa exclusiva de produtos, com a tabela inteira ajustada ao
            período.
          </p>
        </div>
        <span className="data-badge">
          <Database size={15} /> {formatNumber(data.meta.productCount)} produtos
        </span>
      </div>
      <section className="scoped-search-panel product-scope product-selector-shell">
        <div className="product-selector-main" ref={pickerRef}>
          <button
            className="product-picker-trigger"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((open) => !open)}
          >
            <Search size={18} />
            <span>
              <b>
                {selectedAdms.length
                  ? `${selectedAdms.length} produto${selectedAdms.length === 1 ? "" : "s"} selecionado${selectedAdms.length === 1 ? "" : "s"}`
                  : "Selecionar produtos"}
              </b>
              <small>
                {selectedAdms.length
                  ? "Comparativo filtrado pelos produtos escolhidos"
                  : "Todos os produtos · ranking geral da rede"}
              </small>
            </span>
            <ArrowDownRight size={17} />
          </button>
          {selectedAdms.length > 0 && (
            <div className="product-selection-chips">
              {selectedProducts.slice(0, 8).map((product) => (
                <button
                  key={product.adm}
                  onClick={() => toggleProduct(product.adm)}
                >
                  {product.description}
                  <X size={12} />
                </button>
              ))}
              {selectedProducts.length > 8 && (
                <span>+{selectedProducts.length - 8}</span>
              )}
              <button
                className="clear-products"
                onClick={() => setSelectedAdms([])}
              >
                Limpar seleção
              </button>
            </div>
          )}
          {pickerOpen && (
            <div className="product-picker-popover">
              <div className="product-picker-search">
                <Search size={16} />
                <input
                  autoFocus
                  value={productQuery}
                  onChange={(event) => setProductQuery(event.target.value)}
                  placeholder="Pesquisar ADM, nome, marca ou categoria"
                />
                <button
                  onClick={() => setPickerOpen(false)}
                  aria-label="Fechar pesquisa"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="product-picker-summary">
                <span>
                  {selectedAdms.length
                    ? `${selectedAdms.length} selecionado${selectedAdms.length === 1 ? "" : "s"}`
                    : "Selecione um ou mais produtos"}
                </span>
                {selectedAdms.length > 0 && (
                  <button onClick={() => setSelectedAdms([])}>
                    Exibir todos
                  </button>
                )}
              </div>
              <div className="product-picker-list">
                {productOptions.map((product) => {
                  const selected = selectedSet.has(product.adm);
                  return (
                    <button
                      key={product.adm}
                      className={selected ? "selected" : ""}
                      aria-pressed={selected}
                      onClick={() => toggleProduct(product.adm)}
                    >
                      <span className="product-check">
                        {selected && <CheckCircle2 size={15} />}
                      </span>
                      <span>
                        <b>{product.description}</b>
                        <small>
                          ADM {product.adm} · {product.brand} ·{" "}
                          {product.category || "Não classificado"}
                        </small>
                      </span>
                      <strong>
                        {formatCurrency(
                          product.periods[periodKey].current.sale,
                          true,
                        )}
                      </strong>
                    </button>
                  );
                })}
                {!productOptions.length && (
                  <div className="product-picker-empty">
                    Nenhum produto encontrado.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <button
          className="btn primary product-export"
          onClick={() =>
            downloadCsv(
              `produtos-${mode === "month" ? "mtd" : "ytd"}.csv`,
              filteredProducts.map((item) => ({
                ADM: item.adm,
                Produto: item.description,
                Marca: item.brand,
                Categoria: item.category,
                Venda_2025: item.periods[periodKey].previous.sale,
                Venda_2026: item.periods[periodKey].current.sale,
                Diferenca_venda: item.periods[periodKey].delta.salePercent,
                Margem_2025: item.periods[periodKey].previous.margin,
                Margem_2026: item.periods[periodKey].current.margin,
                Diferenca_margem_pp: item.periods[periodKey].delta.marginPp,
                Ticket_2025: item.periods[periodKey].previous.ticket,
                Ticket_2026: item.periods[periodKey].current.ticket,
                Diferenca_ticket: item.periods[periodKey].delta.ticketPercent,
                Quantidade_2025: item.periods[periodKey].previous.quantity,
                Quantidade_2026: item.periods[periodKey].current.quantity,
                Diferenca_quantidade:
                  item.periods[periodKey].delta.quantityPercent,
              })),
            )
          }
        >
          <Download size={15} /> CSV
        </button>
      </section>
      <AnalysisPair
        title="Desempenho e evolução dos produtos"
        description="A consulta detalhada fica acima e o gráfico responde imediatamente à seleção feita na tabela."
      >
        <section className="panel">
          <SectionTitle
            title="Desempenho dos produtos"
            description={`${mode === "month" ? "MTD" : "YTD"} · ${filteredProducts.length} resultados · ordenados pela venda de 2026.`}
          />
          <div className="table-scroll product-table">
            <table className="data-table grouped-product-data-table comparison-table">
              <thead>
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => (
                      <th
                        key={header.id}
                        colSpan={header.colSpan}
                        onClick={
                          header.column.getCanSort()
                            ? header.column.getToggleSortingHandler()
                            : undefined
                        }
                        className={`${header.column.getCanSort() ? "sortable " : ""}${metricColumnClass(header.column.id)}`}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                        {header.column.getIsSorted() === "asc"
                          ? " ↑"
                          : header.column.getIsSorted() === "desc"
                            ? " ↓"
                            : ""}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={metricColumnClass(cell.column.id)}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span>
              {filteredProducts.length} resultados · página{" "}
              {table.getState().pagination.pageIndex + 1} de{" "}
              {table.getPageCount()}
            </span>
            <div>
              <button
                disabled={!table.getCanPreviousPage()}
                onClick={() => table.previousPage()}
              >
                <ArrowLeft size={15} />
              </button>
              <button
                disabled={!table.getCanNextPage()}
                onClick={() => table.nextPage()}
              >
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </section>
        <PerformanceTrendChart
          rows={trendRows}
          mode={mode}
          cutoff={data.meta.availableEnd}
          title={
            selectedAdms.length
              ? "Evolução dos produtos selecionados"
              : "Evolução geral dos produtos"
          }
        />
      </AnalysisPair>
    </>
  );
}

type SearchOption = { value: string; label: string; meta?: string };

function MultiSelectSearch({
  title,
  placeholder,
  options,
  values,
  onChange,
}: {
  title: string;
  placeholder: string;
  options: SearchOption[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = useMemo(() => new Set(values), [values]);
  const selectedOptions = options.filter((option) =>
    selected.has(option.value),
  );
  const terms = query
    .trim()
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .filter(Boolean);
  const matches = options
    .filter((option) => {
      const content = `${option.label} ${option.meta ?? ""}`.toLocaleLowerCase(
        "pt-BR",
      );
      return terms.every((term) => content.includes(term));
    })
    .slice(0, 80);
  const toggle = (value: string) =>
    onChange(
      selected.has(value)
        ? values.filter((item) => item !== value)
        : [...values, value],
    );
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <section className="multi-search-shell" ref={rootRef}>
      <button
        className="multi-search-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Search size={18} />
        <span>
          <b>
            {values.length
              ? `${values.length} ${title.toLocaleLowerCase("pt-BR")}${values.length === 1 ? "" : " selecionados"}`
              : `Todas as ${title.toLocaleLowerCase("pt-BR")}`}
          </b>
          <small>
            {values.length
              ? "Clique para alterar a seleção"
              : "Sem filtro aplicado"}
          </small>
        </span>
        <ArrowDownRight size={17} />
      </button>
      {selectedOptions.length > 0 && (
        <div className="multi-search-chips">
          {selectedOptions.slice(0, 8).map((option) => (
            <button key={option.value} onClick={() => toggle(option.value)}>
              {option.label}
              <X size={12} />
            </button>
          ))}
          {selectedOptions.length > 8 && (
            <span>+{selectedOptions.length - 8}</span>
          )}
          <button className="multi-search-clear" onClick={() => onChange([])}>
            Limpar seleção
          </button>
        </div>
      )}
      {open && (
        <div className="multi-search-popover">
          <label>
            <Search size={16} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
            />
            <button onClick={() => setOpen(false)} aria-label="Fechar">
              <X size={16} />
            </button>
          </label>
          <div className="multi-search-summary">
            <span>
              {values.length
                ? `${values.length} selecionado${values.length === 1 ? "" : "s"}`
                : "Selecione um ou mais itens"}
            </span>
            {values.length > 0 && (
              <button onClick={() => onChange([])}>Exibir todos</button>
            )}
          </div>
          <div className="multi-search-list">
            {matches.map((option) => (
              <button
                key={option.value}
                className={selected.has(option.value) ? "selected" : ""}
                aria-pressed={selected.has(option.value)}
                onClick={() => toggle(option.value)}
              >
                <span className="multi-search-check">
                  {selected.has(option.value) && <CheckCircle2 size={15} />}
                </span>
                <span>
                  <b>{option.label}</b>
                  {option.meta && <small>{option.meta}</small>}
                </span>
              </button>
            ))}
            {!matches.length && (
              <div className="multi-search-empty">
                Nenhum resultado encontrado.
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function displayStoreName(name: string) {
  return normalizedUiLabel(name).includes("HARO") ||
    normalizedUiLabel(name).includes("RHARO")
    ? "Rharo"
    : name;
}

type NamedComparison = ComparisonChartRow & { key: string; secondary?: string };

function aggregateNamedProducts(
  products: Product[],
  periodKey: "mtd" | "mty",
  keyOf: (product: Product) => string,
  labelOf: (product: Product) => string,
): NamedComparison[] {
  const grouped = new Map<string, Product[]>();
  for (const product of products) {
    const key = keyOf(product);
    if (!key) continue;
    const rows = grouped.get(key) ?? [];
    rows.push(product);
    grouped.set(key, rows);
  }
  return [...grouped]
    .map(([key, rows]) => ({
      key,
      name: labelOf(rows[0]),
      current: aggregateProductPeriodMetrics(rows, periodKey, "current"),
      previous: aggregateProductPeriodMetrics(rows, periodKey, "previous"),
    }))
    .filter(
      (row) =>
        row.current.sale ||
        row.previous.sale ||
        row.current.quantity ||
        row.previous.quantity,
    )
    .sort((a, b) => b.current.sale - a.current.sale);
}

function StoreBalloons({
  rows,
}: {
  rows: Array<{
    name: string;
    current: ComparisonMetrics;
    previous: ComparisonMetrics;
  }>;
}) {
  const navigate = useNavigate();
  return (
    <section className="store-balloon-section">
      <div className="section-block-heading stores-heading">
        <div>
          <span>LOJAS</span>
          <h2>Resultado individual das unidades</h2>
        </div>
        <small>Clique em uma unidade para abrir sua análise completa.</small>
      </div>
      <div className="store-balloon-grid">
        {rows.map((row) => (
          <button
            type="button"
            className="store-balloon"
            key={row.name}
            onClick={() => navigate(`/lojas/${encodeURIComponent(row.name)}`)}
            aria-label={`Abrir análise da loja ${displayStoreName(row.name)}`}
          >
            <header>
              <Store size={16} />
              <b>{displayStoreName(row.name)}</b>
              <ArrowRight size={14} />
            </header>
            <div>
              <span className="sale">
                <small>Venda</small>
                <strong>{formatCurrency(row.current.sale, true)}</strong>
                <Change
                  value={percentDifference(row.current.sale, row.previous.sale)}
                />
              </span>
              <span className="margin">
                <small>Margem</small>
                <strong>{formatPercent(row.current.margin, 2)}</strong>
                <Change
                  value={marginDifferencePp(
                    row.current.margin,
                    row.previous.margin,
                  )}
                />
              </span>
              <span className="ticket">
                <small>Ticket médio</small>
                <strong>
                  {row.current.ticket == null
                    ? "—"
                    : formatCurrency(row.current.ticket, true)}
                </strong>
                <Change
                  value={percentDifference(
                    row.current.ticket,
                    row.previous.ticket,
                  )}
                />
              </span>
              <span className="quantity">
                <small>Quantidade</small>
                <strong>{formatNumber(row.current.quantity)}</strong>
                <Change
                  value={percentDifference(
                    row.current.quantity,
                    row.previous.quantity,
                  )}
                />
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

function ResultSummaryStrip({
  title,
  current,
  previous,
}: {
  title: string;
  current: ComparisonMetrics;
  previous: ComparisonMetrics;
}) {
  return (
    <section className="result-summary-strip">
      <header>
        <span>RESULTADO</span>
        <b>{title}</b>
      </header>
      <div className="result-summary-metrics">
        <span className="sale">
          <small>Venda</small>
          <strong>{formatCurrency(current.sale, true)}</strong>
          <Change value={percentDifference(current.sale, previous.sale)} />
        </span>
        <span className="margin">
          <small>Margem</small>
          <strong>{formatPercent(current.margin, 2)}</strong>
          <Change value={marginDifferencePp(current.margin, previous.margin)} />
        </span>
        <span className="ticket">
          <small>Ticket médio</small>
          <strong>
            {current.ticket == null
              ? "—"
              : formatCurrency(current.ticket, true)}
          </strong>
          <Change value={percentDifference(current.ticket, previous.ticket)} />
        </span>
        <span className="quantity">
          <small>Quantidade</small>
          <strong>{formatNumber(current.quantity)}</strong>
          <Change
            value={percentDifference(current.quantity, previous.quantity)}
          />
        </span>
      </div>
    </section>
  );
}

function DimensionAnalysisPair({
  eyebrow,
  title,
  description,
  rows,
  identity,
  onOpen,
  chartLimit = 16,
}: {
  eyebrow: string;
  title: string;
  description: string;
  rows: NamedComparison[];
  identity: string[];
  onOpen?: (row: NamedComparison) => void;
  chartLimit?: number;
}) {
  return (
    <section className="analysis-pair">
      <div className="analysis-pair-heading">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <section className="panel analysis-table-panel">
        <div className="table-scroll">
          <table className="simple-table comparison-table">
            <ComparisonTableHead identity={identity} />
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className={onOpen ? "clickable-row" : ""}
                  onClick={() => onOpen?.(row)}
                >
                  <td>
                    <b>{row.name}</b>
                    {row.secondary && <small>{row.secondary}</small>}
                  </td>
                  <ComparisonMetricCells
                    current={row.current}
                    previous={row.previous}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <PerformanceComparisonChart
        rows={rows.slice(0, chartLimit)}
        title={`Gráfico de ${title.toLocaleLowerCase("pt-BR")}`}
        description="Comparativo dos quatro balizadores contra o mesmo período de 2025."
        height={Math.min(
          480,
          Math.max(300, rows.slice(0, chartLimit).length * 28 + 190),
        )}
        hideTitle
      />
    </section>
  );
}

function ProductAnalysisPair({
  products,
  periodKey,
}: {
  products: Product[];
  periodKey: "mtd" | "mty";
}) {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(products.length / 10));
  const safePage = Math.min(page, pageCount - 1);
  const visible = products.slice(safePage * 10, safePage * 10 + 10);
  const chartRows: NamedComparison[] = products
    .slice(0, 10)
    .map((product) => ({
      key: product.adm,
      name: product.description,
      secondary: `${product.brand} · ${product.category}`,
      current: product.periods[periodKey].current,
      previous: product.periods[periodKey].previous,
    }));
  return (
    <section className="analysis-pair">
      <div className="analysis-pair-heading">
        <span>PRODUTOS</span>
        <h2>Desempenho dos produtos</h2>
        <p>Ranking por venda líquida de 2026, com 10 produtos por página.</p>
      </div>
      <section className="panel analysis-table-panel">
        <div className="table-scroll">
          <table className="simple-table comparison-table product-ranking-table">
            <ComparisonTableHead
              identity={["Ranking", "Produto", "Marca", "Categoria"]}
            />
            <tbody>
              {visible.map((product, index) => (
                <tr
                  key={product.adm}
                  className="clickable-row"
                  onClick={() =>
                    navigate(
                      `/produtos?produto=${encodeURIComponent(product.adm)}`,
                    )
                  }
                >
                  <td className="product-rank">{safePage * 10 + index + 1}º</td>
                  <td>
                    <b>{product.description}</b>
                  </td>
                  <td>{product.brand}</td>
                  <td>{product.category}</td>
                  <ComparisonMetricCells
                    current={product.periods[periodKey].current}
                    previous={product.periods[periodKey].previous}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <span>
            Página {safePage + 1} de {pageCount} · {products.length} produtos
          </span>
          <div>
            <button
              disabled={safePage === 0}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              <ArrowLeft size={15} />
            </button>
            <button
              disabled={safePage + 1 >= pageCount}
              onClick={() =>
                setPage((value) => Math.min(pageCount - 1, value + 1))
              }
            >
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </section>
      <PerformanceComparisonChart
        rows={chartRows}
        title="Top 10 produtos"
        description="Os 10 produtos com maior venda no escopo, comparados com o mesmo período de 2025."
        height={390}
        hideTitle
      />
    </section>
  );
}

function UnifiedAnalysisSuite({
  products,
  movementData,
  selectedStores,
  mode,
  categoryCodes = [],
  brands = [],
  adms = [],
  showStores = true,
}: {
  products: Product[];
  movementData: BrandMovementData | null;
  selectedStores: string[];
  mode: PeriodMode;
  categoryCodes?: string[];
  brands?: string[];
  adms?: string[];
  showStores?: boolean;
}) {
  const navigate = useNavigate();
  const periodKey = mode === "month" ? "mtd" : "mty";
  const categorySet = useMemo(() => new Set(categoryCodes), [categoryCodes]);
  const brandSet = useMemo(() => new Set(brands), [brands]);
  const admSet = useMemo(() => new Set(adms), [adms]);
  const scoped = useMemo(
    () =>
      storeScopedProducts(products, movementData, selectedStores, periodKey),
    [products, movementData, selectedStores, periodKey],
  );
  const filtered = useMemo(
    () =>
      scoped
        .filter(
          (product) =>
            (!categorySet.size || categorySet.has(product.categoryCode)) &&
            (!brandSet.size || brandSet.has(product.brand)) &&
            (!admSet.size || admSet.has(product.adm)),
        )
        .sort(
          (a, b) =>
            b.periods[periodKey].current.sale -
            a.periods[periodKey].current.sale,
        ),
    [scoped, categorySet, brandSet, admSet, periodKey],
  );
  const categories = useMemo(
    () =>
      aggregateNamedProducts(
        filtered.filter((product) => isDetailedCategory(product.category)),
        periodKey,
        (product) => product.categoryCode,
        (product) => product.category,
      ),
    [filtered, periodKey],
  );
  const brandRows = useMemo(
    () =>
      aggregateNamedProducts(
        filtered,
        periodKey,
        (product) => product.brand,
        (product) => product.brand,
      ),
    [filtered, periodKey],
  );
  const storeRows = useMemo(() => {
    const rows = movementData?.productPeriods ?? [];
    const allowedAdms = new Set(filtered.map((product) => product.adm));
    return selectedStores.map((store) => {
      const selected = rows.filter(
        (row) =>
          row.store === store &&
          row.period === periodKey &&
          allowedAdms.has(row.adm),
      );
      return {
        name: store,
        current: aggregateMovementRows(
          selected.filter((row) => row.side === "current"),
        ),
        previous: aggregateMovementRows(
          selected.filter((row) => row.side === "previous"),
        ),
      };
    });
  }, [movementData, selectedStores, filtered, periodKey]);
  return (
    <>
      {showStores && (
        <>
          <StoreBalloons rows={storeRows} />
          <DimensionAnalysisPair
            eyebrow="LOJAS"
            title="Comparativo das lojas"
            description="Todas as unidades comparadas no mesmo período; tabela primeiro e gráfico logo abaixo."
            rows={storeRows.map((row) => ({ ...row, key: row.name }))}
            identity={["Loja"]}
            onOpen={(row) => navigate(`/lojas/${encodeURIComponent(row.key)}`)}
            chartLimit={6}
          />
        </>
      )}
      <DimensionAnalysisPair
        eyebrow="CATEGORIAS"
        title="Categorias"
        description="Grupos consolidados, sem exibir identificadores de agrupador."
        rows={categories}
        identity={["Categoria"]}
        onOpen={(row) =>
          navigate(`/categorias?categoria=${encodeURIComponent(row.key)}`)
        }
      />
      <DimensionAnalysisPair
        eyebrow="MARCAS"
        title="Marcas"
        description="Marcas vinculadas ao escopo selecionado."
        rows={brandRows}
        identity={["Marca"]}
        onOpen={(row) =>
          navigate(`/marcas?marca=${encodeURIComponent(row.key)}`)
        }
      />
      <ProductAnalysisPair products={filtered} periodKey={periodKey} />
    </>
  );
}

function UnifiedStoresPage({
  data,
  sellerData,
  products,
  movementData,
  mode,
}: {
  data: DashboardData;
  sellerData: SellerData | null;
  products: Product[] | null;
  movementData: BrandMovementData | null;
  mode: PeriodMode;
  selectedStores: string[];
}) {
  if (!sellerData || !products)
    return <LoadingState label="Carregando rede, lojas e portfólio…" />;
  const comparison =
    mode === "month"
      ? fixedComparisons(data.meta.availableEnd).mtd
      : fixedComparisons(data.meta.availableEnd).mty;
  const allStores = STORE_FILTERS.map((store) => store.dataName);
  const scoped = sellerData.storeDaily.filter((row) =>
    allStores.includes(row.store),
  );
  const current = aggregateStorePeriod(
    scoped,
    comparison.currentStart,
    comparison.currentEnd,
  );
  const previous = aggregateStorePeriod(
    scoped,
    comparison.previousStart,
    comparison.previousEnd,
  );
  const result = {
    current,
    previous,
    delta: {
      salePercent: percentDifference(current.sale, previous.sale),
      marginPp: marginDifferencePp(current.margin, previous.margin),
      ticketPercent: percentDifference(current.ticket, previous.ticket),
      quantityPercent: percentDifference(current.quantity, previous.quantity),
    },
  };
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="eyebrow">
            <span /> PAINEL GERAL DAS LOJAS
          </span>
          <h1>Lojas</h1>
          <p>
            Resumo da rede e detalhamento completo por unidade, categoria, marca
            e produto.
          </p>
        </div>
        <span className="data-badge success">
          <CheckCircle2 size={15} /> Fechado até{" "}
          {formatDate(data.meta.availableEnd)}
        </span>
      </div>
      <ResultSummaryStrip
        title="Resultado da rede"
        current={result.current}
        previous={result.previous}
      />
      <UnifiedAnalysisSuite
        products={products}
        movementData={movementData}
        selectedStores={allStores}
        mode={mode}
      />
    </>
  );
}

function StoreDetailPage({
  data,
  sellerData,
  products,
  movementData,
  mode,
}: {
  data: DashboardData;
  sellerData: SellerData | null;
  products: Product[] | null;
  movementData: BrandMovementData | null;
  mode: PeriodMode;
}) {
  const navigate = useNavigate();
  const { storeKey = "" } = useParams();
  const requested = normalizedUiLabel(decodeURIComponent(storeKey));
  const store = STORE_FILTERS.find(
    (item) =>
      normalizedUiLabel(item.dataName) === requested ||
      normalizedUiLabel(item.label) === requested,
  );
  if (!store)
    return (
      <EmptyState
        title="Loja não encontrada"
        description="Volte à tela de lojas e escolha uma das seis unidades da rede."
      />
    );
  if (!sellerData || !products)
    return <LoadingState label="Carregando desempenho da loja…" />;
  const comparison =
    mode === "month"
      ? fixedComparisons(data.meta.availableEnd).mtd
      : fixedComparisons(data.meta.availableEnd).mty;
  const scoped = sellerData.storeDaily.filter(
    (row) => row.store === store.dataName,
  );
  const current = aggregateStorePeriod(
    scoped,
    comparison.currentStart,
    comparison.currentEnd,
  );
  const previous = aggregateStorePeriod(
    scoped,
    comparison.previousStart,
    comparison.previousEnd,
  );
  return (
    <>
      <button className="back-button" onClick={() => navigate("/lojas")}>
        <ArrowLeft size={16} /> Voltar às lojas
      </button>
      <div className="page-intro">
        <div>
          <span className="eyebrow">
            <span /> DESEMPENHO DA UNIDADE
          </span>
          <h1>{displayStoreName(store.dataName)}</h1>
          <p>
            Resultado da loja e hierarquia completa de categorias, marcas e
            produtos.
          </p>
        </div>
        <span className="data-badge success">
          <CheckCircle2 size={15} /> Fechado até{" "}
          {formatDate(data.meta.availableEnd)}
        </span>
      </div>
      <ResultSummaryStrip
        title={`Resultado da loja · ${displayStoreName(store.dataName)}`}
        current={current}
        previous={previous}
      />
      <UnifiedAnalysisSuite
        products={products}
        movementData={movementData}
        selectedStores={[store.dataName]}
        mode={mode}
        showStores={false}
      />
    </>
  );
}

function UnifiedCategoriesPage({
  data,
  products,
  movementData,
  mode,
  selectedStores,
}: {
  data: DashboardData;
  products: Product[] | null;
  movementData: BrandMovementData | null;
  mode: PeriodMode;
  selectedStores: string[];
}) {
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string[]>(() =>
    params.get("categoria") ? [params.get("categoria")!] : [],
  );
  if (!products) return <LoadingState label="Carregando categorias…" />;
  const optionMap = new Map<string, string>();
  products.forEach((product) => {
    if (product.categoryCode && isDetailedCategory(product.category))
      optionMap.set(product.categoryCode, product.category);
  });
  const options = [...optionMap]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="eyebrow">
            <span /> PORTFÓLIO COMERCIAL
          </span>
          <h1>Categorias</h1>
          <p>
            Selecione uma ou mais categorias; lojas, marcas e produtos respondem
            ao mesmo filtro.
          </p>
        </div>
        <span className="data-badge">
          <Layers3 size={15} /> {options.length} categorias
        </span>
      </div>
      <MultiSelectSearch
        title="Categorias"
        placeholder="Pesquisar categoria"
        options={options}
        values={selected}
        onChange={setSelected}
      />
      <UnifiedAnalysisSuite
        products={products}
        movementData={movementData}
        selectedStores={selectedStores}
        mode={mode}
        categoryCodes={selected}
      />
    </>
  );
}

function UnifiedBrandsPage({
  data,
  products,
  movementData,
  movementError,
  mode,
  selectedStores,
}: {
  data: DashboardData;
  products: Product[] | null;
  movementData: BrandMovementData | null;
  movementError: string;
  mode: PeriodMode;
  selectedStores: string[];
}) {
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string[]>(() =>
    params.get("marca") ? [params.get("marca")!] : [],
  );
  if (movementError)
    return (
      <EmptyState
        title="Não foi possível abrir as marcas"
        description={movementError}
      />
    );
  if (!products || !movementData)
    return <LoadingState label="Carregando marcas…" />;
  const options = [
    ...new Set(products.map((product) => product.brand).filter(Boolean)),
  ]
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map((brand) => ({ value: brand, label: brand }));
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="eyebrow">
            <span /> INDÚSTRIAS E FORNECEDORES
          </span>
          <h1>Marcas</h1>
          <p>
            Selecione uma ou mais marcas; o montante e todos os detalhamentos
            serão consolidados.
          </p>
        </div>
        <span className="data-badge">
          <Tag size={15} /> {options.length} marcas
        </span>
      </div>
      <MultiSelectSearch
        title="Marcas"
        placeholder="Pesquisar marca"
        options={options}
        values={selected}
        onChange={setSelected}
      />
      <UnifiedAnalysisSuite
        products={products}
        movementData={movementData}
        selectedStores={selectedStores}
        mode={mode}
        brands={selected}
      />
    </>
  );
}

function UnifiedProductsPage({
  data,
  products,
  movementData,
  mode,
  selectedStores,
}: {
  data: DashboardData;
  products: Product[] | null;
  movementData: BrandMovementData | null;
  mode: PeriodMode;
  selectedStores: string[];
}) {
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string[]>(() =>
    params.get("produto") ? [params.get("produto")!] : [],
  );
  if (!products) return <LoadingState label="Carregando produtos…" />;
  const options = products.map((product) => ({
    value: product.adm,
    label: product.description,
    meta: `${product.brand} · ${product.category}`,
  }));
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="eyebrow">
            <span /> CATÁLOGO ANALÍTICO
          </span>
          <h1>Produtos</h1>
          <p>
            Selecione um ou mais produtos por nome, ADM, marca ou categoria.
          </p>
        </div>
        <span className="data-badge">
          <PackageSearch size={15} /> {formatNumber(products.length)} produtos
        </span>
      </div>
      <MultiSelectSearch
        title="Produtos"
        placeholder="Pesquisar ADM, produto, marca ou categoria"
        options={options}
        values={selected}
        onChange={setSelected}
      />
      <UnifiedAnalysisSuite
        products={products}
        movementData={movementData}
        selectedStores={selectedStores}
        mode={mode}
        adms={selected}
      />
    </>
  );
}

function LegacyProductsPage({
  data,
  filters,
  products,
  loading,
}: {
  data: DashboardData;
  filters: Filters;
  products: Product[] | null;
  loading: boolean;
}) {
  const [search, setSearch] = useState(filters.product);
  const [sorting, setSorting] = useState<SortingState>([
    { id: "mtySale", desc: true },
  ]);
  const rows = useMemo(
    () =>
      (products ?? []).filter(
        (product) =>
          (!filters.category || product.categoryCode === filters.category) &&
          (!filters.brand || product.brand === filters.brand),
      ),
    [products, filters.category, filters.brand],
  );
  const column = createColumnHelper<Product>();
  const columns = useMemo(
    () => [
      column.group({
        id: "identity",
        header: "Identificação",
        columns: [
          column.accessor("adm", {
            header: "ADM",
            cell: (info) => (
              <span className="code-pill">{info.getValue()}</span>
            ),
          }),
          column.accessor("originalCode", { header: "Cód. original" }),
          column.accessor("description", {
            header: "Produto",
            cell: (info) => (
              <div className="product-name">
                <b>{info.getValue()}</b>
                <small>{info.row.original.group}</small>
              </div>
            ),
          }),
          column.accessor("brand", { header: "Marca" }),
          column.accessor("category", { header: "Categoria" }),
        ],
      }),
      column.group({
        id: "mtd",
        header: "MTD · mês até ontem",
        columns: [
          column.accessor((row) => row.periods.mtd.previous.sale, {
            id: "mtdPreviousSale",
            header: "Venda 2025",
            cell: (info) => formatCurrency(info.getValue(), true),
          }),
          column.accessor((row) => row.periods.mtd.current.sale, {
            id: "mtdSale",
            header: "Venda 2026",
            cell: (info) => <b>{formatCurrency(info.getValue(), true)}</b>,
          }),
          column.accessor((row) => row.periods.mtd.delta.salePercent, {
            id: "mtdChange",
            header: "Variação",
            cell: (info) => <Change value={info.getValue()} />,
          }),
          column.accessor((row) => row.periods.mtd.current.margin, {
            id: "mtdMargin",
            header: "Margem 2026",
            cell: (info) => formatPercent(info.getValue(), 2),
          }),
        ],
      }),
      column.group({
        id: "mty",
        header: "YTD · janeiro até ontem",
        columns: [
          column.accessor((row) => row.periods.mty.previous.sale, {
            id: "mtyPreviousSale",
            header: "Venda 2025",
            cell: (info) => formatCurrency(info.getValue(), true),
          }),
          column.accessor((row) => row.periods.mty.current.sale, {
            id: "mtySale",
            header: "Venda 2026",
            cell: (info) => <b>{formatCurrency(info.getValue(), true)}</b>,
          }),
          column.accessor((row) => row.periods.mty.delta.salePercent, {
            id: "mtyChange",
            header: "Variação",
            cell: (info) => <Change value={info.getValue()} />,
          }),
          column.accessor((row) => row.periods.mty.current.margin, {
            id: "mtyMargin",
            header: "Margem 2026",
            cell: (info) => formatPercent(info.getValue(), 2),
          }),
        ],
      }),
    ],
    [column],
  );
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });
  if (loading || !products)
    return <LoadingState label="Carregando 8,6 mil produtos tratados…" />;
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="eyebrow">
            <span /> CATÁLOGO ANALÍTICO
          </span>
          <h1>Produtos / SKU</h1>
          <p>
            Cada produto reúne MTD e YTD, com 2025, 2026, variação e margem no
            mesmo quadro.
          </p>
        </div>
        <span className="data-badge">
          <Database size={15} /> {formatNumber(data.meta.productCount)} produtos
        </span>
      </div>
      <section className="panel">
        <div className="products-toolbar">
          <label className="search-box large">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Digite ADM, descrição, marca ou categoria"
            />
          </label>
          <button
            className="btn primary"
            onClick={() =>
              downloadCsv(
                "produtos-mtd-ytd-trade-performance.csv",
                table
                  .getFilteredRowModel()
                  .rows.map(({ original: item }) => ({
                    ADM: item.adm,
                    Produto: item.description,
                    Marca: item.brand,
                    Categoria: item.category,
                    MTD_venda_2025: item.periods.mtd.previous.sale,
                    MTD_venda_2026: item.periods.mtd.current.sale,
                    MTD_variacao: item.periods.mtd.delta.salePercent,
                    MTD_margem_2026: item.periods.mtd.current.margin,
                    YTD_venda_2025: item.periods.mty.previous.sale,
                    YTD_venda_2026: item.periods.mty.current.sale,
                    YTD_variacao: item.periods.mty.delta.salePercent,
                    YTD_margem_2026: item.periods.mty.current.margin,
                  })),
              )
            }
          >
            <Download size={15} /> CSV
          </button>
        </div>
        <div className="table-scroll product-table">
          <table className="data-table grouped-product-data-table">
            <thead>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      onClick={
                        header.column.getCanSort()
                          ? header.column.getToggleSortingHandler()
                          : undefined
                      }
                      className={header.column.getCanSort() ? "sortable" : ""}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                      {header.column.getIsSorted() === "asc"
                        ? " ↑"
                        : header.column.getIsSorted() === "desc"
                          ? " ↓"
                          : ""}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <span>
            {table.getFilteredRowModel().rows.length} resultados · página{" "}
            {table.getState().pagination.pageIndex + 1} de{" "}
            {table.getPageCount()}
          </span>
          <div>
            <button
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              <ArrowLeft size={15} />
            </button>
            <button
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

function UnavailablePage({
  eyebrow,
  title,
  description,
  fields,
  note,
}: {
  eyebrow: string;
  title: string;
  description: string;
  fields: string[];
  note: string;
}) {
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="eyebrow">
            <span /> {eyebrow}
          </span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      <div className="unavailable">
        <div className="unavailable-icon">
          <Database size={30} />
        </div>
        <span className="status-pill">
          <AlertTriangle size={15} /> Dados insuficientes
        </span>
        <h2>Esta análise não pode ser calculada com segurança</h2>
        <p>{note}</p>
        <div className="required-fields">
          <b>Campos necessários para liberar esta página</b>
          {fields.map((field) => (
            <span key={field}>
              <CheckCircle2 size={15} /> {field}
            </span>
          ))}
        </div>
        <div className="data-policy">
          <ShieldAlert size={18} />
          <span>
            <b>Política aplicada</b>Nenhum valor foi estimado, rateado ou
            simulado.
          </span>
        </div>
      </div>
    </>
  );
}

type TradeMetric = Pick<
  StorePeriodMetrics,
  "sale" | "margin" | "ticket" | "quantity"
>;
type TradePair = { previous: TradeMetric; current: TradeMetric };
type TradeComparisonRow = { name: string; year: TradePair; month: TradePair };

function TradeComparisonTable({
  rows,
  itemLabel,
  mode,
}: {
  rows: TradeComparisonRow[];
  itemLabel: string;
  mode: PeriodMode;
}) {
  const selected = (row: TradeComparisonRow) =>
    mode === "month" ? row.month : row.year;
  return (
    <div className="trade-table-wrap">
      <table className="trade-comparison-table comparison-table">
        <ComparisonTableHead identity={[itemLabel, "Período"]} />
        <tbody>
          {rows.map((row) => {
            const pair = selected(row);
            return (
              <tr key={row.name}>
                <td>
                  <b>{row.name}</b>
                </td>
                <td>
                  <span
                    className={`trade-period-pill${mode === "month" ? " month" : ""}`}
                  >
                    {mode === "month" ? "MTD" : "YTD"}
                  </span>
                </td>
                <ComparisonMetricCells
                  current={pair.current}
                  previous={pair.previous}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TradeSnapshot({
  label,
  cutoff,
  data,
  sellerData,
  mode,
  selectedStores,
  current = false,
}: {
  label: string;
  cutoff: string;
  data: DashboardData;
  sellerData: SellerData;
  mode: PeriodMode;
  selectedStores: string[];
  current?: boolean;
}) {
  const currentYear = Number(cutoff.slice(0, 4));
  const previousYear = currentYear - 1;
  const month = cutoff.slice(5, 7);
  const monthDay = cutoff.slice(5);
  const periods = {
    year: {
      previousStart: `${previousYear}-01-01`,
      previousEnd: `${previousYear}-${monthDay}`,
      currentStart: `${currentYear}-01-01`,
      currentEnd: cutoff,
    },
    month: {
      previousStart: `${previousYear}-${month}-01`,
      previousEnd: `${previousYear}-${monthDay}`,
      currentStart: `${currentYear}-${month}-01`,
      currentEnd: cutoff,
    },
  };
  const factPair = (
    facts: DashboardData["daily"]["overall"],
  ): { year: TradePair; month: TradePair } => ({
    year: {
      previous: aggregateFacts(
        facts,
        periods.year.previousStart,
        periods.year.previousEnd,
      ),
      current: aggregateFacts(
        facts,
        periods.year.currentStart,
        periods.year.currentEnd,
      ),
    },
    month: {
      previous: aggregateFacts(
        facts,
        periods.month.previousStart,
        periods.month.previousEnd,
      ),
      current: aggregateFacts(
        facts,
        periods.month.currentStart,
        periods.month.currentEnd,
      ),
    },
  });
  const storePair = (store: string): { year: TradePair; month: TradePair } => {
    const facts = sellerData.storeDaily.filter((row) => row.store === store);
    return {
      year: {
        previous: aggregateStorePeriod(
          facts,
          periods.year.previousStart,
          periods.year.previousEnd,
        ),
        current: aggregateStorePeriod(
          facts,
          periods.year.currentStart,
          periods.year.currentEnd,
        ),
      },
      month: {
        previous: aggregateStorePeriod(
          facts,
          periods.month.previousStart,
          periods.month.previousEnd,
        ),
        current: aggregateStorePeriod(
          facts,
          periods.month.currentStart,
          periods.month.currentEnd,
        ),
      },
    };
  };
  const selectedSet = new Set(selectedStores);
  const selectedFacts = sellerData.storeDaily.filter((row) =>
    selectedSet.has(row.store),
  );
  const selectedStorePair = (): { year: TradePair; month: TradePair } => ({
    year: {
      previous: aggregateStorePeriod(
        selectedFacts,
        periods.year.previousStart,
        periods.year.previousEnd,
      ),
      current: aggregateStorePeriod(
        selectedFacts,
        periods.year.currentStart,
        periods.year.currentEnd,
      ),
    },
    month: {
      previous: aggregateStorePeriod(
        selectedFacts,
        periods.month.previousStart,
        periods.month.previousEnd,
      ),
      current: aggregateStorePeriod(
        selectedFacts,
        periods.month.currentStart,
        periods.month.currentEnd,
      ),
    },
  });
  const overall = selectedStorePair();
  const stores = sellerData.stores
    .filter((store) => selectedSet.has(store.name))
    .map((store) => ({ name: store.name, ...storePair(store.name) }))
    .sort((a, b) => b.year.current.sale - a.year.current.sale);
  const categories = data.categories
    .filter((category) => isDetailedCategory(category.name))
    .map((category) => ({
      name: category.name,
      ...factPair(
        data.daily.categories.filter(
          (fact) => fact.categoryCode === category.code,
        ),
      ),
    }))
    .sort((a, b) => b.year.current.sale - a.year.current.sale);
  return (
    <section className={`trade-snapshot-section${current ? " current" : ""}`}>
      <div className="trade-snapshot-heading">
        <div>
          <span>{label}</span>
          <h2>Fechamento em {formatDate(cutoff)}</h2>
        </div>
        {current && (
          <span className="trade-current-badge">
            <CheckCircle2 size={14} /> Mais recente
          </span>
        )}
      </div>
      <div className="trade-period-strip">
        <div>
          <span>{mode === "month" ? "MTD" : "YTD"}</span>
          <b>
            {formatDate(
              (mode === "month" ? periods.month : periods.year).previousStart,
            )}{" "}
            a{" "}
            {formatDate(
              (mode === "month" ? periods.month : periods.year).previousEnd,
            )}
          </b>
          <i>comparado a</i>
          <b>
            {formatDate(
              (mode === "month" ? periods.month : periods.year).currentStart,
            )}{" "}
            a{" "}
            {formatDate(
              (mode === "month" ? periods.month : periods.year).currentEnd,
            )}
          </b>
        </div>
      </div>
      <section className="panel trade-block">
        <SectionTitle
          title="Desempenho geral"
          description="Venda, margem, ticket médio e quantidade consolidados da rede."
        />
        <TradeComparisonTable
          itemLabel="Visão"
          rows={[{ name: "Rede J. Cruzeiro", ...overall }]}
          mode={mode}
        />
      </section>
      <section className="panel trade-block">
        <SectionTitle
          title="Desempenho das lojas"
          description="Cada unidade comparada no recorte selecionado."
        />
        <TradeComparisonTable itemLabel="Loja" rows={stores} mode={mode} />
      </section>
      <section className="panel trade-block">
        <SectionTitle
          title="Categorias — quatro balizadores"
          description="Categorias oficiais ordenadas pela venda acumulada de 2026."
        />
        <TradeComparisonTable
          itemLabel="Categoria"
          rows={categories}
          mode={mode}
        />
      </section>
    </section>
  );
}

function TradePage({
  data,
  sellerData,
  mode,
  selectedStores,
}: {
  data: DashboardData;
  sellerData: SellerData | null;
  mode: PeriodMode;
  selectedStores: string[];
}) {
  if (!sellerData)
    return <LoadingState label="Carregando o comparativo das lojas…" />;
  const currentCutoff =
    sellerData.meta.availableEnd < data.meta.availableEnd
      ? sellerData.meta.availableEnd
      : data.meta.availableEnd;
  const previousCutoff = addDays(currentCutoff, -7);
  return (
    <>
      <div className="page-intro trade-intro">
        <div>
          <span className="eyebrow">
            <span /> COMPARATIVO TRADE
          </span>
          <h1>Semana passada × semana atual</h1>
          <p>
            Dois retratos simples no recorte {mode === "month" ? "MTD" : "YTD"},
            sempre comparando 2025 com 2026 na mesma quantidade de dias.
          </p>
        </div>
        <span className="data-badge success">
          <CalendarDays size={15} /> Atualizado até {formatDate(currentCutoff)}
        </span>
      </div>
      <div className="trade-snapshot-stack">
        <TradeSnapshot
          label="SEMANA PASSADA"
          cutoff={previousCutoff}
          data={data}
          sellerData={sellerData}
          mode={mode}
          selectedStores={selectedStores}
        />
        <TradeSnapshot
          label="SEMANA ATUAL"
          cutoff={currentCutoff}
          data={data}
          sellerData={sellerData}
          mode={mode}
          selectedStores={selectedStores}
          current
        />
      </div>
    </>
  );
}

function ReportsPage({
  data,
  categories,
}: {
  data: DashboardData;
  categories: Category[];
}) {
  const exportCategories = () =>
    downloadCsv(
      "resumo-categorias-trade-performance.csv",
      categories.map((item) => ({
        Categoria: item.name,
        Venda_atual: item.current.sale,
        Venda_anterior: item.previous.sale,
        Diferenca_reais: item.delta.saleAbsolute,
        Diferenca_percentual: item.delta.salePercent,
        Margem_atual: item.current.margin,
        Margem_anterior: item.previous.margin,
        Diferenca_margem_pp: item.delta.marginPp,
        Lucro_presente: item.current.profitPresent,
        Diagnostico: item.diagnosis,
        Prioridade: item.priority,
      })),
    );
  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const categorySheet = XLSX.utils.json_to_sheet(
      categories.map((item) => ({
        Categoria: item.name,
        "Venda atual": item.current.sale,
        "Venda anterior": item.previous.sale,
        "Diferença R$": item.delta.saleAbsolute,
        "Diferença %": item.delta.salePercent,
        "Margem atual": item.current.margin,
        "Margem anterior": item.previous.margin,
        "Diferença margem p.p.": item.delta.marginPp,
        "Lucro presente": item.current.profitPresent,
        Diagnóstico: item.diagnosis,
        Prioridade: item.priority,
      })),
    );
    const productSheet = XLSX.utils.json_to_sheet(
      data.topProducts.map((item) => ({
        ADM: item.adm,
        Produto: item.description,
        Marca: item.brand,
        Categoria:
          normalizedUiLabel(item.category) === "SEM CATEGORIA"
            ? ""
            : item.category,
        Venda: item.current.sale,
        Margem: item.current.margin,
        Quantidade: item.current.quantity,
      })),
    );
    XLSX.utils.book_append_sheet(workbook, categorySheet, "Categorias");
    XLSX.utils.book_append_sheet(workbook, productSheet, "Top SKU");
    XLSX.writeFile(workbook, "trade-performance.xlsx");
  };
  const reports = [
    [
      "Resumo executivo",
      "Venda, margem, lucro e diagnóstico das categorias.",
      BarChart3,
      exportCategories,
    ],
    [
      "Relatório semanal por categoria",
      "Comparação completa da última semana fechada.",
      Layers3,
      exportCategories,
    ],
    [
      "Top 100 SKU",
      "Produtos com maior venda no período atual.",
      PackageSearch,
      () =>
        downloadCsv(
          "top-100-sku.csv",
          data.topProducts.map((item) => ({
            ADM: item.adm,
            Produto: item.description,
            Marca: item.brand,
            Categoria:
              normalizedUiLabel(item.category) === "SEM CATEGORIA"
                ? ""
                : item.category,
            Venda: item.current.sale,
            Margem: item.current.margin,
          })),
        ),
    ],
    [
      "Maiores quedas",
      "Categorias ordenadas pelo impacto negativo em reais.",
      TrendingDown,
      () =>
        downloadCsv(
          "maiores-quedas.csv",
          [...categories]
            .sort((a, b) => a.delta.saleAbsolute - b.delta.saleAbsolute)
            .map((item) => ({
              Categoria: item.name,
              Impacto: item.delta.saleAbsolute,
              Variacao: item.delta.salePercent,
              Margem_pp: item.delta.marginPp,
            })),
        ),
    ],
  ] as const;
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="eyebrow">
            <span /> CENTRAL DE EXPORTAÇÃO
          </span>
          <h1>Relatórios</h1>
          <p>Arquivos prontos para reunião, análise e compartilhamento.</p>
        </div>
        <div className="report-actions">
          <button className="btn ghost" onClick={() => window.print()}>
            <Printer size={15} /> Imprimir / PDF
          </button>
          <button className="btn primary" onClick={exportExcel}>
            <Download size={15} /> Excel completo
          </button>
        </div>
      </div>
      <div className="report-grid">
        {reports.map(([title, description, Icon, action]) => (
          <article key={title}>
            <span>
              <Icon size={21} />
            </span>
            <h3>{title}</h3>
            <p>{description}</p>
            <button onClick={action}>
              Exportar CSV <ArrowRight size={15} />
            </button>
          </article>
        ))}
      </div>
      <section className="panel">
        <SectionTitle title="O que está disponível" />
        <div className="availability-list">
          <span className="available">
            <CheckCircle2 size={16} /> Resumo executivo
          </span>
          <span className="available">
            <CheckCircle2 size={16} /> Categorias, marcas e Top SKU
          </span>
          <span className="available">
            <CheckCircle2 size={16} /> Venda, margem, lucro e descontos
          </span>
          <span className="available">
            <CheckCircle2 size={16} /> Lojas, vendedores e movimentos datados
          </span>
          <span className="available">
            <CheckCircle2 size={16} /> Comparativo 2026 × 2025 e ticket por loja
          </span>
        </div>
      </section>
    </>
  );
}

function QualityPage({ data }: { data: DashboardData }) {
  const quality = data.quality;
  return (
    <>
      <div className="page-intro">
        <div>
          <span className="eyebrow">
            <span /> GOVERNANÇA DA INFORMAÇÃO
          </span>
          <h1>Qualidade dos Dados</h1>
          <p>Rastreabilidade do tratamento aplicado ao relatório oficial.</p>
        </div>
        <span className="data-badge success">
          <CheckCircle2 size={15} /> Base processada
        </span>
      </div>
      <div className="quality-grid">
        <MetricCard
          label="Registros importados"
          value={formatNumber(data.meta.recordsImported)}
          icon={Database}
          subtitle={`${formatDate(data.meta.availableStart)} a ${formatDate(data.meta.availableEnd)}`}
        />
        <MetricCard
          label="Produtos identificados"
          value={formatNumber(data.meta.productCount)}
          icon={PackageSearch}
          subtitle={`${data.meta.categoryCount} categorias · ${data.meta.brandCount} marcas`}
        />
        <MetricCard
          label="Datas ausentes"
          value={formatNumber(quality.invalidDates)}
          icon={CalendarDays}
          tone={quality.invalidDates ? "yellow" : "green"}
          subtitle="Movimentos excluídos dos recortes temporais"
        />
        <MetricCard
          label="Produtos sem classificação"
          value={formatNumber(quality.missingCategoryProducts)}
          icon={Layers3}
          tone={quality.missingCategoryProducts ? "red" : "green"}
          subtitle="Produtos sem agrupamento oficial"
        />
        <MetricCard
          label="ADMs divergentes"
          value={formatNumber(quality.duplicateAdmCount)}
          icon={ShieldAlert}
          tone={quality.duplicateAdmCount ? "yellow" : "green"}
          subtitle="Descrições diferentes no mesmo código"
        />
      </div>
      <div className="dashboard-grid equal">
        <section className="panel">
          <SectionTitle title="Cobertura dos campos" />
          <div className="coverage-list">
            {[
              ["Venda líquida", true],
              ["Quantidade", true],
              ["Ticket médio", true],
              ["Margem presente (%Lucro pres.)", true],
              ["Categorias e marcas", true],
              ["Loja", true],
              ["Vendedor", true],
              ["Data por venda da loja", true],
              ["Meta", false],
              ["Estoque", false],
            ].map(([label, ok]) => (
              <div key={String(label)}>
                <span className={ok ? "coverage-ok" : "coverage-missing"}>
                  {ok ? (
                    <CheckCircle2 size={16} />
                  ) : (
                    <AlertTriangle size={16} />
                  )}
                  {label}
                </span>
                <b>{ok ? "Disponível" : "Ausente"}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <SectionTitle title="Critério de margem adotado" />
          <div className="formula-card">
            <span>Margem consolidada</span>
            <b>Σ Lucro presente ÷ Σ Base lucro presente</b>
            <p>{data.meta.marginBasis}</p>
            <small>
              A margem não é calculada pela média simples das linhas.
            </small>
          </div>
        </section>
      </div>
      <section className="panel">
        <SectionTitle title="Pendências e observações" />
        <div className="notes-list">
          {quality.notes.map((note, index) => (
            <div key={note}>
              <span>{index + 1}</span>
              <p>{note}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      <Database size={34} />
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
function LoadingState({
  label = "Carregando indicadores reais…",
}: {
  label?: string;
}) {
  return (
    <div className="loading-state">
      <span />
      <b>{label}</b>
      <small>Tratando venda, margem, ticket médio e quantidade.</small>
    </div>
  );
}

type ImportStatus = {
  authenticated: boolean;
  canUpload: boolean;
  lastUpload: null | {
    fileName: string;
    uploadedAt: string;
    availableEnd: string;
    recordsImported: number;
  };
};

function formatUploadTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function ImportDialog({
  status,
  onClose,
}: {
  status: ImportStatus | null;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [missingDates, setMissingDates] = useState<string[]>([]);
  const [acceptClosedDates, setAcceptClosedDates] = useState(false);
  const upload = async () => {
    if (!file || !status?.canUpload) return;
    setBusy(true);
    setError("");
    try {
      setProgress("Preparando o processador seguro…");
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const [{ processSalesOds, gzipJson }, { mergeIncrementalImport }] =
        await Promise.all([
          import("./ods-import"),
          import("./merge-period-import"),
        ]);
      setProgress("Carregando o cadastro de produtos, marcas e categorias…");
      const [currentDashboard, reference, sellers, currentBrands] =
        await Promise.all([
          fetchImportedOrStatic<DashboardData>(
            "/api/data/dashboard",
            "/data/dashboard.json.gz",
          ),
          fetchImportedOrStatic<ProductData>(
            "/api/data/products",
            "/data/products.json.gz",
          ),
          fetchImportedOrStatic<SellerData>(
            "/api/data/sellers",
            "/data/sellers.json.gz",
          ),
          fetchImportedOrStatic<BrandMovementData>(
            "/api/data/brands",
            "/data/brands.json.gz",
          ),
        ]);
      const result = await processSalesOds(
        file,
        setProgress,
        reference.products,
        sellers,
      );
      const closing = {
        totalLiquid: result.metadata.totalLiquid,
        start: result.metadata.availableStart,
        end: result.metadata.availableEnd,
      };
      if (closing.end <= currentDashboard.meta.availableEnd)
        throw new Error(
          `Esta base já está fechada em ${formatDate(currentDashboard.meta.availableEnd)}. Envie um relatório que avance essa data.`,
        );
      if (closing.start <= currentDashboard.meta.availableEnd)
        throw new Error(
          `A base histórica até ${formatDate(currentDashboard.meta.availableEnd)} já está consolidada. Envie somente o fechamento posterior, sem repetir o histórico.`,
        );
      const skippedBusinessDays: string[] = [];
      if (closing.start > currentDashboard.meta.availableEnd) {
        for (
          let day = addDays(currentDashboard.meta.availableEnd, 1);
          day < closing.start;
          day = addDays(day, 1)
        ) {
          if (new Date(`${day}T12:00:00Z`).getUTCDay() !== 0)
            skippedBusinessDays.push(day);
        }
      }
      if (skippedBusinessDays.length && !acceptClosedDates) {
        setMissingDates(skippedBusinessDays);
        throw new Error(
          `Falta o fechamento de ${skippedBusinessDays.map(formatDate).join(", ")}. Envie uma ODS acumulada que inclua esse intervalo ou confirme abaixo que foi feriado / não houve expediente.`,
        );
      }
      const calculated = result.dashboard.daily.overall
        .filter((row) => row.date >= closing.start && row.date <= closing.end)
        .reduce((total, row) => total + row.sale, 0);
      if (
        Math.abs(Math.round((calculated - closing.totalLiquid) * 100) / 100) >
        0.01
      )
        throw new Error(
          "A atualização foi bloqueada: a conciliação interna da planilha divergiu após a consolidação.",
        );
      setProgress("Compactando a nova base…");
      if (!result.sellers || !result.brandMovements)
        throw new Error(
          "A ODS detalhada não permitiu relacionar vendedores e lojas. Verifique o agrupador Vendedor.",
        );
      const publish = mergeIncrementalImport(
        {
          dashboard: currentDashboard,
          products: reference,
          sellers,
          brands: currentBrands,
        },
        result,
        closing,
        acceptClosedDates ? skippedBusinessDays : [],
      );
      const [dashboard, products, sellersPayload, brandsPayload] =
        await Promise.all([
          gzipJson(publish.dashboard, "dashboard.json.gz"),
          gzipJson(publish.products, "products.json.gz"),
          gzipJson(publish.sellers, "sellers.json.gz"),
          gzipJson(publish.brands, "brands.json.gz"),
        ]);
      const importId = crypto.randomUUID();
      const partCounts: Record<string, number> = {};
      const sendPart = async (
        kind: "dashboard" | "products" | "sellers" | "brands",
        payload: File,
      ) => {
        const chunkSize = 1_500_000;
        const total = Math.ceil(payload.size / chunkSize);
        partCounts[kind] = total;
        for (let index = 0; index < total; index++) {
          setProgress(`Enviando ${kind} · parte ${index + 1} de ${total}…`);
          const response = await fetch(
            `/api/import/stage?importId=${encodeURIComponent(importId)}&kind=${kind}&index=${index}&total=${total}`,
            {
              method: "POST",
              headers: { "content-type": "application/gzip" },
              body: payload.slice(
                index * chunkSize,
                Math.min(payload.size, (index + 1) * chunkSize),
              ),
            },
          );
          const staged = (await response.json()) as { error?: string };
          if (!response.ok)
            throw new Error(
              staged.error || "Não foi possível enviar a base processada.",
            );
        }
      };
      setProgress("Enviando resultado consolidado…");
      await sendPart("dashboard", dashboard);
      setProgress("Enviando produtos processados…");
      await sendPart("products", products);
      setProgress("Enviando lojas e vendedores…");
      await sendPart("sellers", sellersPayload);
      setProgress("Enviando marcas e produtos por loja…");
      await sendPart("brands", brandsPayload);
      setProgress("Publicando a atualização…");
      const response = await fetch("/api/import/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          importId,
          metadata: { ...result.metadata, fileSize: file.size },
          parts: partCounts,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(
          payload.error || "Não foi possível concluir a importação.",
        );
      setProgress("Atualização concluída. Reabrindo o painel…");
      window.location.reload();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Erro inesperado ao processar a ODS.",
      );
      setBusy(false);
    }
  };
  return (
    <div
      className="import-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="import-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
      >
        <div className="import-modal-heading">
          <span>
            <FileSpreadsheet size={22} />
          </span>
          <div>
            <h2 id="import-title">Importar fechamento do dia</h2>
            <p>A base histórica permanece consolidada.</p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Fechar">
            <X size={19} />
          </button>
        </div>
        <div className="import-scope">
          <Database size={18} />
          <p>
            <b>
              Envie somente o novo fechamento diário ou um intervalo acumulado.
            </b>
            <small>
              Domingos são ignorados automaticamente. O relatório deve estar
              agrupado por Vendedor, com itens e movimentos; devoluções, lojas e
              Total líquido são conciliados antes da publicação.
            </small>
          </p>
        </div>
        {status?.canUpload ? (
          <>
            <label className={`import-dropzone${file ? " selected" : ""}`}>
              <input
                type="file"
                accept=".ods,application/vnd.oasis.opendocument.spreadsheet"
                disabled={busy}
                onChange={(event) => {
                  const selected = event.target.files?.[0] ?? null;
                  setFile(selected);
                  setError("");
                  setMissingDates([]);
                  setAcceptClosedDates(false);
                }}
              />
              <UploadCloud size={26} />
              <b>{file ? file.name : "ODS do fechamento diário"}</b>
              <small>
                {file
                  ? `${(file.size / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`
                  : "Pode conter um único dia ou dias acumulados"}
              </small>
            </label>
            {progress && (
              <div className="import-progress">
                <Loader2 size={17} className={busy ? "spin" : ""} />
                <span>{progress}</span>
              </div>
            )}
            {error && (
              <div className="import-error">
                <AlertTriangle size={16} /> {error}
              </div>
            )}
            {missingDates.length > 0 && (
              <label className="import-exception">
                <input
                  type="checkbox"
                  checked={acceptClosedDates}
                  onChange={(event) =>
                    setAcceptClosedDates(event.target.checked)
                  }
                />
                <span>
                  <b>Foi feriado ou não houve expediente</b>
                  <small>
                    Confirmo a ausência de movimento em{" "}
                    {missingDates.map(formatDate).join(", ")} e autorizo avançar
                    o fechamento.
                  </small>
                </span>
              </label>
            )}
            <button
              className="import-submit"
              disabled={
                !file || busy || (missingDates.length > 0 && !acceptClosedDates)
              }
              onClick={upload}
            >
              {busy ? (
                <Loader2 size={17} className="spin" />
              ) : (
                <UploadCloud size={17} />
              )}
              {busy
                ? "Processando…"
                : missingDates.length
                  ? "Aceitar exceção e atualizar"
                  : "Validar e atualizar"}
            </button>
          </>
        ) : (
          <div className="import-auth">
            <ShieldAlert size={24} />
            <h3>Acesso administrativo</h3>
            <p>Somente os e-mails autorizados podem atualizar a base.</p>
            {!status?.authenticated && (
              <a href="/signin-with-chatgpt?return_to=%2F">
                Entrar com ChatGPT
              </a>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Shell({ data }: { data: DashboardData }) {
  const [sidebar, setSidebar] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [periodMode, setPeriodMode] = useState<PeriodMode>("month");
  const [selectedStores, setSelectedStores] = useState<string[]>(() =>
    STORE_FILTERS.map((store) => store.dataName),
  );
  const comparisons = useMemo(
    () => fixedComparisons(data.meta.availableEnd),
    [data.meta.availableEnd],
  );
  const comparison = periodMode === "month" ? comparisons.mtd : comparisons.mty;
  const categories = useMemo(
    () =>
      deriveCategories(
        data,
        { category: "", brand: "", product: "" },
        comparison,
      ),
    [data, comparison],
  );
  const { data: productData, loading: productsLoading } = useProducts(true);
  const { data: sellerData } = useSellers();
  const { data: movementData, error: movementError } = useBrandMovements();
  const emittedLabel = `${formatDate(data.meta.emittedAt.slice(0, 10))}, ${data.meta.emittedAt.slice(11, 16)}`;
  useEffect(() => {
    if (isGitHubPages()) return;
    fetch("/api/import/status")
      .then((response) => (response.ok ? response.json() : null))
      .then(setImportStatus)
      .catch(() => undefined);
  }, []);
  const uploadLabel = importStatus?.lastUpload
    ? formatUploadTime(importStatus.lastUpload.uploadedAt)
    : `base fechada em ${formatDate(data.meta.availableEnd)}`;
  return (
    <div className="app-shell">
      <aside className={sidebar ? "sidebar open" : "sidebar"}>
        <div className="brand">
          <img
            src={publicAssetUrl("/j-cruzeiro-logo.png")}
            alt="J. Cruzeiro Construção & Acabamento"
          />
          <button onClick={() => setSidebar(false)}>
            <X size={19} />
          </button>
        </div>
        <nav>
          {NAV.map(([path, label, Icon]) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/"}
              onClick={() => setSidebar(false)}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <Icon size={18} />
              <span>{label}</span>
              {(path === "/metas" || path === "/trade") && <i />}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div>
            <Database size={16} />
            <span>
              <b>Base atualizada</b>
              <small>
                {formatDate(data.meta.availableEnd)} · último movimento
                disponível
              </small>
            </span>
          </div>
          <p>{formatNumber(data.meta.recordsImported)} registros válidos</p>
          <p className="last-upload">Último upload: {uploadLabel}</p>
        </div>
      </aside>
      {sidebar && (
        <button
          className="sidebar-overlay"
          onClick={() => setSidebar(false)}
          aria-label="Fechar menu"
        />
      )}
      <main className="main-area">
        <header className="topbar">
          <button className="menu-button" onClick={() => setSidebar(true)}>
            <Menu size={21} />
          </button>
          <div className="top-import-meta">
            <small>Último upload</small>
            <b>{uploadLabel}</b>
          </div>
          {!isGitHubPages() && (
            <button
              className="data-import-button"
              onClick={() => setImportOpen(true)}
            >
              <UploadCloud size={16} />
              <span>Importar ODS</span>
            </button>
          )}
          <div className="top-meta">
            <span>
              <i /> Dados oficiais
            </span>
            <b>Emitido em {emittedLabel}</b>
          </div>
        </header>
        <GlobalFilterDock
          mode={periodMode}
          setMode={setPeriodMode}
          selectedStores={selectedStores}
          setSelectedStores={setSelectedStores}
        />
        <div className="content">
          <Routes>
            <Route
              path="/"
              element={
                <Overview
                  data={data}
                  mode={periodMode}
                  comparison={comparison}
                  sellerData={sellerData}
                  products={productData?.products ?? null}
                  movementData={movementData}
                  selectedStores={selectedStores}
                />
              }
            />
            <Route
              path="/categorias"
              element={
                <UnifiedCategoriesPage
                  data={data}
                  products={productData?.products ?? null}
                  movementData={movementData}
                  mode={periodMode}
                  selectedStores={selectedStores}
                />
              }
            />
            <Route
              path="/categorias/:code"
              element={
                <CategoryDetail
                  data={data}
                  products={productData?.products ?? null}
                  movementData={movementData}
                  selectedStores={selectedStores}
                  mode={periodMode}
                  comparison={comparison}
                />
              }
            />
            <Route
              path="/lojas/:storeKey"
              element={
                <StoreDetailPage
                  data={data}
                  sellerData={sellerData}
                  products={productData?.products ?? null}
                  movementData={movementData}
                  mode={periodMode}
                />
              }
            />
            <Route
              path="/lojas"
              element={
                <UnifiedStoresPage
                  data={data}
                  sellerData={sellerData}
                  products={productData?.products ?? null}
                  movementData={movementData}
                  mode={periodMode}
                  selectedStores={selectedStores}
                />
              }
            />
            <Route
              path="/marcas"
              element={
                <UnifiedBrandsPage
                  data={data}
                  products={productData?.products ?? null}
                  movementData={movementData}
                  movementError={movementError}
                  mode={periodMode}
                  selectedStores={selectedStores}
                />
              }
            />
            <Route
              path="/produtos"
              element={
                <UnifiedProductsPage
                  data={data}
                  products={productData?.products ?? null}
                  movementData={movementData}
                  mode={periodMode}
                  selectedStores={selectedStores}
                />
              }
            />
            <Route
              path="/vendedores"
              element={
                <SellersPage
                  sellerData={sellerData}
                  mode={periodMode}
                  availableEnd={data.meta.availableEnd}
                  selectedStores={selectedStores}
                />
              }
            />
            <Route
              path="/metas"
              element={
                <UnavailablePage
                  eyebrow="PLANEJAMENTO E PROJEÇÃO"
                  title="Metas"
                  description="Realizado, projetado, percentual atingido e diferença para a meta."
                  note="Nenhuma meta oficial foi encontrada nos anexos disponíveis."
                  fields={[
                    "Meta mensal por loja",
                    "Meta por categoria, quando existir",
                    "Calendário de feriados e dias úteis",
                  ]}
                />
              }
            />
            <Route
              path="/trade"
              element={
                <TradePage
                  data={data}
                  sellerData={sellerData}
                  mode={periodMode}
                  selectedStores={selectedStores}
                />
              }
            />
            <Route
              path="/relatorios"
              element={<ReportsPage data={data} categories={categories} />}
            />
            <Route path="/qualidade" element={<QualityPage data={data} />} />
            <Route
              path="*"
              element={
                <EmptyState
                  title="Página não encontrada"
                  description="Use o menu lateral para voltar ao dashboard."
                />
              }
            />
          </Routes>
        </div>
      </main>
      {importOpen && (
        <ImportDialog
          status={importStatus}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  );
}

export default function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetchImportedOrStatic<DashboardData>(
      "/api/data/dashboard",
      "/data/dashboard.json.gz",
    )
      .then((loaded) => {
        const today = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/Sao_Paulo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date());
        const closedEnd =
          loaded.meta.availableEnd > today ? today : loaded.meta.availableEnd;
        const withinClosedPeriod = <T extends { date: string }>(facts: T[]) =>
          facts.filter((fact) => fact.date <= closedEnd);
        setData({
          ...loaded,
          meta: { ...loaded.meta, availableEnd: closedEnd },
          daily: {
            overall: withinClosedPeriod(loaded.daily.overall),
            categories: withinClosedPeriod(loaded.daily.categories),
            brands: withinClosedPeriod(loaded.daily.brands),
            categoryBrands: withinClosedPeriod(loaded.daily.categoryBrands),
          },
        });
      })
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "Erro ao carregar os dados.",
        ),
      );
  }, []);
  if (!data && !error) return <LoadingState />;
  if (error || !data)
    return (
      <EmptyState
        title="Não foi possível abrir o BI"
        description={error || "Erro desconhecido."}
      />
    );
  return (
    <HashRouter>
      <Shell data={data} />
    </HashRouter>
  );
}
