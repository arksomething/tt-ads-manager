export type SpendFactLike = {
  metricKey: string;
  value: number | string | unknown;
  unit?: string | null;
  currency?: string | null;
};

export type SpendFreshness = {
  missingDays: string[];
  incompleteDays: string[];
  staleDays: string[];
};

export type SpendWarning =
  | string
  | {
      reportDate?: string | null;
      warning: string;
    };

export type SpendCategoryChild = {
  key: string;
  label: string;
  metricKeys: string[];
  total: number;
  currency: string | null;
  available: boolean;
};

export type SpendCategory = {
  key: string;
  label: string;
  metricKeys: string[];
  total: number;
  currency: string | null;
  available: boolean;
  basis: "metric" | "children" | "missing";
  children: SpendCategoryChild[];
};

export type SpendReport = {
  organizationSlug: string;
  range: {
    startDate: string;
    endDate: string;
  };
  currency: string | null;
  grandTotal: number;
  categories: SpendCategory[];
  unclassified: SpendCategoryChild[];
  freshness: SpendFreshness;
  warnings: SpendWarning[];
};

export type RevenueProfitabilitySpendLike = {
  currency: string | null;
  facelessBaseSpend?: number;
  facelessManagementSpend?: number;
  facelessSpend: number;
  operatingSpend: number;
  paidSourceSpend: number;
  rows: Array<{
    kind: string;
    key: string;
    label: string;
    spend: number | null;
  }>;
  ugcManagementSpend?: number;
  ugcPaySpend?: number;
  ugcSpend: number;
  unknownSpendLabels: string[];
};

type SpendMetricDefinition = {
  key: string;
  label: string;
  metricKeys: string[];
};

type SpendCategoryDefinition = SpendMetricDefinition & {
  children: SpendMetricDefinition[];
};

const SPEND_CATEGORY_DEFINITIONS: SpendCategoryDefinition[] = [
  {
    key: "paid_ads",
    label: "Paid ads",
    metricKeys: ["spend.paid.total"],
    children: [
      {
        key: "ads.tiktok",
        label: "TikTok Ads",
        metricKeys: ["spend.tiktok"],
      },
      {
        key: "ads.facebook",
        label: "Facebook",
        metricKeys: ["spend.facebook", "spend.meta_ads"],
      },
      {
        key: "ads.adwords",
        label: "AdWords",
        metricKeys: ["spend.adwords", "spend.google_ads"],
      },
      {
        key: "ads.apple_search_ads",
        label: "Apple Search Ads",
        metricKeys: ["spend.apple_search_ads"],
      },
      {
        key: "ads.snapchat",
        label: "Snapchat",
        metricKeys: ["spend.snapchat"],
      },
    ],
  },
  {
    key: "ugc",
    label: "UGC costs",
    metricKeys: ["spend.ugc.total"],
    children: [
      {
        key: "ugc.pay",
        label: "UGC Pay",
        metricKeys: ["spend.ugc.pay"],
      },
      {
        key: "ugc.fixed",
        label: "Fixed fees",
        metricKeys: ["spend.ugc.fixed"],
      },
      {
        key: "ugc.cpm_video_pay",
        label: "CPM video pay",
        metricKeys: ["spend.ugc.cpm_video_pay"],
      },
      {
        key: "ugc.management",
        label: "UGC management",
        metricKeys: ["spend.ugc.management"],
      },
    ],
  },
  {
    key: "faceless",
    label: "ViewsBase faceless",
    metricKeys: ["spend.faceless.total"],
    children: [
      {
        key: "faceless.base",
        label: "Base spend",
        metricKeys: ["spend.faceless.base"],
      },
      {
        key: "faceless.management_fee",
        label: "Management fee",
        metricKeys: ["spend.faceless.management_fee"],
      },
      {
        key: "faceless.cpm_management_fee",
        label: "CPM management fee",
        metricKeys: ["spend.faceless.cpm_management_fee"],
      },
      {
        key: "faceless.fixed_management_fee",
        label: "Fixed management fee",
        metricKeys: ["spend.faceless.fixed_management_fee"],
      },
      {
        key: "faceless.dashboard_fee",
        label: "Dashboard fee",
        metricKeys: ["spend.faceless.dashboard_fee"],
      },
    ],
  },
  {
    key: "operating",
    label: "Operating costs",
    metricKeys: ["spend.operating.total"],
    children: [
      {
        key: "operating.office",
        label: "Office",
        metricKeys: ["spend.operating.office"],
      },
      {
        key: "operating.superwall",
        label: "Superwall",
        metricKeys: ["spend.operating.superwall"],
      },
      {
        key: "operating.singular",
        label: "Singular",
        metricKeys: ["spend.operating.singular"],
      },
      {
        key: "operating.other",
        label: "Other operating costs",
        metricKeys: ["spend.operating.other"],
      },
    ],
  },
];

const DEFINED_SPEND_METRIC_KEYS = new Set(
  SPEND_CATEGORY_DEFINITIONS.flatMap((category) => [
    ...category.metricKeys,
    ...category.children.flatMap((child) => child.metricKeys),
  ]),
);

function normalizeNumber(value: number) {
  return Number(value.toFixed(10));
}

function toNumber(value: SpendFactLike["value"]) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function getFactCurrency(fact: SpendFactLike) {
  return fact.currency && fact.currency.trim() ? fact.currency.trim().toUpperCase() : null;
}

function getMetricTotals(facts: readonly SpendFactLike[]) {
  const totals = new Map<string, { value: number; currencies: Set<string | null> }>();

  for (const fact of facts) {
    if (fact.unit && fact.unit !== "currency") {
      continue;
    }

    const existing =
      totals.get(fact.metricKey) ?? {
        currencies: new Set<string | null>(),
        value: 0,
      };

    existing.value = normalizeNumber(existing.value + toNumber(fact.value));
    existing.currencies.add(getFactCurrency(fact));
    totals.set(fact.metricKey, existing);
  }

  return totals;
}

function mergeCurrency(
  left: string | null,
  right: string | null,
) {
  if (!left) {
    return right;
  }

  if (!right || left === right) {
    return left;
  }

  return null;
}

function totalMetricKeys(
  totals: Map<string, { value: number; currencies: Set<string | null> }>,
  metricKeys: readonly string[],
) {
  let value = 0;
  let currency: string | null = null;
  let available = false;

  for (const metricKey of metricKeys) {
    const total = totals.get(metricKey);

    if (!total) {
      continue;
    }

    available = true;
    value = normalizeNumber(value + total.value);

    for (const totalCurrency of total.currencies) {
      currency = mergeCurrency(currency, totalCurrency);
    }
  }

  return {
    available,
    currency,
    value,
  };
}

function buildChild(
  totals: Map<string, { value: number; currencies: Set<string | null> }>,
  definition: SpendMetricDefinition,
) {
  const total = totalMetricKeys(totals, definition.metricKeys);

  return {
    available: total.available,
    currency: total.currency,
    key: definition.key,
    label: definition.label,
    metricKeys: definition.metricKeys,
    total: total.value,
  } satisfies SpendCategoryChild;
}

function buildCategory(
  totals: Map<string, { value: number; currencies: Set<string | null> }>,
  definition: SpendCategoryDefinition,
) {
  const directTotal = totalMetricKeys(totals, definition.metricKeys);
  const children = definition.children.map((child) => buildChild(totals, child));
  const availableChildren = children.filter((child) => child.available);
  const childrenTotal = availableChildren.reduce(
    (sum, child) => normalizeNumber(sum + child.total),
    0,
  );
  const childCurrency = availableChildren.reduce<string | null>(
    (currency, child) => mergeCurrency(currency, child.currency),
    null,
  );

  return {
    available: directTotal.available || availableChildren.length > 0,
    basis: directTotal.available
      ? "metric"
      : availableChildren.length > 0
        ? "children"
        : "missing",
    children: availableChildren,
    currency: directTotal.available ? directTotal.currency : childCurrency,
    key: definition.key,
    label: definition.label,
    metricKeys: definition.metricKeys,
    total: directTotal.available ? directTotal.value : childrenTotal,
  } satisfies SpendCategory;
}

function buildUnclassified(
  totals: Map<string, { value: number; currencies: Set<string | null> }>,
) {
  return [...totals.keys()]
    .filter(
      (metricKey) =>
        metricKey.startsWith("spend.") && !DEFINED_SPEND_METRIC_KEYS.has(metricKey),
    )
    .sort((left, right) => left.localeCompare(right))
    .map((metricKey) => {
      const total = totalMetricKeys(totals, [metricKey]);

      return {
        available: total.available,
        currency: total.currency,
        key: metricKey.replace(/^spend\./, ""),
        label: metricKey,
        metricKeys: [metricKey],
        total: total.value,
      } satisfies SpendCategoryChild;
    });
}

function getReportCurrency(items: ReadonlyArray<{ currency: string | null }>) {
  const currencies = [
    ...new Set(
      items
        .map((item) => item.currency)
        .filter((currency): currency is string => Boolean(currency)),
    ),
  ];

  return currencies.length === 1 ? currencies[0] : null;
}

function currencyFact(
  metricKey: string,
  value: number | null | undefined,
  currency: string | null,
): SpendFactLike | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return {
    currency,
    metricKey,
    unit: "currency",
    value,
  } satisfies SpendFactLike;
}

function getPaidRowMetricKey(row: RevenueProfitabilitySpendLike["rows"][number]) {
  const searchable = `${row.key} ${row.label}`.toLowerCase();

  if (searchable.includes("tiktok")) {
    return "spend.tiktok";
  }

  if (
    searchable.includes("facebook") ||
    searchable.includes("meta") ||
    searchable.includes("instagram")
  ) {
    return "spend.facebook";
  }

  if (
    searchable.includes("adwords") ||
    searchable.includes("google") ||
    searchable.includes("ad words")
  ) {
    return "spend.adwords";
  }

  if (searchable.includes("apple") || searchable.includes("asa")) {
    return "spend.apple_search_ads";
  }

  if (searchable.includes("snapchat") || searchable.includes("snap")) {
    return "spend.snapchat";
  }

  return null;
}

function getOperatingRowMetricKey(
  row: RevenueProfitabilitySpendLike["rows"][number],
) {
  const key = row.key.toLowerCase().replace(/^operating:/, "");

  switch (key) {
    case "office":
    case "superwall":
    case "singular":
      return `spend.operating.${key}`;
    case "misc":
    case "other":
      return "spend.operating.other";
    default:
      return null;
  }
}

function getOrganicCostRowMetricKey(
  row: RevenueProfitabilitySpendLike["rows"][number],
) {
  const key = row.key.toLowerCase();

  if (key === "organic:ugc-pay") {
    return "spend.ugc.pay";
  }

  if (key === "organic:ugc-management") {
    return "spend.ugc.management";
  }

  if (key === "organic:faceless-base") {
    return "spend.faceless.base";
  }

  if (key === "organic:faceless-management") {
    return "spend.faceless.management_fee";
  }

  return null;
}

export function buildSpendReportFromRevenueProfitability(args: {
  organizationSlug: string;
  range: {
    startDate: string;
    endDate: string;
  };
  profitability: RevenueProfitabilitySpendLike;
  warnings?: SpendWarning[];
}) {
  const currency = args.profitability.currency;
  const facts = [
    currencyFact("spend.paid.total", args.profitability.paidSourceSpend, currency),
    currencyFact("spend.ugc.total", args.profitability.ugcSpend, currency),
    currencyFact("spend.ugc.pay", args.profitability.ugcPaySpend, currency),
    currencyFact(
      "spend.ugc.management",
      args.profitability.ugcManagementSpend,
      currency,
    ),
    currencyFact("spend.faceless.total", args.profitability.facelessSpend, currency),
    currencyFact(
      "spend.faceless.base",
      args.profitability.facelessBaseSpend,
      currency,
    ),
    currencyFact(
      "spend.faceless.management_fee",
      args.profitability.facelessManagementSpend,
      currency,
    ),
    currencyFact("spend.operating.total", args.profitability.operatingSpend, currency),
    ...args.profitability.rows.flatMap((row) => {
      if (row.kind === "paid") {
        const metricKey = getPaidRowMetricKey(row);

        return metricKey ? [currencyFact(metricKey, row.spend, currency)] : [];
      }

      if (row.kind === "operating-cost") {
        const metricKey = getOperatingRowMetricKey(row);

        return metricKey ? [currencyFact(metricKey, row.spend, currency)] : [];
      }

      if (row.kind === "organic-cost") {
        const metricKey = getOrganicCostRowMetricKey(row);

        return metricKey ? [currencyFact(metricKey, row.spend, currency)] : [];
      }

      return [];
    }),
  ].filter((fact): fact is SpendFactLike => Boolean(fact));

  return buildSpendReport({
    facts,
    freshness: {
      incompleteDays: [],
      missingDays: [],
      staleDays: [],
    },
    organizationSlug: args.organizationSlug,
    range: args.range,
    warnings: [
      ...(args.warnings ?? []),
      ...args.profitability.unknownSpendLabels.map(
        (label) => `Spend unavailable for ${label}.`,
      ),
    ],
  });
}

export function buildSpendReport(args: {
  organizationSlug: string;
  range: {
    startDate: string;
    endDate: string;
  };
  facts: readonly SpendFactLike[];
  freshness: SpendFreshness;
  warnings: SpendWarning[];
}): SpendReport {
  const totals = getMetricTotals(args.facts);
  const categories = SPEND_CATEGORY_DEFINITIONS.map((definition) =>
    buildCategory(totals, definition),
  );
  const unclassified = buildUnclassified(totals);
  const grandTotal = [...categories, ...unclassified].reduce(
    (sum, category) => normalizeNumber(sum + category.total),
    0,
  );

  return {
    categories,
    currency: getReportCurrency([...categories, ...unclassified]),
    freshness: args.freshness,
    grandTotal,
    organizationSlug: args.organizationSlug,
    range: args.range,
    unclassified,
    warnings: args.warnings,
  };
}
