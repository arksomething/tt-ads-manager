import { Platform, type Prisma } from "@prisma/client";
import { z } from "zod";

import { getAiEnv } from "@/lib/server-env";
import { prisma } from "@/lib/db";
import {
  dashboardDateRangeOptions,
  formatPlatformLabel,
  getDateRangeStart,
} from "@/server/dashboard/filters";

import {
  getAiAnalyticsAccessContext,
  type AiAnalyticsAccessContext,
} from "./workspace";

const plannerIntentValues = [
  "summary",
  "video_ranking",
  "campaign_ranking",
  "creator_ranking",
  "timeseries",
  "unsupported",
] as const;
const plannerMetricValues = [
  "videos",
  "views",
  "likes",
  "comments",
  "engagementRate",
  "publishedAt",
] as const;
const plannerAggregationValues = [
  "count",
  "sum",
  "avg",
  "max",
  "min",
] as const;
const plannerIntervalValues = ["day", "week"] as const;
const plannerDatePresetValues = [
  "selected",
  "7d",
  "14d",
  "30d",
  "90d",
  "180d",
  "365d",
  "ytd",
  "all",
] as const;

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const wholeNumberFormatter = new Intl.NumberFormat("en-US");
const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export type AiConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AiAnalyticsSummaryCard = {
  label: string;
  value: string;
  hint?: string;
};

export type AiAnalyticsTable = {
  columns: Array<{
    key: string;
    label: string;
  }>;
  rows: Array<Record<string, string | null>>;
};

export type AiAnalyticsChatResponse = {
  answer: string;
  queryLabel: string | null;
  generatedQuery: string | null;
  summaryCards: AiAnalyticsSummaryCard[];
  table: AiAnalyticsTable | null;
  warnings: string[];
};

const aiConversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(4_000),
});

export const aiAnalyticsChatRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(1_000),
  messages: z.array(aiConversationMessageSchema).max(12).default([]),
  selectedCampaignIds: z.array(z.string().min(1)).max(200).default([]),
  selectedDateRange: z.string().trim().min(1).max(20).default("14d"),
});

const aiAnalyticsPlanSchema = z.object({
  title: z.string().trim().min(1).max(120),
  intent: z.enum(plannerIntentValues),
  metric: z.enum(plannerMetricValues),
  aggregation: z.enum(plannerAggregationValues),
  interval: z.enum(plannerIntervalValues),
  limit: z.number().int().min(1).max(25),
  sortDirection: z.enum(["asc", "desc"]),
  filters: z.object({
    campaignNames: z.array(z.string().trim().min(1).max(80)).max(10),
    creatorNames: z.array(z.string().trim().min(1).max(80)).max(10),
    platforms: z.array(z.nativeEnum(Platform)).max(3),
    datePreset: z.enum(plannerDatePresetValues),
    publishedAfter: z.string().trim().max(60).nullable(),
    publishedBefore: z.string().trim().max(60).nullable(),
    textSearch: z.string().trim().max(100).nullable(),
    assignedOnly: z.boolean(),
  }),
  reasoning: z.string().trim().min(1).max(240),
});

type AiAnalyticsPlan = z.infer<typeof aiAnalyticsPlanSchema>;
type AiAnalyticsMetric = AiAnalyticsPlan["metric"];
type AiAnalyticsAggregation = AiAnalyticsPlan["aggregation"];

type QueryExecutionContext = {
  context: AiAnalyticsAccessContext;
  selectedCampaignIds: string[];
  selectedDateRange: string;
};

type ResolvedCampaignFilter = {
  matchedCampaigns: Array<{
    id: string;
    name: string;
  }>;
  unmatchedNames: string[];
};

type ResolvedDateWindow = {
  label: string;
  gte?: Date;
  lte?: Date;
};

type ResolvedVideoWhere = {
  where: Prisma.VideoWhereInput;
  warnings: string[];
  selectedScopeCampaigns: Array<{
    id: string;
    name: string;
  }>;
  matchedCampaigns: Array<{
    id: string;
    name: string;
  }>;
  dateWindow: ResolvedDateWindow;
  selectedDateRangeLabel: string;
};

type ExecutionResult = {
  queryLabel: string;
  generatedQuery: string;
  summaryCards: AiAnalyticsSummaryCard[];
  table: AiAnalyticsTable | null;
  warnings: string[];
  resultSummary: string;
};

type AggregateMetrics = {
  videoCount: number;
  viewsSum: number;
  viewsAvg: number | null;
  viewsMax: number | null;
  viewsMin: number | null;
  likesSum: number;
  likesAvg: number | null;
  likesMax: number | null;
  likesMin: number | null;
  commentsSum: number;
  commentsAvg: number | null;
  commentsMax: number | null;
  commentsMin: number | null;
  engagementRateAvg: number | null;
  engagementRateMax: number | null;
  engagementRateMin: number | null;
  latestPublishedAt: Date | null;
  earliestPublishedAt: Date | null;
};

const analyticsPlanJsonSchema = {
  name: "analytics_query_plan",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      intent: { type: "string", enum: [...plannerIntentValues] },
      metric: { type: "string", enum: [...plannerMetricValues] },
      aggregation: { type: "string", enum: [...plannerAggregationValues] },
      interval: { type: "string", enum: [...plannerIntervalValues] },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 25,
      },
      sortDirection: {
        type: "string",
        enum: ["asc", "desc"],
      },
      filters: {
        type: "object",
        additionalProperties: false,
        properties: {
          campaignNames: {
            type: "array",
            items: { type: "string" },
            maxItems: 10,
          },
          creatorNames: {
            type: "array",
            items: { type: "string" },
            maxItems: 10,
          },
          platforms: {
            type: "array",
            items: { type: "string", enum: Object.values(Platform) },
            maxItems: 3,
          },
          datePreset: {
            type: "string",
            enum: [...plannerDatePresetValues],
          },
          publishedAfter: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
          publishedBefore: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
          textSearch: {
            anyOf: [{ type: "string" }, { type: "null" }],
          },
          assignedOnly: { type: "boolean" },
        },
        required: [
          "campaignNames",
          "creatorNames",
          "platforms",
          "datePreset",
          "publishedAfter",
          "publishedBefore",
          "textSearch",
          "assignedOnly",
        ],
      },
      reasoning: { type: "string" },
    },
    required: [
      "title",
      "intent",
      "metric",
      "aggregation",
      "interval",
      "limit",
      "sortDirection",
      "filters",
      "reasoning",
    ],
  },
} as const;

function normalizeName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseDate(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? undefined : parsedDate;
}

function formatCompactNumber(value: number) {
  return compactNumberFormatter.format(value);
}

function formatWholeNumber(value: number) {
  return wholeNumberFormatter.format(value);
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number") {
    return "--";
  }

  return `${value.toFixed(1)}%`;
}

function formatDateLabel(value: Date | null | undefined) {
  if (!value) {
    return "--";
  }

  return shortDateFormatter.format(value);
}

function formatMetricValue(metric: AiAnalyticsMetric, value: Date | number | null) {
  if (metric === "publishedAt") {
    return value instanceof Date ? formatDateLabel(value) : "--";
  }

  if (typeof value !== "number") {
    return "--";
  }

  if (metric === "engagementRate") {
    return formatPercent(value);
  }

  return metric === "videos" ? formatWholeNumber(value) : formatCompactNumber(value);
}

function getMetricLabel(metric: AiAnalyticsMetric) {
  switch (metric) {
    case "videos":
      return "Videos";
    case "views":
      return "Views";
    case "likes":
      return "Likes";
    case "comments":
      return "Comments";
    case "publishedAt":
      return "Published";
    default:
      return "Engagement rate";
  }
}

function getAggregationLabel(aggregation: AiAnalyticsAggregation) {
  switch (aggregation) {
    case "count":
      return "count";
    case "avg":
      return "average";
    case "max":
      return "maximum";
    case "min":
      return "minimum";
    default:
      return "total";
  }
}

function getDatePresetLabel(preset: string) {
  if (preset === "selected") {
    return "selected range";
  }

  if (preset === "ytd") {
    return "year to date";
  }

  if (preset === "all") {
    return "all time";
  }

  const dashboardOption = dashboardDateRangeOptions.find(
    (option) => option.id === preset,
  );

  if (dashboardOption) {
    return dashboardOption.label;
  }

  return `Last ${preset.replace("d", "")} days`;
}

function getSelectedDateRangeLabel(selectedDateRange: string) {
  if (selectedDateRange === "all") {
    return "All time";
  }

  return (
    dashboardDateRangeOptions.find((option) => option.id === selectedDateRange)
      ?.label ??
    dashboardDateRangeOptions[1]?.label ??
    "Last 14 days"
  );
}

function getRangeStartForPreset(preset: string) {
  const today = new Date();
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);

  switch (preset) {
    case "7d":
    case "14d":
    case "30d":
    case "qtd":
      return getDateRangeStart(preset);
    case "90d":
      start.setDate(start.getDate() - 89);
      return start;
    case "180d":
      start.setDate(start.getDate() - 179);
      return start;
    case "365d":
      start.setDate(start.getDate() - 364);
      return start;
    case "ytd":
      start.setMonth(0, 1);
      return start;
    default:
      return undefined;
  }
}

function sanitizePlan(input: AiAnalyticsPlan): AiAnalyticsPlan {
  const plan = {
    ...input,
    limit: Math.max(1, Math.min(input.limit, 25)),
    filters: {
      ...input.filters,
      campaignNames: input.filters.campaignNames.slice(0, 10),
      creatorNames: input.filters.creatorNames.slice(0, 10),
      platforms: input.filters.platforms.slice(0, 3),
    },
  };

  if (plan.intent === "unsupported") {
    return plan;
  }

  if (plan.intent === "video_ranking" && plan.metric === "videos") {
    plan.metric = "views";
  }

  if (plan.intent === "timeseries" && plan.metric === "publishedAt") {
    plan.metric = "videos";
  }

  if (
    plan.intent === "campaign_ranking" ||
    plan.intent === "creator_ranking" ||
    plan.intent === "summary" ||
    plan.intent === "timeseries"
  ) {
    if (plan.metric === "engagementRate" && plan.aggregation !== "avg") {
      plan.aggregation = "avg";
    }

    if (
      (plan.metric === "views" ||
        plan.metric === "likes" ||
        plan.metric === "comments") &&
      plan.aggregation === "count"
    ) {
      plan.aggregation = "sum";
    }

    if (plan.metric === "videos") {
      plan.aggregation = "count";
    }
  }

  if (
    (plan.metric === "publishedAt" && plan.aggregation !== "min") ||
    (plan.intent === "summary" && plan.metric === "publishedAt")
  ) {
    plan.aggregation =
      input.aggregation === "min" && plan.metric === "publishedAt" ? "min" : "max";
  }

  if (plan.intent === "timeseries" && plan.filters.datePreset === "all") {
    plan.filters.datePreset = "selected";
  }

  return plan;
}

function buildPlannerSystemPrompt(args: {
  context: AiAnalyticsAccessContext;
  selectedCampaignIds: string[];
  selectedDateRange: string;
}) {
  const accessibleCampaigns = args.context.accessibleCampaigns;
  const selectedCampaignSet = new Set(args.selectedCampaignIds);
  const scopeCampaigns =
    selectedCampaignSet.size > 0
      ? accessibleCampaigns.filter((campaign) => selectedCampaignSet.has(campaign.id))
      : accessibleCampaigns;

  return [
    "You are a query planner for a creator marketing analytics app.",
    "Return a structured query plan for questions about videos, campaigns, creators, platforms, and publishing performance.",
    "Never ask for or generate raw SQL. Plan against safe, org-scoped analytics data only.",
    "If the question is not answerable from video or campaign analytics in the local database, return intent='unsupported'.",
    "For rankings of campaigns or creators, prefer aggregation='sum' for views, likes, and comments, and aggregation='avg' for engagementRate.",
    "For summary questions like 'how many videos', use metric='videos' and aggregation='count'.",
    "For latest or earliest publishing questions, use metric='publishedAt' with aggregation='max' or aggregation='min'.",
    "Use filters.datePreset='selected' unless the user explicitly asks for a different range.",
    `Today's date is ${new Date().toISOString()}.`,
    `The page's selected date range is ${getSelectedDateRangeLabel(args.selectedDateRange)}.`,
    `The accessible campaigns in the current scope are: ${
      scopeCampaigns.length > 0
        ? scopeCampaigns.map((campaign) => campaign.name).join(", ")
        : "none"
    }.`,
    "If a campaign is mentioned, include the campaign name exactly as it appears when possible.",
    "Use filters.textSearch only when the question is clearly about caption or title keywords.",
    "Use filters.creatorNames when the question names one or more creators or account handles.",
    "Keep the title short and descriptive.",
  ].join("\n");
}

function buildConversationTranscript(messages: AiConversationMessage[]) {
  return messages
    .slice(-6)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n");
}

async function callOpenAiJson(args: {
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: typeof analyticsPlanJsonSchema;
}) {
  const aiEnv = getAiEnv();
  const response = await fetch(
    `${aiEnv.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiEnv.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: aiEnv.OPENAI_MODEL,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: args.systemPrompt,
          },
          {
            role: "user",
            content: args.userPrompt,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: args.jsonSchema,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`OpenAI planner request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenAI planner returned no content.");
  }

  return JSON.parse(content) as unknown;
}

async function callOpenAiText(args: {
  systemPrompt: string;
  userPrompt: string;
}) {
  const aiEnv = getAiEnv();
  const response = await fetch(
    `${aiEnv.OPENAI_BASE_URL ?? "https://api.openai.com/v1"}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aiEnv.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: aiEnv.OPENAI_MODEL,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: args.systemPrompt,
          },
          {
            role: "user",
            content: args.userPrompt,
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`OpenAI answer request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };
  const content = payload.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("OpenAI answer request returned no content.");
  }

  return content;
}

async function planAnalyticsQuery(args: {
  context: AiAnalyticsAccessContext;
  prompt: string;
  messages: AiConversationMessage[];
  selectedCampaignIds: string[];
  selectedDateRange: string;
}) {
  const transcript = buildConversationTranscript(args.messages);
  const plannerPayload = await callOpenAiJson({
    systemPrompt: buildPlannerSystemPrompt({
      context: args.context,
      selectedCampaignIds: args.selectedCampaignIds,
      selectedDateRange: args.selectedDateRange,
    }),
    userPrompt: [
      transcript ? `Recent conversation:\n${transcript}` : null,
      `Current analyst question: ${args.prompt}`,
      "Return only the best matching query plan.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    jsonSchema: analyticsPlanJsonSchema,
  });

  return sanitizePlan(aiAnalyticsPlanSchema.parse(plannerPayload));
}

function resolveSelectedCampaignScope(args: {
  context: AiAnalyticsAccessContext;
  selectedCampaignIds: string[];
}) {
  const accessibleCampaignIds = args.context.accessibleCampaigns.map(
    (campaign) => campaign.id,
  );
  const accessibleCampaignIdSet = new Set(accessibleCampaignIds);
  const validSelectedCampaignIds = args.selectedCampaignIds.filter((campaignId) =>
    accessibleCampaignIdSet.has(campaignId),
  );

  if (args.context.canManageOrganizationData) {
    if (accessibleCampaignIds.length > 0 && validSelectedCampaignIds.length === 0) {
      return {
        scopeCampaigns: [] as Array<{ id: string; name: string }>,
        where: {
          id: {
            in: [],
          },
        } satisfies Prisma.VideoWhereInput,
      };
    }

    return validSelectedCampaignIds.length > 0 &&
      validSelectedCampaignIds.length < accessibleCampaignIds.length
      ? {
          scopeCampaigns: args.context.accessibleCampaigns.filter((campaign) =>
            validSelectedCampaignIds.includes(campaign.id),
          ),
          where: {
            creator: {
              organizationId: args.context.organizationId,
            },
            campaignId: {
              in: validSelectedCampaignIds,
            },
          } satisfies Prisma.VideoWhereInput,
        }
      : {
          scopeCampaigns: args.context.accessibleCampaigns,
          where: {
            creator: {
              organizationId: args.context.organizationId,
            },
          } satisfies Prisma.VideoWhereInput,
        };
  }

  if (accessibleCampaignIds.length === 0 || validSelectedCampaignIds.length === 0) {
    return {
      scopeCampaigns: [] as Array<{ id: string; name: string }>,
      where: {
        id: {
          in: [],
        },
      } satisfies Prisma.VideoWhereInput,
    };
  }

  return validSelectedCampaignIds.length < accessibleCampaignIds.length
    ? {
        scopeCampaigns: args.context.accessibleCampaigns.filter((campaign) =>
          validSelectedCampaignIds.includes(campaign.id),
        ),
        where: {
          creator: {
            organizationId: args.context.organizationId,
          },
          campaignId: {
            in: validSelectedCampaignIds,
          },
        } satisfies Prisma.VideoWhereInput,
      }
    : {
        scopeCampaigns: args.context.accessibleCampaigns,
        where: {
          creator: {
            organizationId: args.context.organizationId,
          },
          campaignId: {
            in: accessibleCampaignIds,
          },
        } satisfies Prisma.VideoWhereInput,
      };
}

function resolveCampaignNames(args: {
  campaignNames: string[];
  availableCampaigns: Array<{
    id: string;
    name: string;
  }>;
}): ResolvedCampaignFilter {
  const matchedCampaigns = new Map<string, { id: string; name: string }>();
  const unmatchedNames: string[] = [];

  for (const requestedName of args.campaignNames) {
    const normalizedRequestedName = normalizeName(requestedName);
    const exactMatches = args.availableCampaigns.filter(
      (campaign) => normalizeName(campaign.name) === normalizedRequestedName,
    );
    const partialMatches =
      exactMatches.length > 0
        ? exactMatches
        : args.availableCampaigns.filter((campaign) => {
            const normalizedCampaignName = normalizeName(campaign.name);
            return (
              normalizedCampaignName.includes(normalizedRequestedName) ||
              normalizedRequestedName.includes(normalizedCampaignName)
            );
          });

    if (partialMatches.length === 0) {
      unmatchedNames.push(requestedName);
      continue;
    }

    for (const campaign of partialMatches) {
      matchedCampaigns.set(campaign.id, campaign);
    }
  }

  return {
    matchedCampaigns: [...matchedCampaigns.values()],
    unmatchedNames,
  };
}

function resolveDateWindow(args: {
  plan: AiAnalyticsPlan;
  selectedDateRange: string;
}): ResolvedDateWindow {
  const effectivePreset =
    args.plan.filters.datePreset === "selected"
      ? args.selectedDateRange
      : args.plan.filters.datePreset;
  const parsedAfter = parseDate(args.plan.filters.publishedAfter);
  const parsedBefore = parseDate(args.plan.filters.publishedBefore);
  const presetStart =
    effectivePreset === "all" ? undefined : getRangeStartForPreset(effectivePreset);

  let gte = parsedAfter ?? presetStart;
  let lte = parsedBefore;

  if (lte) {
    lte.setHours(23, 59, 59, 999);
  }

  if (gte && lte && gte > lte) {
    [gte, lte] = [lte, gte];
  }

  const label =
    parsedAfter || parsedBefore
      ? [
          parsedAfter ? `from ${formatDateLabel(parsedAfter)}` : null,
          parsedBefore ? `through ${formatDateLabel(parsedBefore)}` : null,
        ]
          .filter(Boolean)
          .join(" ")
      : args.plan.filters.datePreset === "selected"
        ? getSelectedDateRangeLabel(args.selectedDateRange)
        : getDatePresetLabel(args.plan.filters.datePreset);

  return {
    label,
    gte,
    lte,
  };
}

function buildVideoWhereFromPlan(args: {
  executionContext: QueryExecutionContext;
  plan: AiAnalyticsPlan;
}): ResolvedVideoWhere {
  const selectedDateRangeLabel = getSelectedDateRangeLabel(
    args.executionContext.selectedDateRange,
  );
  const selectedScope = resolveSelectedCampaignScope({
    context: args.executionContext.context,
    selectedCampaignIds: args.executionContext.selectedCampaignIds,
  });
  const warnings: string[] = [];
  const selectedScopeCampaigns =
    selectedScope.scopeCampaigns.length > 0
      ? selectedScope.scopeCampaigns
      : args.executionContext.context.canManageOrganizationData
        ? args.executionContext.context.accessibleCampaigns
        : [];
  const availableCampaignsForMatching =
    selectedScope.scopeCampaigns.length > 0
      ? selectedScope.scopeCampaigns
      : args.executionContext.context.canManageOrganizationData
        ? args.executionContext.context.accessibleCampaigns
        : [];
  const resolvedCampaigns = resolveCampaignNames({
    campaignNames: args.plan.filters.campaignNames,
    availableCampaigns: availableCampaignsForMatching,
  });

  if (resolvedCampaigns.unmatchedNames.length > 0) {
    warnings.push(
      `Could not match campaign names: ${resolvedCampaigns.unmatchedNames.join(", ")}.`,
    );
  }

  const dateWindow = resolveDateWindow({
    plan: args.plan,
    selectedDateRange: args.executionContext.selectedDateRange,
  });
  const andConditions: Prisma.VideoWhereInput[] = [selectedScope.where];

  if (args.plan.filters.assignedOnly) {
    andConditions.push({
      campaignId: {
        not: null,
      },
    });
  }

  if (resolvedCampaigns.matchedCampaigns.length > 0) {
    andConditions.push({
      campaignId: {
        in: resolvedCampaigns.matchedCampaigns.map((campaign) => campaign.id),
      },
    });
  }

  if (
    args.plan.filters.campaignNames.length > 0 &&
    resolvedCampaigns.matchedCampaigns.length === 0
  ) {
    andConditions.push({
      id: {
        in: [],
      },
    });
  }

  if (args.plan.filters.platforms.length > 0) {
    andConditions.push({
      platform: {
        in: args.plan.filters.platforms,
      },
    });
  }

  if (dateWindow.gte || dateWindow.lte) {
    andConditions.push({
      publishedAt: {
        ...(dateWindow.gte ? { gte: dateWindow.gte } : {}),
        ...(dateWindow.lte ? { lte: dateWindow.lte } : {}),
      },
    });
  }

  if (args.plan.filters.textSearch) {
    andConditions.push({
      titleOrCaption: {
        contains: args.plan.filters.textSearch,
        mode: "insensitive",
      },
    });
  }

  if (args.plan.filters.creatorNames.length > 0) {
    const creatorNamePredicates = args.plan.filters.creatorNames.flatMap(
      (creatorName) => {
        const handleName = creatorName.replace(/^@/, "");

        return [
          {
            creator: {
              displayName: {
                contains: creatorName,
                mode: "insensitive" as const,
              },
            },
          },
          {
            creatorPlatformAccount: {
              handle: {
                contains: handleName,
                mode: "insensitive" as const,
              },
            },
          },
        ] satisfies Prisma.VideoWhereInput[];
      },
    );

    andConditions.push({
      OR: creatorNamePredicates,
    });
  }

  return {
    where:
      andConditions.length === 1
        ? andConditions[0]!
        : {
            AND: andConditions,
          },
    warnings,
    selectedScopeCampaigns,
    matchedCampaigns: resolvedCampaigns.matchedCampaigns,
    dateWindow,
    selectedDateRangeLabel,
  };
}

function getMetricValueFromAggregate(args: {
  metric: AiAnalyticsMetric;
  aggregation: AiAnalyticsAggregation;
  metrics: AggregateMetrics;
}): number | Date | null {
  switch (args.metric) {
    case "videos":
      return args.metrics.videoCount;
    case "views":
      switch (args.aggregation) {
        case "avg":
          return args.metrics.viewsAvg;
        case "max":
          return args.metrics.viewsMax;
        case "min":
          return args.metrics.viewsMin;
        default:
          return args.metrics.viewsSum;
      }
    case "likes":
      switch (args.aggregation) {
        case "avg":
          return args.metrics.likesAvg;
        case "max":
          return args.metrics.likesMax;
        case "min":
          return args.metrics.likesMin;
        default:
          return args.metrics.likesSum;
      }
    case "comments":
      switch (args.aggregation) {
        case "avg":
          return args.metrics.commentsAvg;
        case "max":
          return args.metrics.commentsMax;
        case "min":
          return args.metrics.commentsMin;
        default:
          return args.metrics.commentsSum;
      }
    case "publishedAt":
      return args.aggregation === "min"
        ? args.metrics.earliestPublishedAt
        : args.metrics.latestPublishedAt;
    default:
      switch (args.aggregation) {
        case "max":
          return args.metrics.engagementRateMax;
        case "min":
          return args.metrics.engagementRateMin;
        default:
          return args.metrics.engagementRateAvg;
      }
  }
}

function compareSortValues(
  left: number | Date | null,
  right: number | Date | null,
  direction: "asc" | "desc",
) {
  const leftValue =
    left instanceof Date ? left.getTime() : typeof left === "number" ? left : -Infinity;
  const rightValue =
    right instanceof Date
      ? right.getTime()
      : typeof right === "number"
        ? right
        : -Infinity;

  return direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
}

function buildFilterClauses(args: {
  plan: AiAnalyticsPlan;
  resolvedWhere: ResolvedVideoWhere;
}) {
  const clauses = ["organization_scope = current_org"];

  if (args.resolvedWhere.matchedCampaigns.length > 0) {
    clauses.push(
      `campaign IN (${args.resolvedWhere.matchedCampaigns
        .map((campaign) => `'${campaign.name.replace(/'/g, "''")}'`)
        .join(", ")})`,
    );
  }

  if (args.plan.filters.platforms.length > 0) {
    clauses.push(
      `platform IN (${args.plan.filters.platforms
        .map((platform) => `'${platform}'`)
        .join(", ")})`,
    );
  }

  if (args.resolvedWhere.dateWindow.gte) {
    clauses.push(
      `published_at >= '${args.resolvedWhere.dateWindow.gte.toISOString().slice(0, 10)}'`,
    );
  }

  if (args.resolvedWhere.dateWindow.lte) {
    clauses.push(
      `published_at <= '${args.resolvedWhere.dateWindow.lte.toISOString().slice(0, 10)}'`,
    );
  }

  if (args.plan.filters.textSearch) {
    clauses.push(
      `title_or_caption ILIKE '%${args.plan.filters.textSearch.replace(/'/g, "''")}%'`,
    );
  }

  if (args.plan.filters.creatorNames.length > 0) {
    clauses.push(
      `creator MATCHES (${args.plan.filters.creatorNames
        .map((name) => `'${name.replace(/'/g, "''")}'`)
        .join(", ")})`,
    );
  }

  if (args.plan.filters.assignedOnly) {
    clauses.push("campaign_id IS NOT NULL");
  }

  return clauses;
}

function buildGeneratedQuery(args: {
  plan: AiAnalyticsPlan;
  resolvedWhere: ResolvedVideoWhere;
}) {
  const clauses = buildFilterClauses(args);
  const whereSql = clauses.join("\n  AND ");

  switch (args.plan.intent) {
    case "summary":
      return `SELECT ${getAggregationLabel(args.plan.aggregation).toUpperCase()}_${args.plan.metric.toUpperCase()} FROM scoped_videos\nWHERE ${whereSql};`;
    case "video_ranking":
      return `SELECT title, creator, campaign, platform, views, likes, comments, engagement_rate, published_at\nFROM scoped_videos\nWHERE ${whereSql}\nORDER BY ${args.plan.metric === "publishedAt" ? "published_at" : args.plan.metric} ${args.plan.sortDirection.toUpperCase()}\nLIMIT ${args.plan.limit};`;
    case "campaign_ranking":
      return `SELECT campaign, ${getAggregationLabel(args.plan.aggregation).toUpperCase()}_${args.plan.metric.toUpperCase()} AS metric_value\nFROM scoped_videos\nWHERE ${whereSql}\nGROUP BY campaign\nORDER BY metric_value ${args.plan.sortDirection.toUpperCase()}\nLIMIT ${args.plan.limit};`;
    case "creator_ranking":
      return `SELECT creator, ${getAggregationLabel(args.plan.aggregation).toUpperCase()}_${args.plan.metric.toUpperCase()} AS metric_value\nFROM scoped_videos\nWHERE ${whereSql}\nGROUP BY creator\nORDER BY metric_value ${args.plan.sortDirection.toUpperCase()}\nLIMIT ${args.plan.limit};`;
    case "timeseries":
      return `SELECT ${args.plan.interval}, ${getAggregationLabel(args.plan.aggregation).toUpperCase()}_${args.plan.metric.toUpperCase()} AS metric_value\nFROM scoped_videos\nWHERE ${whereSql}\nGROUP BY ${args.plan.interval}\nORDER BY ${args.plan.interval} ASC;`;
    default:
      return "Unsupported question type.";
  }
}

function buildQueryLabel(args: {
  plan: AiAnalyticsPlan;
  resolvedWhere: ResolvedVideoWhere;
}) {
  const scopeBits = [
    args.resolvedWhere.dateWindow.label,
    args.plan.filters.platforms.length > 0
      ? args.plan.filters.platforms.map((platform) => formatPlatformLabel(platform)).join(", ")
      : null,
    args.resolvedWhere.matchedCampaigns.length > 0
      ? args.resolvedWhere.matchedCampaigns.map((campaign) => campaign.name).join(", ")
      : null,
    args.plan.filters.creatorNames.length > 0
      ? args.plan.filters.creatorNames.join(", ")
      : null,
  ].filter(Boolean);

  const scopeSuffix = scopeBits.length > 0 ? ` in ${scopeBits.join(" / ")}` : "";

  switch (args.plan.intent) {
    case "summary":
      return `${getAggregationLabel(args.plan.aggregation)} ${getMetricLabel(args.plan.metric).toLowerCase()}${scopeSuffix}`;
    case "video_ranking":
      return `Top videos by ${getMetricLabel(args.plan.metric).toLowerCase()}${scopeSuffix}`;
    case "campaign_ranking":
      return `Campaign ranking by ${getAggregationLabel(args.plan.aggregation)} ${getMetricLabel(args.plan.metric).toLowerCase()}${scopeSuffix}`;
    case "creator_ranking":
      return `Creator ranking by ${getAggregationLabel(args.plan.aggregation)} ${getMetricLabel(args.plan.metric).toLowerCase()}${scopeSuffix}`;
    case "timeseries":
      return `${getMetricLabel(args.plan.metric)} over time${scopeSuffix}`;
    default:
      return args.plan.title;
  }
}

async function executeSummaryQuery(args: {
  plan: AiAnalyticsPlan;
  resolvedWhere: ResolvedVideoWhere;
}): Promise<ExecutionResult> {
  const aggregate = await prisma.video.aggregate({
    where: args.resolvedWhere.where,
    _count: {
      _all: true,
    },
    _sum: {
      views: true,
      likes: true,
      comments: true,
    },
    _avg: {
      views: true,
      likes: true,
      comments: true,
      engagementRate: true,
    },
    _max: {
      views: true,
      likes: true,
      comments: true,
      engagementRate: true,
      publishedAt: true,
    },
    _min: {
      views: true,
      likes: true,
      comments: true,
      engagementRate: true,
      publishedAt: true,
    },
  });
  const metrics: AggregateMetrics = {
    videoCount: aggregate._count._all,
    viewsSum: aggregate._sum.views ?? 0,
    viewsAvg: aggregate._avg.views,
    viewsMax: aggregate._max.views,
    viewsMin: aggregate._min.views,
    likesSum: aggregate._sum.likes ?? 0,
    likesAvg: aggregate._avg.likes,
    likesMax: aggregate._max.likes,
    likesMin: aggregate._min.likes,
    commentsSum: aggregate._sum.comments ?? 0,
    commentsAvg: aggregate._avg.comments,
    commentsMax: aggregate._max.comments,
    commentsMin: aggregate._min.comments,
    engagementRateAvg: aggregate._avg.engagementRate,
    engagementRateMax: aggregate._max.engagementRate,
    engagementRateMin: aggregate._min.engagementRate,
    latestPublishedAt: aggregate._max.publishedAt,
    earliestPublishedAt: aggregate._min.publishedAt,
  };
  const metricValue = getMetricValueFromAggregate({
    metric: args.plan.metric,
    aggregation: args.plan.aggregation,
    metrics,
  });

  return {
    queryLabel: buildQueryLabel(args),
    generatedQuery: buildGeneratedQuery(args),
    summaryCards: [
      {
        label: `${getAggregationLabel(args.plan.aggregation)} ${getMetricLabel(args.plan.metric)}`,
        value: formatMetricValue(args.plan.metric, metricValue),
      },
      {
        label: "Matching videos",
        value: formatWholeNumber(metrics.videoCount),
      },
      {
        label: "Range",
        value: args.resolvedWhere.dateWindow.label,
      },
    ],
    table: null,
    warnings: args.resolvedWhere.warnings,
    resultSummary: JSON.stringify({
      metric: args.plan.metric,
      aggregation: args.plan.aggregation,
      value:
        metricValue instanceof Date
          ? metricValue.toISOString()
          : metricValue,
      matchingVideos: metrics.videoCount,
      dateRange: args.resolvedWhere.dateWindow.label,
    }),
  };
}

function buildVideoOrderBy(
  plan: AiAnalyticsPlan,
): Prisma.VideoOrderByWithRelationInput[] {
  switch (plan.metric) {
    case "likes":
      return [{ likes: plan.sortDirection }, { publishedAt: "desc" }];
    case "comments":
      return [{ comments: plan.sortDirection }, { publishedAt: "desc" }];
    case "engagementRate":
      return [{ engagementRate: plan.sortDirection }, { publishedAt: "desc" }];
    case "publishedAt":
      return [{ publishedAt: plan.sortDirection }, { createdAt: "desc" }];
    default:
      return [{ views: plan.sortDirection }, { publishedAt: "desc" }];
  }
}

async function executeVideoRankingQuery(args: {
  plan: AiAnalyticsPlan;
  resolvedWhere: ResolvedVideoWhere;
}): Promise<ExecutionResult> {
  const [matchingVideos, videos] = await Promise.all([
    prisma.video.count({
      where: args.resolvedWhere.where,
    }),
    prisma.video.findMany({
      where: args.resolvedWhere.where,
      select: {
        id: true,
        titleOrCaption: true,
        videoUrl: true,
        platform: true,
        views: true,
        likes: true,
        comments: true,
        engagementRate: true,
        publishedAt: true,
        campaign: {
          select: {
            name: true,
          },
        },
        creator: {
          select: {
            displayName: true,
          },
        },
      },
      orderBy: buildVideoOrderBy(args.plan),
      take: args.plan.limit,
    }),
  ]);

  const table: AiAnalyticsTable = {
    columns: [
      { key: "title", label: "Video" },
      { key: "creator", label: "Creator" },
      { key: "campaign", label: "Campaign" },
      { key: "platform", label: "Platform" },
      { key: "published", label: "Published" },
      { key: "views", label: "Views" },
      { key: "likes", label: "Likes" },
      { key: "comments", label: "Comments" },
      { key: "engagement", label: "Engagement" },
      { key: "link", label: "Link" },
    ],
    rows: videos.map((video) => ({
      title: video.titleOrCaption ?? `${video.creator.displayName} video`,
      creator: video.creator.displayName,
      campaign: video.campaign?.name ?? "Unassigned",
      platform: formatPlatformLabel(video.platform),
      published: formatDateLabel(video.publishedAt),
      views: formatCompactNumber(video.views ?? 0),
      likes: formatCompactNumber(video.likes ?? 0),
      comments: formatCompactNumber(video.comments ?? 0),
      engagement: formatPercent(video.engagementRate),
      link: video.videoUrl,
    })),
  };
  const leadVideo = videos[0] ?? null;

  return {
    queryLabel: buildQueryLabel(args),
    generatedQuery: buildGeneratedQuery(args),
    summaryCards: [
      {
        label: "Rows returned",
        value: formatWholeNumber(videos.length),
      },
      {
        label: "Matching videos",
        value: formatWholeNumber(matchingVideos),
      },
      {
        label: `Top ${getMetricLabel(args.plan.metric)}`,
        value: leadVideo
          ? formatMetricValue(
              args.plan.metric,
              args.plan.metric === "publishedAt"
                ? leadVideo.publishedAt
                : args.plan.metric === "likes"
                  ? leadVideo.likes ?? 0
                  : args.plan.metric === "comments"
                    ? leadVideo.comments ?? 0
                    : args.plan.metric === "engagementRate"
                      ? leadVideo.engagementRate ?? 0
                      : leadVideo.views ?? 0,
            )
          : "--",
      },
    ],
    table,
    warnings: args.resolvedWhere.warnings,
    resultSummary: JSON.stringify({
      matchingVideos,
      topRows: table.rows.slice(0, 5),
    }),
  };
}

function getMetricsFromGroupRow(group: {
  _count: { _all: number };
  _sum: { views: number | null; likes: number | null; comments: number | null };
  _avg: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    engagementRate: number | null;
  };
  _max: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    engagementRate: number | null;
    publishedAt: Date | null;
  };
  _min: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    engagementRate: number | null;
    publishedAt: Date | null;
  };
}): AggregateMetrics {
  return {
    videoCount: group._count._all,
    viewsSum: group._sum.views ?? 0,
    viewsAvg: group._avg.views,
    viewsMax: group._max.views,
    viewsMin: group._min.views,
    likesSum: group._sum.likes ?? 0,
    likesAvg: group._avg.likes,
    likesMax: group._max.likes,
    likesMin: group._min.likes,
    commentsSum: group._sum.comments ?? 0,
    commentsAvg: group._avg.comments,
    commentsMax: group._max.comments,
    commentsMin: group._min.comments,
    engagementRateAvg: group._avg.engagementRate,
    engagementRateMax: group._max.engagementRate,
    engagementRateMin: group._min.engagementRate,
    latestPublishedAt: group._max.publishedAt,
    earliestPublishedAt: group._min.publishedAt,
  };
}

async function executeCampaignRankingQuery(args: {
  plan: AiAnalyticsPlan;
  resolvedWhere: ResolvedVideoWhere;
}): Promise<ExecutionResult> {
  const groupedCampaigns = await prisma.video.groupBy({
    by: ["campaignId"],
    where: {
      AND: [
        args.resolvedWhere.where,
        {
          campaignId: {
            not: null,
          },
        },
      ],
    },
    _count: {
      _all: true,
    },
    _sum: {
      views: true,
      likes: true,
      comments: true,
    },
    _avg: {
      views: true,
      likes: true,
      comments: true,
      engagementRate: true,
    },
    _max: {
      views: true,
      likes: true,
      comments: true,
      engagementRate: true,
      publishedAt: true,
    },
    _min: {
      views: true,
      likes: true,
      comments: true,
      engagementRate: true,
      publishedAt: true,
    },
  });
  const campaignPool =
    args.resolvedWhere.matchedCampaigns.length > 0
      ? args.resolvedWhere.matchedCampaigns
      : args.resolvedWhere.selectedScopeCampaigns;
  const groupedByCampaignId = new Map(
    groupedCampaigns
      .filter((row): row is typeof row & { campaignId: string } => Boolean(row.campaignId))
      .map((row) => [row.campaignId, getMetricsFromGroupRow(row)]),
  );
  const campaignRows = campaignPool.map((campaign) => {
    const metrics =
      groupedByCampaignId.get(campaign.id) ??
      ({
        videoCount: 0,
        viewsSum: 0,
        viewsAvg: null,
        viewsMax: null,
        viewsMin: null,
        likesSum: 0,
        likesAvg: null,
        likesMax: null,
        likesMin: null,
        commentsSum: 0,
        commentsAvg: null,
        commentsMax: null,
        commentsMin: null,
        engagementRateAvg: null,
        engagementRateMax: null,
        engagementRateMin: null,
        latestPublishedAt: null,
        earliestPublishedAt: null,
      } satisfies AggregateMetrics);

    return {
      campaign: campaign.name,
      metrics,
      sortValue: getMetricValueFromAggregate({
        metric: args.plan.metric,
        aggregation: args.plan.aggregation,
        metrics,
      }),
    };
  });

  campaignRows.sort((left, right) =>
    compareSortValues(left.sortValue, right.sortValue, args.plan.sortDirection),
  );

  const limitedRows = campaignRows.slice(0, args.plan.limit);
  const table: AiAnalyticsTable = {
    columns: [
      { key: "campaign", label: "Campaign" },
      { key: "videos", label: "Videos" },
      { key: "views", label: "Views" },
      { key: "likes", label: "Likes" },
      { key: "comments", label: "Comments" },
      { key: "engagement", label: "Avg Engagement" },
      { key: "published", label: "Latest Video" },
    ],
    rows: limitedRows.map((row) => ({
      campaign: row.campaign,
      videos: formatWholeNumber(row.metrics.videoCount),
      views: formatCompactNumber(row.metrics.viewsSum),
      likes: formatCompactNumber(row.metrics.likesSum),
      comments: formatCompactNumber(row.metrics.commentsSum),
      engagement: formatPercent(row.metrics.engagementRateAvg),
      published: formatDateLabel(row.metrics.latestPublishedAt),
    })),
  };
  const leader = limitedRows[0] ?? null;

  return {
    queryLabel: buildQueryLabel(args),
    generatedQuery: buildGeneratedQuery(args),
    summaryCards: [
      {
        label: "Rows returned",
        value: formatWholeNumber(limitedRows.length),
      },
      {
        label: `${getAggregationLabel(args.plan.aggregation)} ${getMetricLabel(args.plan.metric)}`,
        value: leader
          ? formatMetricValue(args.plan.metric, leader.sortValue)
          : "--",
      },
      {
        label: "Campaign scope",
        value: formatWholeNumber(campaignPool.length),
      },
    ],
    table,
    warnings: args.resolvedWhere.warnings,
    resultSummary: JSON.stringify({
      campaignCount: campaignPool.length,
      topRows: table.rows.slice(0, 5),
    }),
  };
}

async function executeCreatorRankingQuery(args: {
  plan: AiAnalyticsPlan;
  resolvedWhere: ResolvedVideoWhere;
}): Promise<ExecutionResult> {
  const groupedCreators = await prisma.video.groupBy({
    by: ["creatorId"],
    where: args.resolvedWhere.where,
    _count: {
      _all: true,
    },
    _sum: {
      views: true,
      likes: true,
      comments: true,
    },
    _avg: {
      views: true,
      likes: true,
      comments: true,
      engagementRate: true,
    },
    _max: {
      views: true,
      likes: true,
      comments: true,
      engagementRate: true,
      publishedAt: true,
    },
    _min: {
      views: true,
      likes: true,
      comments: true,
      engagementRate: true,
      publishedAt: true,
    },
  });
  const creatorDetails = await prisma.creator.findMany({
    where: {
      id: {
        in: groupedCreators.map((row) => row.creatorId),
      },
    },
    select: {
      id: true,
      displayName: true,
    },
  });
  const creatorNames = new Map(
    creatorDetails.map((creator) => [creator.id, creator.displayName]),
  );
  const creatorRows = groupedCreators.map((row) => {
    const metrics = getMetricsFromGroupRow(row);

    return {
      creator: creatorNames.get(row.creatorId) ?? "Unknown creator",
      metrics,
      sortValue: getMetricValueFromAggregate({
        metric: args.plan.metric,
        aggregation: args.plan.aggregation,
        metrics,
      }),
    };
  });

  creatorRows.sort((left, right) =>
    compareSortValues(left.sortValue, right.sortValue, args.plan.sortDirection),
  );

  const limitedRows = creatorRows.slice(0, args.plan.limit);
  const table: AiAnalyticsTable = {
    columns: [
      { key: "creator", label: "Creator" },
      { key: "videos", label: "Videos" },
      { key: "views", label: "Views" },
      { key: "likes", label: "Likes" },
      { key: "comments", label: "Comments" },
      { key: "engagement", label: "Avg Engagement" },
      { key: "published", label: "Latest Video" },
    ],
    rows: limitedRows.map((row) => ({
      creator: row.creator,
      videos: formatWholeNumber(row.metrics.videoCount),
      views: formatCompactNumber(row.metrics.viewsSum),
      likes: formatCompactNumber(row.metrics.likesSum),
      comments: formatCompactNumber(row.metrics.commentsSum),
      engagement: formatPercent(row.metrics.engagementRateAvg),
      published: formatDateLabel(row.metrics.latestPublishedAt),
    })),
  };
  const leader = limitedRows[0] ?? null;

  return {
    queryLabel: buildQueryLabel(args),
    generatedQuery: buildGeneratedQuery(args),
    summaryCards: [
      {
        label: "Rows returned",
        value: formatWholeNumber(limitedRows.length),
      },
      {
        label: `${getAggregationLabel(args.plan.aggregation)} ${getMetricLabel(args.plan.metric)}`,
        value: leader
          ? formatMetricValue(args.plan.metric, leader.sortValue)
          : "--",
      },
      {
        label: "Matching creators",
        value: formatWholeNumber(creatorRows.length),
      },
    ],
    table,
    warnings: args.resolvedWhere.warnings,
    resultSummary: JSON.stringify({
      creatorCount: creatorRows.length,
      topRows: table.rows.slice(0, 5),
    }),
  };
}

function getBucketKey(date: Date, interval: "day" | "week") {
  if (interval === "day") {
    return date.toISOString().slice(0, 10);
  }

  const bucketDate = new Date(date);
  const utcDay = bucketDate.getUTCDay() || 7;
  bucketDate.setUTCDate(bucketDate.getUTCDate() - utcDay + 1);
  bucketDate.setUTCHours(0, 0, 0, 0);
  return bucketDate.toISOString().slice(0, 10);
}

async function executeTimeseriesQuery(args: {
  plan: AiAnalyticsPlan;
  resolvedWhere: ResolvedVideoWhere;
}): Promise<ExecutionResult> {
  const videos = await prisma.video.findMany({
    where: args.resolvedWhere.where,
    select: {
      publishedAt: true,
      views: true,
      likes: true,
      comments: true,
      engagementRate: true,
    },
    orderBy: {
      publishedAt: "asc",
    },
  });
  const buckets = new Map<
    string,
    {
      videoCount: number;
      viewsTotal: number;
      likesTotal: number;
      commentsTotal: number;
      engagementRateTotal: number;
      engagementRateCount: number;
      viewsMax: number;
      viewsMin: number | null;
      likesMax: number;
      likesMin: number | null;
      commentsMax: number;
      commentsMin: number | null;
      engagementRateMax: number | null;
      engagementRateMin: number | null;
    }
  >();

  for (const video of videos) {
    if (!video.publishedAt) {
      continue;
    }

    const bucketKey = getBucketKey(video.publishedAt, args.plan.interval);
    const bucket = buckets.get(bucketKey) ?? {
      videoCount: 0,
      viewsTotal: 0,
      likesTotal: 0,
      commentsTotal: 0,
      engagementRateTotal: 0,
      engagementRateCount: 0,
      viewsMax: 0,
      viewsMin: null,
      likesMax: 0,
      likesMin: null,
      commentsMax: 0,
      commentsMin: null,
      engagementRateMax: null,
      engagementRateMin: null,
    };

    bucket.videoCount += 1;
    bucket.viewsTotal += video.views ?? 0;
    bucket.likesTotal += video.likes ?? 0;
    bucket.commentsTotal += video.comments ?? 0;
    bucket.viewsMax = Math.max(bucket.viewsMax, video.views ?? 0);
    bucket.likesMax = Math.max(bucket.likesMax, video.likes ?? 0);
    bucket.commentsMax = Math.max(bucket.commentsMax, video.comments ?? 0);
    bucket.viewsMin =
      bucket.viewsMin == null ? (video.views ?? 0) : Math.min(bucket.viewsMin, video.views ?? 0);
    bucket.likesMin =
      bucket.likesMin == null ? (video.likes ?? 0) : Math.min(bucket.likesMin, video.likes ?? 0);
    bucket.commentsMin =
      bucket.commentsMin == null
        ? (video.comments ?? 0)
        : Math.min(bucket.commentsMin, video.comments ?? 0);

    if (typeof video.engagementRate === "number") {
      bucket.engagementRateTotal += video.engagementRate;
      bucket.engagementRateCount += 1;
      bucket.engagementRateMax =
        bucket.engagementRateMax == null
          ? video.engagementRate
          : Math.max(bucket.engagementRateMax, video.engagementRate);
      bucket.engagementRateMin =
        bucket.engagementRateMin == null
          ? video.engagementRate
          : Math.min(bucket.engagementRateMin, video.engagementRate);
    }

    buckets.set(bucketKey, bucket);
  }

  const rows = [...buckets.entries()].map(([bucketKey, bucket]) => {
    let metricValue: number | null;

    switch (args.plan.metric) {
      case "videos":
        metricValue = bucket.videoCount;
        break;
      case "views":
        switch (args.plan.aggregation) {
          case "avg":
            metricValue = bucket.videoCount > 0 ? bucket.viewsTotal / bucket.videoCount : 0;
            break;
          case "max":
            metricValue = bucket.viewsMax;
            break;
          case "min":
            metricValue = bucket.viewsMin ?? 0;
            break;
          default:
            metricValue = bucket.viewsTotal;
        }
        break;
      case "likes":
        switch (args.plan.aggregation) {
          case "avg":
            metricValue = bucket.videoCount > 0 ? bucket.likesTotal / bucket.videoCount : 0;
            break;
          case "max":
            metricValue = bucket.likesMax;
            break;
          case "min":
            metricValue = bucket.likesMin ?? 0;
            break;
          default:
            metricValue = bucket.likesTotal;
        }
        break;
      case "comments":
        switch (args.plan.aggregation) {
          case "avg":
            metricValue = bucket.videoCount > 0 ? bucket.commentsTotal / bucket.videoCount : 0;
            break;
          case "max":
            metricValue = bucket.commentsMax;
            break;
          case "min":
            metricValue = bucket.commentsMin ?? 0;
            break;
          default:
            metricValue = bucket.commentsTotal;
        }
        break;
      default:
        switch (args.plan.aggregation) {
          case "max":
            metricValue = bucket.engagementRateMax ?? 0;
            break;
          case "min":
            metricValue = bucket.engagementRateMin ?? 0;
            break;
          default:
            metricValue =
              bucket.engagementRateCount > 0
                ? bucket.engagementRateTotal / bucket.engagementRateCount
                : 0;
        }
    }

    return {
      bucketKey,
      metricValue,
    };
  });
  const table: AiAnalyticsTable = {
    columns: [
      {
        key: "period",
        label: args.plan.interval === "week" ? "Week" : "Day",
      },
      {
        key: "value",
        label: `${getAggregationLabel(args.plan.aggregation)} ${getMetricLabel(args.plan.metric)}`,
      },
    ],
    rows: rows.map((row) => ({
      period: formatDateLabel(new Date(row.bucketKey)),
      value: formatMetricValue(args.plan.metric, row.metricValue),
    })),
  };
  const latestPoint = rows[rows.length - 1] ?? null;
  const peakPoint = [...rows].sort((left, right) =>
    compareSortValues(left.metricValue, right.metricValue, "desc"),
  )[0] ?? null;

  return {
    queryLabel: buildQueryLabel(args),
    generatedQuery: buildGeneratedQuery(args),
    summaryCards: [
      {
        label: "Buckets",
        value: formatWholeNumber(rows.length),
      },
      {
        label: "Latest value",
        value: latestPoint
          ? formatMetricValue(args.plan.metric, latestPoint.metricValue)
          : "--",
      },
      {
        label: "Peak value",
        value: peakPoint
          ? formatMetricValue(args.plan.metric, peakPoint.metricValue)
          : "--",
      },
    ],
    table,
    warnings: args.resolvedWhere.warnings,
    resultSummary: JSON.stringify({
      bucketCount: rows.length,
      points: table.rows.slice(-10),
    }),
  };
}

function buildFallbackAnswer(args: {
  prompt: string;
  plan: AiAnalyticsPlan;
  result: ExecutionResult;
}) {
  if (args.plan.intent === "unsupported") {
    return "I can answer questions about video, campaign, creator, platform, and publishing performance data. Try asking for top videos, campaign rankings, creator performance, or totals over a date range.";
  }

  if (args.result.table?.rows.length) {
    const firstRow = args.result.table.rows[0]!;

    switch (args.plan.intent) {
      case "video_ranking":
        return `${firstRow.title ?? "The top matching video"} leads this query, with ${firstRow.views ?? "--"} views and ${firstRow.engagement ?? "--"} engagement.`;
      case "campaign_ranking":
        return `${firstRow.campaign ?? "The leading campaign"} is on top for this query, with ${firstRow.views ?? "--"} views across ${firstRow.videos ?? "--"} videos.`;
      case "creator_ranking":
        return `${firstRow.creator ?? "The leading creator"} is at the top for this query, with ${firstRow.views ?? "--"} views across ${firstRow.videos ?? "--"} videos.`;
      case "timeseries":
        return `I mapped ${args.result.table.rows.length} time buckets for this request. The latest bucket shows ${firstRow.value ?? "--"}.`;
      default:
        break;
    }
  }

  const primaryCard = args.result.summaryCards[0];
  const supportingCard = args.result.summaryCards[1];

  return `${primaryCard?.label ?? "Result"} is ${primaryCard?.value ?? "--"}${supportingCard ? ` across ${supportingCard.value} matching videos` : ""}.`;
}

async function synthesizeAnswer(args: {
  prompt: string;
  plan: AiAnalyticsPlan;
  result: ExecutionResult;
}) {
  try {
    return await callOpenAiText({
      systemPrompt: [
        "You are an analytics assistant summarizing database query results.",
        "Answer using only the provided execution result.",
        "Be concise, direct, and helpful.",
        "Do not invent metrics, rows, or conclusions.",
        "If warnings are present, mention them briefly at the end.",
      ].join("\n"),
      userPrompt: [
        `Question: ${args.prompt}`,
        `Query label: ${args.result.queryLabel}`,
        `Warnings: ${args.result.warnings.join(" | ") || "none"}`,
        `Summary cards: ${JSON.stringify(args.result.summaryCards)}`,
        `Table: ${JSON.stringify(args.result.table)}`,
        `Execution summary: ${args.result.resultSummary}`,
      ].join("\n\n"),
    });
  } catch {
    return buildFallbackAnswer(args);
  }
}

async function executePlan(args: {
  prompt: string;
  plan: AiAnalyticsPlan;
  executionContext: QueryExecutionContext;
}): Promise<ExecutionResult> {
  if (args.plan.intent === "unsupported") {
    return {
      queryLabel: args.plan.title,
      generatedQuery: "Unsupported question type.",
      summaryCards: [],
      table: null,
      warnings: [],
      resultSummary: JSON.stringify({
        reason: "unsupported",
      }),
    };
  }

  const resolvedWhere = buildVideoWhereFromPlan({
    executionContext: args.executionContext,
    plan: args.plan,
  });

  switch (args.plan.intent) {
    case "summary":
      return executeSummaryQuery({
        plan: args.plan,
        resolvedWhere,
      });
    case "video_ranking":
      return executeVideoRankingQuery({
        plan: args.plan,
        resolvedWhere,
      });
    case "campaign_ranking":
      return executeCampaignRankingQuery({
        plan: args.plan,
        resolvedWhere,
      });
    case "creator_ranking":
      return executeCreatorRankingQuery({
        plan: args.plan,
        resolvedWhere,
      });
    case "timeseries":
      return executeTimeseriesQuery({
        plan: args.plan,
        resolvedWhere,
      });
    default:
      return {
        queryLabel: args.plan.title,
        generatedQuery: "Unsupported question type.",
        summaryCards: [],
        table: null,
        warnings: [],
        resultSummary: JSON.stringify({
          reason: "unsupported",
        }),
      };
  }
}

export async function askAiAnalyticsQuestion(args: {
  organizationSlug: string;
  prompt: string;
  messages: AiConversationMessage[];
  selectedCampaignIds: string[];
  selectedDateRange: string;
}): Promise<AiAnalyticsChatResponse> {
  const context = await getAiAnalyticsAccessContext(args.organizationSlug);
  const executionContext: QueryExecutionContext = {
    context,
    selectedCampaignIds: args.selectedCampaignIds,
    selectedDateRange: args.selectedDateRange,
  };
  const plan = await planAnalyticsQuery({
    context,
    prompt: args.prompt,
    messages: args.messages,
    selectedCampaignIds: args.selectedCampaignIds,
    selectedDateRange: args.selectedDateRange,
  });
  const result = await executePlan({
    prompt: args.prompt,
    plan,
    executionContext,
  });

  return {
    answer: await synthesizeAnswer({
      prompt: args.prompt,
      plan,
      result,
    }),
    queryLabel: result.queryLabel,
    generatedQuery: result.generatedQuery,
    summaryCards: result.summaryCards,
    table: result.table,
    warnings: result.warnings,
  };
}
