export type Metrics = {
  sale: number;
  gross: number;
  freight: number;
  discount: number;
  discountRate: number | null;
  quantity: number;
  cost: number;
  basePresent: number;
  profit: number;
  profitPresent: number;
  margin: number | null;
  transactions: number;
  skus: number;
  ticket: number | null;
  averagePrice: number | null;
};

export type Delta = {
  saleAbsolute: number;
  salePercent: number | null;
  marginPp: number | null;
  profitPresentAbsolute: number;
  profitPresentPercent: number | null;
  quantityPercent: number | null;
  ticketPercent: number | null;
};

export type Comparison = {
  currentStart: string;
  currentEnd: string;
  previousStart: string;
  previousEnd: string;
  label: string;
};

export type FixedComparisons = {
  mtd: Comparison;
  mty: Comparison;
};

export type Category = {
  code: string;
  name: string;
  current: Metrics;
  previous: Metrics;
  delta: Delta;
  share: number;
  diagnosis: string;
  priority: "Crítica" | "Alta" | "Média" | "Baixa";
  weekly: Array<Metrics & { start: string; end: string }>;
};

export type Brand = {
  name: string;
  current: Metrics;
  previous: Metrics;
  total: Metrics;
  delta: Delta;
};

export type Product = {
  adm: string;
  description: string;
  ncm: string;
  brand: string;
  brandRaw: string;
  originalCode: string;
  categoryCode: string;
  category: string;
  subcategoryCode: string;
  subcategory: string;
  groupCode: string;
  group: string;
  current: Metrics;
  previous: Metrics;
  total: Metrics;
  delta: Delta;
  periods: {
    mtd: { current: Metrics; previous: Metrics; delta: Delta };
    mty: { current: Metrics; previous: Metrics; delta: Delta };
  };
  weekly: Array<Pick<Metrics, "sale" | "quantity" | "profitPresent" | "margin"> & { start: string }>;
  daily?: Array<Pick<Metrics, "sale" | "quantity" | "basePresent" | "profitPresent" | "transactions"> & { date: string }>;
  monthly?: Array<Pick<Metrics, "sale" | "quantity" | "basePresent" | "profitPresent" | "transactions"> & { date: string }>;
};

export type Fact = Metrics & {
  date: string;
  categoryCode?: string;
  brand?: string;
};

export type DashboardData = {
  meta: {
    title: string;
    source: string;
    generatedAt: string;
    emittedAt: string;
    availableStart: string;
    availableEnd: string;
    recordsImported: number;
    movementRows: number;
    productCount: number;
    transactionCount: number;
    categoryCount: number;
    brandCount: number;
    comparison: Comparison;
    marginBasis: string;
    dataCapabilities: {
      stores: boolean;
      sellers: boolean;
      targets: boolean;
      stock: boolean;
      tradeSnapshot: boolean;
      reason: string;
    };
  };
  overall: { current: Metrics; previous: Metrics; delta: Delta };
  categories: Category[];
  brands: Brand[];
  topProducts: Product[];
  weekly: Array<Metrics & { start: string; end: string }>;
  monthly: Array<Metrics & { month: string }>;
  daily: {
    overall: Fact[];
    categories: Fact[];
    brands: Fact[];
    categoryBrands: Fact[];
  };
  quality: {
    invalidDates: number;
    movementsWithoutProduct: number;
    ignoredRows: number;
    missingBrandProducts: number;
    missingCategoryProducts: number;
    duplicateAdmCount: number;
    divergentDescriptions: Array<{ adm: string; descriptions: string[] }>;
    notes: string[];
  };
};

export type ProductData = {
  generatedAt: string;
  comparison: Comparison;
  products: Product[];
};

export type Filters = {
  category: string;
  brand: string;
  product: string;
};

export type SellerRow = {
  code: string;
  name: string;
  store: string;
  sale: number;
  cost: number;
  profitPresent: number;
  basePresent: number;
  margin: number | null;
};

export type StoreRow = {
  name: string;
  sellerCount: number;
  sale: number;
  profitPresent: number;
  basePresent: number;
  margin: number | null;
  detailSale: number;
  reconciliationGap: number;
  share: number;
  topProducts: Array<{
    adm: string;
    description: string;
    brand: string;
    sale: number;
    quantity: number;
    profitPresent: number;
    basePresent: number;
  }>;
};

export type SellerData = {
  meta: {
    source: string;
    stores: number;
    sellers: number;
    productRows: number;
    distinctAdm: number;
    matchedDistinctAdm: number;
    matchRate: number;
    matchedRows: number;
    descriptionMismatches: number;
    overflowRows: number;
    periodCapability: "dated_movements";
    periodNote: string;
    officialSale: number;
    detailSale: number;
    reconciliationRate: number;
    movementRows: number;
    movementSale: number;
    movementTransactions: number;
    sharedMovementRowsRemoved: number;
    duplicateMovementRowsRemoved: number;
    movementReconciliationRate: number;
    availableStart: string;
    availableEnd: string;
    marginBasis: string;
  };
  stores: StoreRow[];
  sellers: SellerRow[];
  storeDaily: Array<{
    store: string;
    date: string;
    sale: number;
    quantity: number;
    basePresent: number;
    profitPresent: number;
    margin: number | null;
    transactions: number;
  }>;
  sellerDaily?: Array<{
    store: string;
    code: string;
    name: string;
    date: string;
    sale: number;
    quantity: number;
    basePresent: number;
    profitPresent: number;
    margin: number | null;
    transactions: number;
  }>;
  unmatchedAdm: string[];
};

export type BrandMovementRow = {
  store: string;
  month: string;
  brand: string;
  sale: number;
  quantity: number;
  basePresent: number;
  profitPresent: number;
  margin: number | null;
  transactions: number;
};

export type ProductMovementRow = BrandMovementRow & {
  adm: string;
  description: string;
};

export type BrandDailyRow = Omit<BrandMovementRow, "month"> & { date: string };
export type ProductDailyRow = Omit<ProductMovementRow, "month"> & { date: string };

export type BrandPeriodRow = Omit<BrandMovementRow, "month"> & {
  period: "mtd" | "mty";
  side: "current" | "previous";
};

export type ProductPeriodRow = Omit<ProductMovementRow, "month"> & {
  period: "mtd" | "mty";
  side: "current" | "previous";
};

export type BrandMovementData = {
  meta: {
    source: string;
    availableStart: string;
    availableEnd: string;
    brands: number;
    brandMonthlyRows: number;
    productMonthlyRows: number;
    movementRowsRead: number;
    marginBasis: string;
  };
  brands: string[];
  brandMonthly: BrandMovementRow[];
  productMonthly: ProductMovementRow[];
  brandDaily?: BrandDailyRow[];
  productDaily?: ProductDailyRow[];
  brandPeriods?: BrandPeriodRow[];
  productPeriods?: ProductPeriodRow[];
};
