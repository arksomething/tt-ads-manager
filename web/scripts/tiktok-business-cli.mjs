#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const webRoot = path.resolve(path.dirname(scriptPath), "..");
const repoRoot = path.resolve(webRoot, "..");

const SAFE_GET_METHODS = new Set(["GET"]);
const DEFAULT_TIKTOK_BASE_URL = "https://business-api.tiktok.com";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 3;
const MAX_PAGE_SIZE = 1000;

class CliError extends Error {
  constructor(message, details = undefined) {
    super(message);
    this.name = "CliError";
    this.details = details;
  }
}

class TikTokApiError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "TikTokApiError";
    this.details = details;
  }
}

function parseEnvValue(rawValue) {
  let value = rawValue.trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return value
    .replaceAll("\\n", "\n")
    .replaceAll('\\"', '"')
    .replaceAll("\\'", "'");
}

function parseEnvFile(filePath) {
  const values = {};
  const text = readFileSync(filePath, "utf8");

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);

    if (!match) {
      continue;
    }

    values[match[1]] = parseEnvValue(match[2]);
  }

  return values;
}

function fileExists(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function loadEnv(options) {
  const envFiles = [];

  if (options.envFile) {
    envFiles.push(path.resolve(process.cwd(), options.envFile));
  } else {
    envFiles.push(
      path.join(webRoot, ".env"),
      path.join(webRoot, ".env.local"),
      path.join(repoRoot, ".env"),
      path.join(repoRoot, ".env.local"),
      path.join(webRoot, ".vercel", ".env.production.local"),
      path.join(repoRoot, ".vercel", ".env.production.local"),
      "/data/.openclaw/credentials/tiktok-ads.env",
    );
  }

  const loaded = {};

  for (const envFile of envFiles) {
    if (fileExists(envFile)) {
      Object.assign(loaded, parseEnvFile(envFile));
    }
  }

  return {
    ...loaded,
    ...process.env,
  };
}

function parseArgs(argv) {
  const positional = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--") {
      positional.push(...argv.slice(index + 1));
      break;
    }

    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const withoutPrefix = arg.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    let key = withoutPrefix;
    let value = true;

    if (equalsIndex >= 0) {
      key = withoutPrefix.slice(0, equalsIndex);
      value = withoutPrefix.slice(equalsIndex + 1);
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      value = argv[index + 1];
      index += 1;
    }

    const normalizedKey = key.replaceAll("-", "_");
    const existing = options[normalizedKey];

    if (existing === undefined) {
      options[normalizedKey] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      options[normalizedKey] = [existing, value];
    }
  }

  return {
    command: positional[0] ?? "help",
    positional: positional.slice(1),
    options,
  };
}

function option(options, name, fallback = undefined) {
  return options[name.replaceAll("-", "_")] ?? fallback;
}

function boolOption(options, name) {
  const value = option(options, name);

  if (value === undefined) {
    return false;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

function asArray(value) {
  if (value === undefined || value === null || value === false) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function parseCsv(value, fallback = []) {
  if (value === undefined || value === null || value === false) {
    return fallback;
  }

  return asArray(value)
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseJsonOption(options, name, fallback = undefined) {
  const value = option(options, name);

  if (value === undefined || value === null || value === false) {
    return fallback;
  }

  try {
    return JSON.parse(String(value));
  } catch (error) {
    throw new CliError(`--${name.replaceAll("_", "-")} must be valid JSON.`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function positiveIntegerOption(options, name, fallback, max = Number.MAX_SAFE_INTEGER) {
  const rawValue = option(options, name, fallback);
  const value = Number(rawValue);

  if (!Number.isInteger(value) || value <= 0) {
    throw new CliError(`--${name.replaceAll("_", "-")} must be a positive integer.`);
  }

  return Math.min(value, max);
}

function requiredString(options, name, fallback = undefined) {
  const value = option(options, name, fallback);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CliError(`Missing required --${name.replaceAll("_", "-")}.`);
  }

  return value.trim();
}

function dateStringOption(options, name) {
  const value = requiredString(options, name);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CliError(`--${name.replaceAll("_", "-")} must be YYYY-MM-DD.`);
  }

  return value;
}

function firstEnv(env, keys) {
  for (const key of keys) {
    const value = env[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function serviceRoleKey(env) {
  return firstEnv(env, [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SK",
    "SUPABASE_ANON_KEY",
    "SUPABASE_PK",
  ]);
}

function redactValue(key, value) {
  if (
    /token|secret|key|authorization|auth_?code|password|cookie/i.test(key) &&
    typeof value === "string"
  ) {
    return value ? "<redacted>" : value;
  }

  if (
    typeof value === "string" &&
    /^(error|message|warning|warnings|hint|reason|detail|diagnostic|name|ad_name|ad_text|recommendedCommand|parentMoveCommand|executeHint|copyInstead|moveBehavior|defaultSourceAction)$/i.test(
      key,
    )
  ) {
    return value.length > 2000 ? `${value.slice(0, 2000)}... <truncated:${value.length}>` : value;
  }

  if (typeof value === "string" && value.length > 96) {
    return `<string:${value.length}>`;
  }

  return value;
}

function redactDeep(value, key = "") {
  if (Array.isArray(value)) {
    return value.map((entry) => redactDeep(entry, key));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactDeep(redactValue(entryKey, entryValue), entryKey),
      ]),
    );
  }

  return redactValue(key, value);
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(redactDeep(value), null, 2)}\n`);
}

function uniqueNonEmptyStrings(values) {
  return [
    ...new Set(
      values
        .map((value) => (value === undefined || value === null ? "" : String(value).trim()))
        .filter(Boolean),
    ),
  ];
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function arrayFrom(value) {
  return Array.isArray(value) ? value : [];
}

function lower(value) {
  return String(value ?? "").toLowerCase();
}

function displayString(value, maxLength = 92) {
  const text = nonEmptyString(value);

  if (!text) {
    return null;
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function searchTokens(value) {
  return normalizeSearchText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function isNumericToken(value) {
  return /^[0-9]+$/.test(String(value));
}

function levenshteinDistance(left, right) {
  if (left === right) {
    return 0;
  }

  if (left.length === 0) {
    return right.length;
  }

  if (right.length === 0) {
    return left.length;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];

    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex] === right[rightIndex] ? 0 : 1;

      current[rightIndex + 1] = Math.min(
        current[rightIndex] + 1,
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + substitutionCost,
      );
    }

    previous = current;
  }

  return previous[right.length];
}

function tokenSimilarity(left, right) {
  const maxLength = Math.max(left.length, right.length);

  if (maxLength === 0) {
    return 1;
  }

  return 1 - levenshteinDistance(left, right) / maxLength;
}

function fuzzyThresholdForToken(token) {
  if (token.length <= 3) {
    return 1;
  }

  if (token.length <= 5) {
    return 0.78;
  }

  return 0.72;
}

function bestTokenMatch(queryToken, candidateTokens) {
  let best = null;

  for (const candidateToken of candidateTokens) {
    if (queryToken === candidateToken) {
      return {
        token: candidateToken,
        score: 1,
        kind: "exact",
      };
    }

    if (candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) {
      const shorterLength = Math.min(queryToken.length, candidateToken.length);
      const longerLength = Math.max(queryToken.length, candidateToken.length);
      const score = shorterLength / longerLength;

      if (score > (best?.score ?? 0)) {
        best = {
          token: candidateToken,
          score,
          kind: "contains",
        };
      }
      continue;
    }

    if (isNumericToken(queryToken) || isNumericToken(candidateToken)) {
      continue;
    }

    const score = tokenSimilarity(queryToken, candidateToken);

    if (score >= fuzzyThresholdForToken(queryToken) && score > (best?.score ?? 0)) {
      best = {
        token: candidateToken,
        score,
        kind: "fuzzy",
      };
    }
  }

  return best;
}

function phraseMatch(value, query) {
  const queryTokens = searchTokens(query);
  const candidateTokens = searchTokens(value);

  if (queryTokens.length === 0 || candidateTokens.length === 0) {
    return null;
  }

  const tokenMatches = [];

  for (const queryToken of queryTokens) {
    const match = bestTokenMatch(queryToken, candidateTokens);

    if (!match) {
      return null;
    }

    tokenMatches.push({ queryToken, ...match });
  }

  const score =
    tokenMatches.reduce((total, match) => total + match.score, 0) / tokenMatches.length;
  const kind = tokenMatches.some((match) => match.kind === "fuzzy")
    ? "fuzzy"
    : tokenMatches.some((match) => match.kind === "contains")
      ? "contains"
      : "exact";

  return {
    kind,
    score,
    tokens: tokenMatches,
  };
}

function searchModeFromOptions(options) {
  const mode = String(option(options, "match", "fuzzy")).toLowerCase();

  if (!["exact", "contains", "fuzzy"].includes(mode)) {
    throw new CliError("--match must be exact, contains, or fuzzy.");
  }

  return mode;
}

function fieldContains(value, query) {
  return lower(value).includes(query);
}

function matchesEntityFilter(entity, filter, mode = "fuzzy") {
  const value = nonEmptyString(filter);

  if (!value) {
    return true;
  }

  const needle = lower(value);
  const entries = [entity?.id, entity?.name].filter(Boolean);

  return entries.some((entry) => {
    if (directSearchMatch("filter", entry, needle, mode)) {
      return true;
    }

    return Boolean(fuzzySearchMatch("filter", entry, value, mode));
  });
}

function tikTokBaseUrl(env) {
  return (env.TIKTOK_BUSINESS_BASE_URL || DEFAULT_TIKTOK_BASE_URL).replace(/\/+$/, "");
}

function normalizeTikTokPath(inputPath) {
  const raw = String(inputPath || "").trim();

  if (!raw) {
    throw new CliError("Missing TikTok API path.");
  }

  if (raw.startsWith("/open_api/")) {
    return raw;
  }

  if (raw.startsWith("open_api/")) {
    return `/${raw}`;
  }

  if (raw.startsWith("/v1.3/")) {
    return `/open_api${raw}`;
  }

  if (raw.startsWith("v1.3/")) {
    return `/open_api/${raw}`;
  }

  return `/open_api/v1.3/${raw.replace(/^\/+/, "")}`;
}

function buildUrl(baseUrl, apiPath, query) {
  const url = new URL(`${baseUrl}${normalizeTikTokPath(apiPath)}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === false) {
      continue;
    }

    url.searchParams.set(
      key,
      typeof value === "object" ? JSON.stringify(value) : String(value),
    );
  }

  return url;
}

function tikTokRequestSummary(args, method) {
  return compactObject({
    method,
    path: args.path,
    query: args.query,
    body: args.body,
  });
}

async function requestTikTok(env, args) {
  const method = (args.method ?? "GET").toUpperCase();
  const accessToken = args.accessToken ?? null;

  if (!accessToken) {
    throw new CliError("No TikTok access token is available.");
  }

  const response = await fetch(buildUrl(tikTokBaseUrl(env), args.path, args.query), {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Access-Token": accessToken,
      Authorization: `Bearer ${accessToken}`,
    },
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
  });
  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new TikTokApiError(
      payload?.message ?? `TikTok API request failed with HTTP ${response.status}.`,
      {
        httpStatus: response.status,
        code: payload?.code ?? null,
        requestId: payload?.request_id ?? null,
        request: tikTokRequestSummary(args, method),
        payload,
      },
    );
  }

  if (payload?.code && payload.code !== 0) {
    throw new TikTokApiError(payload.message ?? "TikTok API returned an error.", {
      httpStatus: response.status,
      code: payload.code,
      requestId: payload.request_id ?? null,
      request: tikTokRequestSummary(args, method),
      payload,
    });
  }

  return {
    httpStatus: response.status,
    requestId: payload?.request_id ?? null,
    message: payload?.message ?? null,
    data: payload?.data ?? payload,
  };
}

async function requestTikTokMultipart(env, args) {
  const method = (args.method ?? "POST").toUpperCase();
  const accessToken = args.accessToken ?? null;

  if (!accessToken) {
    throw new CliError("No TikTok access token is available.");
  }

  const response = await fetch(buildUrl(tikTokBaseUrl(env), args.path, args.query), {
    method,
    headers: {
      Accept: "application/json",
      "Access-Token": accessToken,
      Authorization: `Bearer ${accessToken}`,
    },
    body: args.form,
  });
  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new TikTokApiError(
      payload?.message ?? `TikTok API request failed with HTTP ${response.status}.`,
      {
        httpStatus: response.status,
        code: payload?.code ?? null,
        requestId: payload?.request_id ?? null,
        request: tikTokRequestSummary(args, method),
        payload,
      },
    );
  }

  if (payload?.code && payload.code !== 0) {
    throw new TikTokApiError(payload.message ?? "TikTok API returned an error.", {
      httpStatus: response.status,
      code: payload.code,
      requestId: payload.request_id ?? null,
      request: tikTokRequestSummary(args, method),
      payload,
    });
  }

  return {
    httpStatus: response.status,
    requestId: payload?.request_id ?? null,
    message: payload?.message ?? null,
    data: payload?.data ?? payload,
  };
}

async function supabaseSelect(env, table, query) {
  const supabaseUrl = firstEnv(env, ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const key = serviceRoleKey(env);

  if (!supabaseUrl || !key) {
    throw new CliError(
      "Supabase credentials are required. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SK.",
    );
  }

  const url = new URL(`/rest/v1/${table}`, supabaseUrl.replace(/\/+$/, ""));

  for (const [queryKey, queryValue] of Object.entries(query)) {
    if (queryValue !== undefined && queryValue !== null) {
      url.searchParams.set(queryKey, String(queryValue));
    }
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new CliError(`Supabase query failed for ${table}.`, {
      httpStatus: response.status,
      payload,
    });
  }

  return Array.isArray(payload) ? payload : [];
}

async function findOrganization(env, organizationSlug) {
  if (!organizationSlug) {
    return null;
  }

  const organizations = await supabaseSelect(env, "Organization", {
    select: "id,slug,name",
    slug: `eq.${organizationSlug}`,
    limit: "1",
  });

  return organizations[0] ?? null;
}

async function listTikTokAccounts(env, options) {
  const explicitOrg = option(options, "org") ?? option(options, "organization");
  const organizationSlug =
    explicitOrg || env.TT_ADS_DEFAULT_ORG_SLUG || env.TIKTOK_DEFAULT_ORG_SLUG || null;
  const advertiserId = option(options, "advertiser_id");
  const organization = await findOrganization(env, organizationSlug);

  if (organizationSlug && !organization) {
    throw new CliError(`No organization found for slug "${organizationSlug}".`);
  }

  const query = {
    select:
      "id,organizationId,advertiserId,advertiserName,status,accessToken,refreshToken,accessTokenExpiresAt,refreshTokenExpiresAt,scope,lastValidatedAt,updatedAt",
    order: "updatedAt.desc",
    limit: String(positiveIntegerOption(options, "limit", 20, 100)),
  };

  if (organization) {
    query.organizationId = `eq.${organization.id}`;
  }

  if (advertiserId) {
    query.advertiserId = `eq.${advertiserId}`;
  }

  const accounts = await supabaseSelect(env, "OrganizationTikTokAccount", query);

  return {
    organization,
    accounts,
  };
}

async function selectedTikTokAccount(env, options) {
  const accessToken = option(options, "access_token") || env.TIKTOK_ACCESS_TOKEN;
  const advertiserId =
    option(options, "advertiser_id") ||
    option(options, "advertiser") ||
    env.TIKTOK_ADVERTISER_ID;

  if (accessToken && advertiserId) {
    return {
      organization: null,
      account: {
        advertiserId,
        advertiserName: null,
        accessToken,
        status: "ENV",
      },
      warnings: ["Using TIKTOK_ACCESS_TOKEN / TIKTOK_ADVERTISER_ID from environment."],
    };
  }

  const { organization, accounts } = await listTikTokAccounts(env, {
    ...options,
    limit: option(options, "limit", 20),
  });
  const activeAccount = accounts.find((account) => account.status === "ACTIVE") ?? accounts[0];

  if (!activeAccount) {
    throw new CliError(
      "No saved TikTok advertiser account was found. Connect TikTok in the app or provide --access-token and --advertiser-id.",
    );
  }

  if (!activeAccount.accessToken || !activeAccount.advertiserId) {
    throw new CliError("The selected TikTok account is missing an access token or advertiser ID.");
  }

  return {
    organization,
    account: activeAccount,
    warnings: activeAccount.status === "ACTIVE" ? [] : [`Using account with status ${activeAccount.status}.`],
  };
}

function rowListFromTikTokData(data) {
  if (Array.isArray(data?.list)) {
    return data.list;
  }

  if (Array.isArray(data?.identity_list)) {
    return data.identity_list;
  }

  if (Array.isArray(data?.video_list)) {
    return data.video_list;
  }

  if (Array.isArray(data?.rows)) {
    return data.rows;
  }

  if (Array.isArray(data)) {
    return data;
  }

  return [];
}

function totalPagesFromTikTokData(data, rowCount, pageSize, maxPages) {
  const pageInfo = data?.page_info ?? {};
  const totalPage =
    Number(pageInfo.total_page ?? pageInfo.total_pages ?? pageInfo.totalPage) || null;

  if (totalPage && totalPage > 0) {
    return Math.min(totalPage, maxPages);
  }

  const totalNumber =
    Number(pageInfo.total_number ?? pageInfo.total_count ?? pageInfo.total) || null;

  if (totalNumber && totalNumber > 0) {
    return Math.min(Math.ceil(totalNumber / pageSize), maxPages);
  }

  return rowCount >= pageSize ? maxPages : 1;
}

async function pagedList(env, args) {
  const rows = [];
  const pageSize = args.pageSize;
  let totalPages = 1;
  let lastResponse = null;

  for (let page = 1; page <= totalPages && page <= args.maxPages; page += 1) {
    const response = await requestTikTok(env, {
      accessToken: args.accessToken,
      method: "GET",
      path: args.path,
      query: {
        ...args.query,
        page,
        page_size: pageSize,
      },
    });
    const pageRows = rowListFromTikTokData(response.data);

    rows.push(...pageRows);
    lastResponse = response;
    totalPages = totalPagesFromTikTokData(response.data, pageRows.length, pageSize, args.maxPages);

    if (pageRows.length < pageSize) {
      break;
    }
  }

  return {
    requestId: lastResponse?.requestId ?? null,
    rows,
    rowCount: rows.length,
    truncated: totalPages > args.maxPages,
  };
}

function selectedFields(options, fallback) {
  const fields = parseCsv(option(options, "fields"), []);

  return fields.length > 0 ? fields : fallback;
}

function listQuery(options, advertiserId) {
  const filtering = parseJsonOption(options, "filtering", undefined);
  const fields = selectedFields(options, undefined);

  return {
    advertiser_id: advertiserId,
    ...(fields ? { fields } : {}),
    ...(filtering ? { filtering } : {}),
  };
}

async function handleListCommand(env, options, pathName, defaultFields) {
  const { organization, account, warnings } = await selectedTikTokAccount(env, options);
  const limit = positiveIntegerOption(options, "limit", 100, 1000);
  const pageSize = Math.min(
    positiveIntegerOption(options, "page_size", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
    limit,
  );
  const maxPages = option(options, "pages")
    ? positiveIntegerOption(options, "pages", DEFAULT_MAX_PAGES, 20)
    : Math.max(1, Math.ceil(limit / pageSize));
  const query = {
    ...listQuery(options, account.advertiserId),
    ...(defaultFields && !option(options, "fields") ? { fields: defaultFields } : {}),
  };
  const result = await pagedList(env, {
    accessToken: account.accessToken,
    path: `/open_api/v1.3/${pathName}/get/`,
    query,
    pageSize,
    maxPages,
  });

  printJson({
    organization: organization ? { slug: organization.slug, name: organization.name } : null,
    advertiser: {
      advertiserId: account.advertiserId,
      advertiserName: account.advertiserName ?? null,
    },
    warnings,
    ...result,
    rows: result.rows.slice(0, limit),
    rowCount: Math.min(result.rowCount, limit),
  });
}

const SEARCH_CAMPAIGN_FIELDS = [
  "campaign_id",
  "campaign_name",
  "operation_status",
  "secondary_status",
];

const SEARCH_ADGROUP_FIELDS = [
  "adgroup_id",
  "adgroup_name",
  "campaign_id",
  "operation_status",
  "secondary_status",
];

const SEARCH_AD_FIELDS = [
  "ad_id",
  "ad_name",
  "campaign_id",
  "adgroup_id",
  "operation_status",
  "secondary_status",
  "tiktok_item_id",
  "smart_plus_ad_id",
  "campaign_automation_type",
  "ad_text",
  "identity_id",
  "identity_type",
  "video_id",
  "image_ids",
];

const SPARK_TEMPLATE_AD_FIELDS = [
  ...SEARCH_AD_FIELDS,
  "ad_format",
  "ad_text",
  "call_to_action",
  "landing_page_url",
  "deeplink",
  "deeplink_type",
  "app_name",
  "display_name",
  "profile_image_url",
  "avatar_icon_web_uri",
  "impression_tracking_url",
  "click_tracking_url",
  "creative_authorized",
];

const SMART_PLUS_MOVE_COPY_FIELDS = [
  "ad_text_list",
  "ad_configuration",
  "page_list",
  "creative_list",
  "landing_page_url_list",
  "deeplink_list",
];

function organizationSummary(organization) {
  return organization ? { slug: organization.slug, name: organization.name } : null;
}

function advertiserSummary(account) {
  return {
    advertiserId: account.advertiserId,
    advertiserName: account.advertiserName ?? null,
  };
}

function pickString(record, fieldNames) {
  for (const fieldName of fieldNames) {
    const value = nonEmptyString(record?.[fieldName]);

    if (value) {
      return value;
    }
  }

  return null;
}

function firstArrayValue(record, fieldNames) {
  for (const fieldName of fieldNames) {
    if (Array.isArray(record?.[fieldName])) {
      return record[fieldName];
    }
  }

  return [];
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => {
      if (entryValue === undefined || entryValue === null) {
        return false;
      }

      if (Array.isArray(entryValue) && entryValue.length === 0) {
        return false;
      }

      if (isRecord(entryValue) && Object.keys(entryValue).length === 0) {
        return false;
      }

      return true;
    }),
  );
}

function idNameEntity(row, idField, nameField) {
  return {
    id: pickString(row, [idField, "id"]),
    name: pickString(row, [nameField, "name"]),
    operationStatus: pickString(row, ["operation_status", "status"]),
    secondaryStatus: pickString(row, ["secondary_status"]),
  };
}

function fieldValueList(value) {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => fieldValueList(entry));
  }

  if (value === undefined || value === null || value === false) {
    return [];
  }

  return [String(value)];
}

function tiktokItemIdsFromSmartPlusAd(smartPlusAd) {
  const directIds = [
    ...fieldValueList(smartPlusAd?.tiktok_item_id),
    ...fieldValueList(smartPlusAd?.tiktok_item_ids),
  ];
  const creativeIds = arrayFrom(smartPlusAd?.creative_list).flatMap((creative) => [
    ...fieldValueList(creative?.tiktok_item_id),
    ...fieldValueList(creative?.creative_info?.tiktok_item_id),
    ...fieldValueList(creative?.creative_info?.tiktok_item_ids),
  ]);

  return uniqueNonEmptyStrings([...directIds, ...creativeIds]);
}

function tiktokItemIdsFromAd(ad, smartPlusAd = null) {
  return uniqueNonEmptyStrings([
    ...fieldValueList(ad?.tiktok_item_id),
    ...fieldValueList(ad?.tiktok_item_ids),
    ...tiktokItemIdsFromSmartPlusAd(smartPlusAd),
  ]);
}

function videoIdsFromCreativeInfo(creativeInfo) {
  return uniqueNonEmptyStrings([
    ...fieldValueList(creativeInfo?.video_id),
    ...fieldValueList(creativeInfo?.video_ids),
  ]);
}

function imageIdsFromCreativeInfo(creativeInfo) {
  return uniqueNonEmptyStrings([
    ...fieldValueList(creativeInfo?.image_id),
    ...fieldValueList(creativeInfo?.image_ids),
  ]);
}

function videoIdsFromAd(ad, smartPlusAd = null) {
  const smartPlusVideoIds = arrayFrom(smartPlusAd?.creative_list).flatMap((creative) => [
    ...videoIdsFromCreativeInfo(creative),
    ...videoIdsFromCreativeInfo(creative?.creative_info),
  ]);

  return uniqueNonEmptyStrings([
    ...fieldValueList(ad?.video_id),
    ...fieldValueList(ad?.video_ids),
    ...smartPlusVideoIds,
  ]);
}

function imageIdsFromAd(ad, smartPlusAd = null) {
  const smartPlusImageIds = arrayFrom(smartPlusAd?.creative_list).flatMap((creative) => [
    ...imageIdsFromCreativeInfo(creative),
    ...imageIdsFromCreativeInfo(creative?.creative_info),
  ]);

  return uniqueNonEmptyStrings([
    ...fieldValueList(ad?.image_id),
    ...fieldValueList(ad?.image_ids),
    ...smartPlusImageIds,
  ]);
}

async function fetchTikTokRows(env, account, pathName, query, options, fallbackLimit = 1000) {
  const limit = positiveIntegerOption(options, "fetch_limit", fallbackLimit, 5000);
  const pageSize = Math.min(
    positiveIntegerOption(options, "page_size", DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
    limit,
  );
  const maxPages = option(options, "pages")
    ? positiveIntegerOption(options, "pages", DEFAULT_MAX_PAGES, 50)
    : Math.max(1, Math.ceil(limit / pageSize));
  const result = await pagedList(env, {
    accessToken: account.accessToken,
    path: pathName,
    query,
    pageSize,
    maxPages,
  });

  return {
    ...result,
    rows: result.rows.slice(0, limit),
    rowCount: Math.min(result.rowCount, limit),
  };
}

async function fetchCampaignsForContext(env, account, options) {
  const result = await fetchTikTokRows(
    env,
    account,
    "/open_api/v1.3/campaign/get/",
    {
      advertiser_id: account.advertiserId,
      fields: SEARCH_CAMPAIGN_FIELDS,
    },
    options,
  );

  return result.rows.map((row) => idNameEntity(row, "campaign_id", "campaign_name"));
}

async function fetchAdgroupsForContext(env, account, options) {
  const result = await fetchTikTokRows(
    env,
    account,
    "/open_api/v1.3/adgroup/get/",
    {
      advertiser_id: account.advertiserId,
      fields: SEARCH_ADGROUP_FIELDS,
    },
    options,
  );

  return result.rows.map((row) => ({
    ...idNameEntity(row, "adgroup_id", "adgroup_name"),
    campaignId: pickString(row, ["campaign_id"]),
  }));
}

async function fetchAdsForContext(env, account, options) {
  const result = await fetchTikTokRows(
    env,
    account,
    "/open_api/v1.3/ad/get/",
    {
      advertiser_id: account.advertiserId,
      fields: SEARCH_AD_FIELDS,
    },
    options,
  );

  return result.rows;
}

async function fetchSmartPlusAdsForContext(env, account, options, filtering = undefined) {
  const query = {
    advertiser_id: account.advertiserId,
    ...(filtering ? { filtering } : {}),
  };

  return fetchTikTokRows(
    env,
    account,
    "/open_api/v1.3/smart_plus/ad/get/",
    query,
    options,
  );
}

function parseMaybeDate(value) {
  const text = nonEmptyString(value);

  if (!text) {
    return null;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSparkAuthorizationActive(authorization, now = new Date()) {
  const start = parseMaybeDate(authorization.authStartTime);
  const end = parseMaybeDate(authorization.authEndTime);

  return (
    authorization.status === "AUTHORIZED" &&
    Boolean(nonEmptyString(authorization.tiktokItemId)) &&
    (!start || start <= now) &&
    (!end || end >= now)
  );
}

function supabaseInFilter(values) {
  return `in.(${uniqueNonEmptyStrings(values).join(",")})`;
}

async function supabaseSelectByIds(env, table, select, ids) {
  const uniqueIds = uniqueNonEmptyStrings(ids);

  if (uniqueIds.length === 0) {
    return [];
  }

  return supabaseSelect(env, table, {
    select,
    id: supabaseInFilter(uniqueIds),
    limit: String(uniqueIds.length),
  });
}

async function creatorAccountsByCreatorId(env, creatorIds) {
  const uniqueIds = uniqueNonEmptyStrings(creatorIds);

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const accounts = await supabaseSelect(env, "CreatorPlatformAccount", {
    select: "id,creatorId,platform,handle,sourceAccountId,profileUrl",
    creatorId: supabaseInFilter(uniqueIds),
    limit: String(Math.min(uniqueIds.length * 5, 5000)),
  });
  const byCreatorId = new Map();

  for (const account of accounts) {
    const creatorId = nonEmptyString(account.creatorId);

    if (!creatorId) {
      continue;
    }

    const current = byCreatorId.get(creatorId) ?? [];
    current.push(account);
    byCreatorId.set(creatorId, current);
  }

  return byCreatorId;
}

async function enrichSparkAuthorizations(env, authorizations) {
  const creators = await supabaseSelectByIds(
    env,
    "Creator",
    "id,displayName,internalStatus,region,language",
    authorizations.map((authorization) => authorization.creatorId),
  );
  const videos = await supabaseSelectByIds(
    env,
    "Video",
    "id,sourceVideoId,videoUrl,titleOrCaption,publishedAt,createdAt,campaignId",
    authorizations.map((authorization) => authorization.videoId),
  );
  const accountsByCreatorId = await creatorAccountsByCreatorId(
    env,
    authorizations.map((authorization) => authorization.creatorId),
  );
  const creatorsById = new Map(creators.map((creator) => [creator.id, creator]));
  const videosById = new Map(videos.map((video) => [video.id, video]));

  return authorizations.map((authorization) => {
    const creator = creatorsById.get(authorization.creatorId) ?? null;
    const video = videosById.get(authorization.videoId) ?? null;
    const platformAccounts = accountsByCreatorId.get(authorization.creatorId) ?? [];

    return {
      ...authorization,
      active: isSparkAuthorizationActive(authorization),
      creator: creator
        ? {
            id: creator.id,
            displayName: creator.displayName ?? null,
            internalStatus: creator.internalStatus ?? null,
            region: creator.region ?? null,
            language: creator.language ?? null,
            accounts: platformAccounts.map((account) => ({
              id: account.id,
              platform: account.platform ?? null,
              handle: account.handle ?? null,
              sourceAccountId: account.sourceAccountId ?? null,
              profileUrl: account.profileUrl ?? null,
            })),
          }
        : null,
      video: video
        ? {
            id: video.id,
            sourceVideoId: video.sourceVideoId ?? null,
            videoUrl: video.videoUrl ?? null,
            titleOrCaption: displayString(video.titleOrCaption, 160),
            publishedAt: video.publishedAt ?? null,
            createdAt: video.createdAt ?? null,
            campaignId: video.campaignId ?? null,
          }
        : null,
      preview: authorization.tiktokItemId
        ? tiktokItemPreviewLinks(authorization.tiktokItemId)
        : null,
    };
  });
}

function sparkAuthorizationMatchesCreator(row, creatorQuery) {
  const query = nonEmptyString(creatorQuery);

  if (!query) {
    return true;
  }

  const normalizedQuery = normalizeSearchText(query);
  const values = [
    row.creatorId,
    row.creator?.id,
    row.creator?.displayName,
    ...(row.creator?.accounts ?? []).flatMap((account) => [
      account.handle,
      account.sourceAccountId,
      account.profileUrl,
    ]),
  ];

  return values.some((value) => {
    const normalizedValue = normalizeSearchText(value);
    return normalizedValue === normalizedQuery || normalizedValue.includes(normalizedQuery);
  });
}

function publicSparkAuthorization(row) {
  return compactObject({
    id: row.id,
    source: row.source,
    status: row.status,
    active: row.active,
    advertiserId: row.advertiserId,
    creator: row.creator,
    video: row.video,
    tiktokItemId: row.tiktokItemId,
    preview: row.preview,
    identityType: row.identityType,
    identityId: row.identityId,
    identityAuthorizedBcId: row.identityAuthorizedBcId,
    authStartTime: row.authStartTime,
    authEndTime: row.authEndTime,
    lastError: row.lastError,
    sparkCodeRequestId: row.sparkCodeRequestId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function sparkApiVideoItemInfo(row) {
  return isRecord(row?.item_info) ? row.item_info : {};
}

function sparkApiVideoAuthInfo(row) {
  return isRecord(row?.auth_info) ? row.auth_info : {};
}

function sparkApiVideoUserInfo(row) {
  return isRecord(row?.user_info) ? row.user_info : {};
}

function sparkApiVideoItemId(row) {
  return pickString(sparkApiVideoItemInfo(row), ["item_id", "tiktok_item_id"]);
}

function sparkApiVideoAuthStatus(row) {
  return pickString(sparkApiVideoAuthInfo(row), ["ad_auth_status", "status"]);
}

function isTikTokSparkVideoActive(row) {
  const authInfo = sparkApiVideoAuthInfo(row);
  const itemInfo = sparkApiVideoItemInfo(row);
  const now = new Date();
  const start = parseMaybeDate(authInfo.auth_start_time);
  const end = parseMaybeDate(authInfo.auth_end_time);
  const authStatus = sparkApiVideoAuthStatus(row);
  const itemStatus = pickString(itemInfo, ["status"]);

  return (
    authStatus === "AUTHORIZED" &&
    Boolean(sparkApiVideoItemId(row)) &&
    itemStatus !== "USER_DELETE" &&
    (!start || start <= now) &&
    (!end || end >= now)
  );
}

function sparkApiVideoMatchesCreator(row, creatorQuery) {
  const query = nonEmptyString(creatorQuery);

  if (!query) {
    return true;
  }

  const normalizedQuery = normalizeSearchText(query);
  const userInfo = sparkApiVideoUserInfo(row);
  const itemInfo = sparkApiVideoItemInfo(row);
  const values = [
    userInfo.identity_id,
    userInfo.identity_type,
    userInfo.tiktok_name,
    itemInfo.text,
  ];

  return values.some((value) => {
    const normalizedValue = normalizeSearchText(value);
    return normalizedValue === normalizedQuery || normalizedValue.includes(normalizedQuery);
  });
}

function publicTikTokSparkVideo(row, options = {}) {
  const itemInfo = sparkApiVideoItemInfo(row);
  const authInfo = sparkApiVideoAuthInfo(row);
  const userInfo = sparkApiVideoUserInfo(row);
  const itemId = sparkApiVideoItemId(row);
  const includeAuthCode = Boolean(options.includeAuthCode);

  return compactObject({
    source: "tiktok_api",
    active: isTikTokSparkVideoActive(row),
    authStatus: pickString(authInfo, ["ad_auth_status", "status"]),
    authStartTime: pickString(authInfo, ["auth_start_time"]),
    authEndTime: pickString(authInfo, ["auth_end_time"]),
    inviteStartTime: pickString(authInfo, ["invite_start_time"]),
    itemId,
    itemType: pickString(itemInfo, ["item_type"]),
    itemStatus: pickString(itemInfo, ["status"]),
    text: displayString(pickString(itemInfo, ["text"]), 220),
    preview: itemId ? tiktokItemPreviewLinks(itemId) : null,
    identityType: pickString(userInfo, ["identity_type"]),
    identityId: pickString(userInfo, ["identity_id"]),
    tiktokName: pickString(userInfo, ["tiktok_name", "display_name"]),
    videoInfo: isRecord(row.video_info) ? row.video_info : itemInfo.video_info,
    carouselInfo: itemInfo.carousel_info,
    ...(includeAuthCode ? { authCode: pickString(itemInfo, ["auth_code"]) } : {}),
  });
}

function sparkAuthorizationFromTikTokSparkVideo(row, account) {
  const itemInfo = sparkApiVideoItemInfo(row);
  const authInfo = sparkApiVideoAuthInfo(row);
  const userInfo = sparkApiVideoUserInfo(row);
  const itemId = sparkApiVideoItemId(row);
  const identityType = pickString(userInfo, ["identity_type"]);
  const identityId = pickString(userInfo, ["identity_id"]);

  if (!itemId || !identityType || !identityId) {
    throw new CliError("TikTok Spark API row is missing item_id, identity_type, or identity_id.", {
      row: publicTikTokSparkVideo(row),
    });
  }

  return {
    id: `tt_video:${itemId}`,
    source: "tiktok_api",
    status: sparkApiVideoAuthStatus(row),
    active: isTikTokSparkVideoActive(row),
    advertiserId: account.advertiserId,
    creator: {
      displayName: pickString(userInfo, ["tiktok_name", "display_name"]),
      accounts: [],
    },
    video: {
      sourceVideoId: itemId,
      titleOrCaption: displayString(pickString(itemInfo, ["text"]), 160),
    },
    tiktokItemId: itemId,
    preview: tiktokItemPreviewLinks(itemId),
    identityType,
    identityId,
    identityAuthorizedBcId: pickString(userInfo, ["identity_authorized_bc_id"]),
    authStartTime: pickString(authInfo, ["auth_start_time"]),
    authEndTime: pickString(authInfo, ["auth_end_time"]),
  };
}

async function loadTikTokSparkVideos(env, options, selected, config = {}) {
  const activeOnly = config.activeOnlyDefault
    ? !boolOption(options, "include_inactive")
    : boolOption(options, "active_only");
  const limit = positiveIntegerOption(options, "limit", config.defaultLimit ?? 100, 5000);
  const fetchLimit = Math.min(
    positiveIntegerOption(options, "spark_fetch_limit", Math.max(limit, 100), 5000),
    5000,
  );
  const pageSize = Math.min(positiveIntegerOption(options, "page_size", 50, 50), fetchLimit);
  const result = await fetchTikTokRows(
    env,
    selected.account,
    "/open_api/v1.3/tt_video/list/",
    {
      advertiser_id: selected.account.advertiserId,
    },
    {
      ...options,
      fetch_limit: fetchLimit,
      page_size: pageSize,
    },
    fetchLimit,
  );
  const tiktokItemId = stringOption(options, "tiktok_item_id") ?? stringOption(options, "item_id");
  const authStatus = stringOption(options, "auth_status") ?? stringOption(options, "status");
  const creatorFilter = option(options, "creator");
  const filtered = result.rows
    .filter((row) => !activeOnly || isTikTokSparkVideoActive(row))
    .filter((row) => !tiktokItemId || sparkApiVideoItemId(row) === tiktokItemId)
    .filter((row) => !authStatus || sparkApiVideoAuthStatus(row) === authStatus.toUpperCase())
    .filter((row) => sparkApiVideoMatchesCreator(row, creatorFilter));

  return {
    activeOnly,
    rows: filtered.slice(0, limit),
    fetchedCount: result.rowCount,
    filteredCount: filtered.length,
    truncated: result.truncated || filtered.length > limit || result.rowCount >= fetchLimit,
    requestId: result.requestId,
  };
}

async function handleTikTokSparkVideos(env, options) {
  const selected = await selectedTikTokAccount(env, options);
  const result = await loadTikTokSparkVideos(env, options, selected, {
    activeOnlyDefault: false,
  });

  printJson({
    organization: organizationSummary(selected.organization),
    advertiser: advertiserSummary(selected.account),
    warnings: selected.warnings,
    source: "tiktok_api",
    activeOnly: result.activeOnly,
    fetchedCount: result.fetchedCount,
    filteredCount: result.filteredCount,
    returnedCount: result.rows.length,
    truncated: result.truncated,
    rows: result.rows.map((row) =>
      publicTikTokSparkVideo(row, {
        includeAuthCode: boolOption(options, "include_auth_code"),
      }),
    ),
  });
}

async function getTikTokSparkUnlaunchedRows(env, options, selected, config = {}) {
  const videos = await loadTikTokSparkVideos(env, options, selected, {
    activeOnlyDefault: config.activeOnlyDefault ?? true,
    defaultLimit: config.defaultLimit ?? 100,
  });
  const launched = await fetchLaunchedSparkItemMap(env, selected.account, options);
  const rowsWithLaunchState = videos.rows.map((row) => {
    const itemId = sparkApiVideoItemId(row);
    const matches = itemId ? launched.itemMap.get(itemId) ?? [] : [];

    return {
      row,
      launched: matches.length > 0,
      launchedMatches: matches,
    };
  });
  const unlaunchedRows = rowsWithLaunchState.filter((row) => !row.launched);

  return {
    videos,
    launched,
    rowsWithLaunchState,
    unlaunchedRows,
  };
}

async function handleTikTokSparkUnlaunched(env, options) {
  const selected = await selectedTikTokAccount(env, options);
  const result = await getTikTokSparkUnlaunchedRows(env, options, selected, {
    activeOnlyDefault: true,
  });

  printJson({
    organization: organizationSummary(selected.organization),
    advertiser: advertiserSummary(selected.account),
    warnings: [...selected.warnings, ...result.launched.warnings],
    source: "tiktok_api",
    activeOnly: result.videos.activeOnly,
    fetchedVideoCount: result.videos.fetchedCount,
    eligibleVideoCount: result.videos.filteredCount,
    checkedVideoCount: result.rowsWithLaunchState.length,
    launchedVideoCount: result.rowsWithLaunchState.length - result.unlaunchedRows.length,
    unlaunchedVideoCount: result.unlaunchedRows.length,
    adRowsChecked: result.launched.adRowCount,
    smartPlusRowsChecked: result.launched.smartPlusRowCount,
    truncated: result.videos.truncated,
    rows: result.unlaunchedRows.map((entry) => ({
      ...publicTikTokSparkVideo(entry.row),
      launched: false,
      launchedMatches: entry.launchedMatches,
    })),
  });
}

function publicTikTokIdentity(row) {
  return compactObject({
    identityType: pickString(row, ["identity_type"]),
    identityId: pickString(row, ["identity_id"]),
    identityAuthorizedBcId: pickString(row, ["identity_authorized_bc_id"]),
    displayName: pickString(row, ["display_name"]),
    username: pickString(row, ["username"]),
    availableStatus: pickString(row, ["available_status"]),
    adsOnlyMode: row.ads_only_mode,
    canPullVideo: row.can_pull_video,
    canPushVideo: row.can_push_video,
    canManageMessage: row.can_manage_message,
    canUseLiveAds: row.can_use_live_ads,
    isGpppa: row.is_gpppa,
    profileImage: row.profile_image ?? row.profile_image_url,
  });
}

function identityMatches(row, options) {
  const identityId = stringOption(options, "identity_id");
  const query = stringOption(options, "query") ?? stringOption(options, "creator");

  if (identityId && pickString(row, ["identity_id"]) !== identityId) {
    return false;
  }

  if (!query) {
    return true;
  }

  const normalizedQuery = normalizeSearchText(query);
  const values = [
    row.identity_id,
    row.identity_type,
    row.identity_authorized_bc_id,
    row.display_name,
    row.username,
  ];

  return values.some((value) => {
    const normalizedValue = normalizeSearchText(value);
    return normalizedValue === normalizedQuery || normalizedValue.includes(normalizedQuery);
  });
}

async function loadTikTokIdentities(env, options, selected) {
  const limit = positiveIntegerOption(options, "limit", 100, 5000);
  const fetchLimit = Math.min(
    positiveIntegerOption(options, "identity_fetch_limit", Math.max(limit, 100), 5000),
    5000,
  );
  const identityType = stringOption(options, "identity_type");
  const identityAuthorizedBcId = stringOption(options, "identity_authorized_bc_id");
  const result = await fetchTikTokRows(
    env,
    selected.account,
    "/open_api/v1.3/identity/get/",
    compactObject({
      advertiser_id: selected.account.advertiserId,
      identity_type: identityType,
      identity_authorized_bc_id: identityAuthorizedBcId,
    }),
    {
      ...options,
      fetch_limit: fetchLimit,
    },
    fetchLimit,
  );
  const filtered = result.rows.filter((row) => identityMatches(row, options));

  return {
    rows: filtered.slice(0, limit),
    fetchedCount: result.rowCount,
    filteredCount: filtered.length,
    truncated: result.truncated || filtered.length > limit || result.rowCount >= fetchLimit,
    requestId: result.requestId,
  };
}

async function handleTikTokIdentities(env, options) {
  const selected = await selectedTikTokAccount(env, options);
  const result = await loadTikTokIdentities(env, options, selected);

  printJson({
    organization: organizationSummary(selected.organization),
    advertiser: advertiserSummary(selected.account),
    warnings: selected.warnings,
    fetchedCount: result.fetchedCount,
    filteredCount: result.filteredCount,
    returnedCount: result.rows.length,
    truncated: result.truncated,
    rows: result.rows.map(publicTikTokIdentity),
  });
}

function identityQueryFromOptions(options, advertiserId) {
  return compactObject({
    advertiser_id: advertiserId,
    identity_id: requiredString(options, "identity_id"),
    identity_type: stringOption(options, "identity_type") ?? "BC_AUTH_TT",
    identity_authorized_bc_id: stringOption(options, "identity_authorized_bc_id"),
  });
}

function identityQueryFromIdentity(identity, advertiserId) {
  return compactObject({
    advertiser_id: advertiserId,
    identity_id: requiredString(identity, "identity_id"),
    identity_type: pickString(identity, ["identity_type"]) ?? "BC_AUTH_TT",
    identity_authorized_bc_id: pickString(identity, ["identity_authorized_bc_id"]),
  });
}

async function handleTikTokIdentityInfo(env, options) {
  const selected = await selectedTikTokAccount(env, options);
  const response = await requestTikTok(env, {
    accessToken: selected.account.accessToken,
    method: "GET",
    path: "/open_api/v1.3/identity/info/",
    query: identityQueryFromOptions(options, selected.account.advertiserId),
  });

  printJson({
    organization: organizationSummary(selected.organization),
    advertiser: advertiserSummary(selected.account),
    warnings: selected.warnings,
    ...response,
  });
}

function identityVideoMatches(row, options) {
  const itemId = stringOption(options, "item_id") ?? stringOption(options, "tiktok_item_id");
  const query = stringOption(options, "query");

  if (itemId && pickString(row, ["item_id"]) !== itemId) {
    return false;
  }

  if (!query) {
    return true;
  }

  const normalizedQuery = normalizeSearchText(query);
  const normalizedText = normalizeSearchText(pickString(row, ["text"]));
  return normalizedText.includes(normalizedQuery);
}

function publicTikTokIdentityVideo(row, identity) {
  return compactObject({
    source: "identity_api",
    itemId: pickString(row, ["item_id"]),
    itemType: pickString(row, ["item_type"]),
    itemStatus: pickString(row, ["status"]),
    text: displayString(pickString(row, ["text"]), 220),
    preview: pickString(row, ["item_id"]) ? tiktokItemPreviewLinks(pickString(row, ["item_id"])) : null,
    identity: identity ? publicTikTokIdentity(identity) : null,
    identityType: identity ? pickString(identity, ["identity_type"]) ?? "BC_AUTH_TT" : null,
    identityId: identity ? pickString(identity, ["identity_id"]) : null,
    identityAuthorizedBcId: identity ? pickString(identity, ["identity_authorized_bc_id"]) : null,
    tiktokName: identity ? pickString(identity, ["display_name", "username"]) : null,
    videoInfo: row.video_info,
    carouselInfo: row.carousel_info,
    authInfo: row.auth_info,
  });
}

function sparkAuthorizationFromTikTokIdentityVideo(row, account, identity) {
  const itemId = pickString(row, ["item_id"]);
  const identityId = pickString(identity, ["identity_id"]);
  const identityType = pickString(identity, ["identity_type"]) ?? "BC_AUTH_TT";

  if (!itemId || !identityId) {
    throw new CliError("Identity API video is missing item_id or identity_id.", {
      itemId,
      identityId,
    });
  }

  return {
    id: `identity_video:${identityId}:${itemId}`,
    source: "identity_api",
    status: "AUTHORIZED",
    advertiserId: account.advertiserId,
    creator: {
      displayName: pickString(identity, ["display_name", "username"]),
      accounts: [],
    },
    video: {
      sourceVideoId: itemId,
      titleOrCaption: pickString(row, ["text"]),
    },
    tiktokItemId: itemId,
    preview: tiktokItemPreviewLinks(itemId),
    identityType,
    identityId,
    identityAuthorizedBcId: pickString(identity, ["identity_authorized_bc_id"]),
  };
}

async function loadTikTokIdentityVideos(env, options, selected, identity, config = {}) {
  const limit = positiveIntegerOption(options, "limit", 100, 5000);
  const fetchLimit = Math.min(
    positiveIntegerOption(options, "video_fetch_limit", Math.max(limit, 100), 5000),
    5000,
  );
  const result = await fetchTikTokRows(
    env,
    selected.account,
    "/open_api/v1.3/identity/video/get/",
    identity
      ? identityQueryFromIdentity(identity, selected.account.advertiserId)
      : identityQueryFromOptions(options, selected.account.advertiserId),
    {
      ...options,
      fetch_limit: fetchLimit,
    },
    fetchLimit,
  );
  const filtered = result.rows.filter((row) => identityVideoMatches(row, options));

  return {
    rows: filtered.slice(0, limit),
    fetchedCount: result.rowCount,
    filteredCount: filtered.length,
    returnedCount: Math.min(filtered.length, limit),
    truncated: result.truncated || filtered.length > limit || result.rowCount >= fetchLimit,
    requestId: result.requestId,
    identity,
    limit,
  };
}

async function handleTikTokIdentityVideos(env, options) {
  const selected = await selectedTikTokAccount(env, options);
  const result = await loadTikTokIdentityVideos(env, options, selected);

  printJson({
    organization: organizationSummary(selected.organization),
    advertiser: advertiserSummary(selected.account),
    warnings: selected.warnings,
    fetchedCount: result.fetchedCount,
    filteredCount: result.filteredCount,
    returnedCount: result.returnedCount,
    truncated: result.truncated,
    rows: result.rows.map((row) => publicTikTokIdentityVideo(row, result.identity)),
  });
}

async function identityRowsForVideoDiff(env, options, selected) {
  const identityId = stringOption(options, "identity_id");

  if (identityId) {
    return [
      compactObject({
        identity_id: identityId,
        identity_type: stringOption(options, "identity_type") ?? "BC_AUTH_TT",
        identity_authorized_bc_id: stringOption(options, "identity_authorized_bc_id"),
        display_name: stringOption(options, "creator") ?? stringOption(options, "query"),
      }),
    ];
  }

  const creator = stringOption(options, "creator") ?? stringOption(options, "query");

  if (!creator) {
    throw new CliError("Provide --identity-id or --creator for identity video diff.");
  }

  const result = await loadTikTokIdentities(
    env,
    {
      ...options,
      identity_type: stringOption(options, "identity_type") ?? "BC_AUTH_TT",
      query: creator,
      limit: option(options, "identity_limit", 20),
    },
    selected,
  );
  const pullable = result.rows.filter((row) => row.can_pull_video !== false);

  if (pullable.length === 0) {
    throw new CliError("No pullable TikTok identities matched this creator.", {
      creator,
      fetchedCount: result.fetchedCount,
      filteredCount: result.filteredCount,
    });
  }

  return pullable;
}

async function getTikTokIdentityUnlaunchedRows(env, options, selected) {
  const identities = await identityRowsForVideoDiff(env, options, selected);
  const launched = await fetchLaunchedSparkItemMap(env, selected.account, options);
  const rowsWithLaunchState = [];
  let fetchedVideoCount = 0;
  let eligibleVideoCount = 0;
  let truncated = false;

  for (const identity of identities) {
    const result = await loadTikTokIdentityVideos(env, options, selected, identity, {
      defaultLimit: 100,
    });
    fetchedVideoCount += result.fetchedCount;
    eligibleVideoCount += result.filteredCount;
    truncated = truncated || result.truncated;

    for (const row of result.rows) {
      const itemId = pickString(row, ["item_id"]);
      const matches = itemId ? launched.itemMap.get(itemId) ?? [] : [];

      rowsWithLaunchState.push({
        row,
        identity,
        launched: matches.length > 0,
        launchedMatches: matches,
      });
    }
  }

  const unlaunchedRows = rowsWithLaunchState.filter((entry) => !entry.launched);

  return {
    identities,
    launched,
    rowsWithLaunchState,
    unlaunchedRows,
    fetchedVideoCount,
    eligibleVideoCount,
    truncated,
  };
}

async function handleTikTokIdentityUnlaunched(env, options) {
  const selected = await selectedTikTokAccount(env, options);
  const result = await getTikTokIdentityUnlaunchedRows(env, options, selected);

  printJson({
    organization: organizationSummary(selected.organization),
    advertiser: advertiserSummary(selected.account),
    warnings: [...selected.warnings, ...result.launched.warnings],
    source: "identity_api",
    identitiesChecked: result.identities.map(publicTikTokIdentity),
    fetchedVideoCount: result.fetchedVideoCount,
    eligibleVideoCount: result.eligibleVideoCount,
    checkedVideoCount: result.rowsWithLaunchState.length,
    launchedVideoCount: result.rowsWithLaunchState.length - result.unlaunchedRows.length,
    unlaunchedVideoCount: result.unlaunchedRows.length,
    adRowsChecked: result.launched.adRowCount,
    smartPlusRowsChecked: result.launched.smartPlusRowCount,
    truncated: result.truncated,
    rows: result.unlaunchedRows.map((entry) => ({
      ...publicTikTokIdentityVideo(entry.row, entry.identity),
      launched: false,
      launchedMatches: entry.launchedMatches,
    })),
  });
}

async function handleTikTokIdentityVideoInfo(env, options) {
  const selected = await selectedTikTokAccount(env, options);
  const query = {
    ...identityQueryFromOptions(options, selected.account.advertiserId),
    item_id: requiredString(options, "item_id", stringOption(options, "tiktok_item_id")),
  };
  const response = await requestTikTok(env, {
    accessToken: selected.account.accessToken,
    method: "GET",
    path: "/open_api/v1.3/identity/video/info/",
    query,
  });

  printJson({
    organization: organizationSummary(selected.organization),
    advertiser: advertiserSummary(selected.account),
    warnings: selected.warnings,
    ...response,
  });
}

async function loadSparkAuthorizations(env, options, selected, config = {}) {
  if (!selected.organization?.id) {
    throw new CliError("Spark authorization commands require --org so local authorizations can be read.");
  }

  const activeOnly = config.activeOnlyDefault
    ? !boolOption(options, "include_inactive")
    : boolOption(options, "active_only");
  const limit = positiveIntegerOption(options, "limit", config.defaultLimit ?? 100, 5000);
  const fetchLimit = Math.min(
    positiveIntegerOption(options, "auth_fetch_limit", Math.max(limit, 500), 5000),
    5000,
  );
  const authorizationId = stringOption(options, "authorization_id");
  const videoId = stringOption(options, "video_id");
  const tiktokItemId = stringOption(options, "tiktok_item_id");
  const status = stringOption(options, "status");
  const query = {
    select:
      "id,organizationId,creatorId,videoId,sparkCodeRequestId,advertiserId,authCodeHash,identityType,identityId,identityAuthorizedBcId,tiktokItemId,authStartTime,authEndTime,status,lastError,createdAt,updatedAt",
    organizationId: `eq.${selected.organization.id}`,
    advertiserId: `eq.${selected.account.advertiserId}`,
    order: "updatedAt.desc",
    limit: String(fetchLimit),
  };

  if (authorizationId) {
    query.id = `eq.${authorizationId}`;
  }

  if (videoId) {
    query.videoId = `eq.${videoId}`;
  }

  if (tiktokItemId) {
    query.tiktokItemId = `eq.${tiktokItemId}`;
  }

  if (status) {
    query.status = `eq.${status.toUpperCase()}`;
  } else if (activeOnly) {
    query.status = "eq.AUTHORIZED";
    query.tiktokItemId = query.tiktokItemId ?? "not.is.null";
  }

  const authorizations = await supabaseSelect(env, "SparkAuthorization", query);
  const enriched = await enrichSparkAuthorizations(env, authorizations);
  const creatorFilter = option(options, "creator");
  const filtered = enriched
    .filter((row) => !activeOnly || isSparkAuthorizationActive(row))
    .filter((row) => sparkAuthorizationMatchesCreator(row, creatorFilter));

  return {
    activeOnly,
    rows: filtered.slice(0, limit),
    fetchedCount: authorizations.length,
    filteredCount: filtered.length,
    truncated: filtered.length > limit || authorizations.length >= fetchLimit,
  };
}

function adItemMatchSummary(row, source) {
  return compactObject({
    source,
    adId: pickString(row, ["ad_id", "id"]),
    smartPlusAdId: smartPlusAdIdFromAd(row) ?? smartPlusAdIdFromSmartPlusAd(row),
    adName: displayString(pickString(row, ["ad_name", "name"])),
    campaignId: pickString(row, ["campaign_id", "smart_plus_campaign_id"]),
    adgroupId: pickString(row, ["adgroup_id", "smart_plus_adgroup_id"]),
    operationStatus: pickString(row, ["operation_status", "status"]),
    secondaryStatus: pickString(row, ["secondary_status"]),
  });
}

function addAdItemMatches(itemMap, itemIds, match) {
  for (const itemId of itemIds) {
    const current = itemMap.get(itemId) ?? [];
    const key = `${match.source}:${match.adId ?? ""}:${match.smartPlusAdId ?? ""}:${match.adgroupId ?? ""}`;

    if (!current.some((entry) => `${entry.source}:${entry.adId ?? ""}:${entry.smartPlusAdId ?? ""}:${entry.adgroupId ?? ""}` === key)) {
      current.push(match);
      itemMap.set(itemId, current);
    }
  }
}

async function fetchLaunchedSparkItemMap(env, account, options) {
  const warnings = [];
  const itemMap = new Map();
  const ads = await fetchAdsForContext(env, account, {
    ...options,
    fetch_limit: option(options, "ad_fetch_limit", option(options, "fetch_limit", 1000)),
  });

  for (const ad of ads) {
    addAdItemMatches(itemMap, tiktokItemIdsFromAd(ad, null), adItemMatchSummary(ad, "ad"));
  }

  let smartPlusRowCount = 0;

  try {
    const smartPlusResult = await fetchSmartPlusAdsForContext(env, account, {
      ...options,
      fetch_limit: option(options, "smart_plus_fetch_limit", option(options, "fetch_limit", 1000)),
    });
    smartPlusRowCount = smartPlusResult.rowCount;

    for (const smartPlusAd of smartPlusResult.rows) {
      addAdItemMatches(
        itemMap,
        tiktokItemIdsFromSmartPlusAd(smartPlusAd),
        adItemMatchSummary(smartPlusAd, "smart_plus"),
      );
    }
  } catch (error) {
    warnings.push(
      `Smart+ ad listing failed, so Spark launch diff only used regular ads: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    itemMap,
    warnings,
    adRowCount: ads.length,
    smartPlusRowCount,
  };
}

async function handleSparkAuthorizations(env, options) {
  const selected = await selectedTikTokAccount(env, options);
  const result = await loadSparkAuthorizations(env, options, selected, {
    activeOnlyDefault: false,
  });

  printJson({
    organization: organizationSummary(selected.organization),
    advertiser: advertiserSummary(selected.account),
    warnings: selected.warnings,
    activeOnly: result.activeOnly,
    fetchedCount: result.fetchedCount,
    filteredCount: result.filteredCount,
    returnedCount: result.rows.length,
    truncated: result.truncated,
    rows: result.rows.map(publicSparkAuthorization),
  });
}

async function getSparkUnlaunchedRows(env, options, selected, config = {}) {
  const authorizations = await loadSparkAuthorizations(env, options, selected, {
    activeOnlyDefault: config.activeOnlyDefault ?? true,
    defaultLimit: config.defaultLimit ?? 100,
  });
  const launched = await fetchLaunchedSparkItemMap(env, selected.account, options);
  const rowsWithLaunchState = authorizations.rows.map((row) => {
    const matches = row.tiktokItemId ? launched.itemMap.get(row.tiktokItemId) ?? [] : [];

    return {
      ...row,
      launched: matches.length > 0,
      launchedMatches: matches,
    };
  });
  const unlaunchedRows = rowsWithLaunchState.filter((row) => !row.launched);

  return {
    authorizations,
    launched,
    rowsWithLaunchState,
    unlaunchedRows,
  };
}

async function handleSparkUnlaunched(env, options) {
  const selected = await selectedTikTokAccount(env, options);
  const result = await getSparkUnlaunchedRows(env, options, selected, {
    activeOnlyDefault: true,
  });

  printJson({
    organization: organizationSummary(selected.organization),
    advertiser: advertiserSummary(selected.account),
    warnings: [...selected.warnings, ...result.launched.warnings],
    activeOnly: result.authorizations.activeOnly,
    fetchedAuthorizationCount: result.authorizations.fetchedCount,
    eligibleAuthorizationCount: result.authorizations.filteredCount,
    checkedAuthorizationCount: result.rowsWithLaunchState.length,
    launchedAuthorizationCount: result.rowsWithLaunchState.length - result.unlaunchedRows.length,
    unlaunchedAuthorizationCount: result.unlaunchedRows.length,
    adRowsChecked: result.launched.adRowCount,
    smartPlusRowsChecked: result.launched.smartPlusRowCount,
    truncated: result.authorizations.truncated,
    rows: result.unlaunchedRows.map((row) => ({
      ...publicSparkAuthorization(row),
      launched: false,
      launchedMatches: row.launchedMatches,
    })),
  });
}

function nestedRecordCandidates(record, fieldNames) {
  const candidates = [];

  for (const fieldName of fieldNames) {
    const value = record?.[fieldName];

    if (Array.isArray(value)) {
      for (const entry of value) {
        if (isRecord(entry)) {
          candidates.push(entry);
        }
      }
      continue;
    }

    if (isRecord(value)) {
      candidates.push(value);
    }
  }

  return candidates;
}

function pickFirstDefined(candidates, fieldNames) {
  for (const candidate of candidates) {
    for (const fieldName of fieldNames) {
      const value = candidate?.[fieldName];

      if (value !== undefined && value !== null && value !== "") {
        return cloneJson(value);
      }
    }
  }

  return undefined;
}

function duplicateSparkSourceAdId(duplicateMatches, templateAdId) {
  for (const match of duplicateMatches) {
    const adId = nonEmptyString(match?.adId);

    if (match?.source === "ad" && adId && adId !== templateAdId) {
      return adId;
    }
  }

  return null;
}

async function maybeUseDuplicateSparkSourceTemplate(
  env,
  account,
  authorization,
  requestedTemplate,
  templateAdId,
  duplicateMatches,
  options,
) {
  const tiktokItemId = nonEmptyString(authorization.tiktokItemId);

  if (
    !boolOption(options, "allow_duplicate") ||
    boolOption(options, "preserve_template") ||
    !tiktokItemId ||
    tiktokItemIdsFromAd(requestedTemplate.row, null).includes(tiktokItemId)
  ) {
    return requestedTemplate;
  }

  const sourceAdId = duplicateSparkSourceAdId(duplicateMatches, templateAdId);

  if (!sourceAdId) {
    return requestedTemplate;
  }

  const sourceTemplate = await fetchTemplateAdForSparkLaunch(env, account, sourceAdId, options);

  if (!sourceTemplate.row) {
    return {
      row: requestedTemplate.row,
      warnings: [
        ...sourceTemplate.warnings,
        `Could not read existing Spark source ad ${sourceAdId}; using requested template ad ${templateAdId}.`,
      ],
    };
  }

  return {
    row: sourceTemplate.row,
    warnings: [
      ...sourceTemplate.warnings,
      `Using existing Spark source ad ${sourceAdId} as template because requested template ad ${templateAdId} does not contain TikTok item ${tiktokItemId}. Pass --preserve-template to keep the requested template creative.`,
    ],
  };
}

async function fetchTemplateAdForSparkLaunch(env, account, adId, options) {
  const warnings = [];

  try {
    const result = await fetchTikTokRows(
      env,
      account,
      "/open_api/v1.3/ad/get/",
      {
        advertiser_id: account.advertiserId,
        fields: SPARK_TEMPLATE_AD_FIELDS,
        filtering: {
          ad_ids: [adId],
        },
      },
      { ...options, fetch_limit: 10, page_size: 10, pages: 1 },
      10,
    );
    const row = result.rows.find((entry) => pickString(entry, ["ad_id", "id"]) === adId) ?? null;

    if (row) {
      return { row, warnings };
    }
  } catch (error) {
    warnings.push(
      `Extended template ad lookup failed; using basic ad fields instead: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const row = await fetchRegularAdById(env, account, adId, options);
  return { row, warnings };
}

function sparkFieldsFromAuthorization(authorization) {
  const identityType = nonEmptyString(authorization.identityType);
  const identityId = nonEmptyString(authorization.identityId);
  const tiktokItemId = nonEmptyString(authorization.tiktokItemId);

  if (!identityType || !identityId || !tiktokItemId) {
    throw new CliError("Spark authorization is missing identity_type, identity_id, or tiktok_item_id.", {
      authorizationId: authorization.id,
      identityType,
      hasIdentityId: Boolean(identityId),
      tiktokItemId,
    });
  }

  return compactObject({
    identity_type: identityType,
    identity_id: identityId,
    tiktok_item_id: tiktokItemId,
    ...(authorization.identityAuthorizedBcId
      ? {
          identity_authorized_bc_id: authorization.identityAuthorizedBcId,
        }
      : {}),
  });
}

function sparkFieldPlacement(options) {
  const placement = String(option(options, "spark_fields", "creative")).toLowerCase();

  if (!["creative", "top-level", "both"].includes(placement)) {
    throw new CliError("--spark-fields must be creative, top-level, or both.");
  }

  return placement;
}

function sparkLaunchName(templateAd, authorization, options) {
  const explicit = stringOption(options, "name") ?? stringOption(options, "ad_name");

  if (explicit) {
    return explicit;
  }

  const templateName = pickString(templateAd, ["ad_name", "name"]) ?? "Spark ad";
  const creatorName = authorization.creator?.displayName;
  const suffix = creatorName ? creatorName : authorization.tiktokItemId;
  const name = `${templateName} / ${suffix}`;

  return name.length > 240 ? name.slice(0, 240) : name;
}

function sparkLaunchRequestFromTemplate(account, authorization, templateAd, destinationAdgroupId, options) {
  const bodyOverride = requireJsonObject(parseJsonOption(options, "body", {}), "--body");
  const creativeOverride = requireJsonObject(parseJsonOption(options, "creative", {}), "--creative");
  const overrideCreatives = arrayFrom(bodyOverride.creatives).filter(isRecord);
  const bodyWithoutCreatives = { ...bodyOverride };
  delete bodyWithoutCreatives.creatives;
  const adName =
    stringOption(options, "name") ??
    stringOption(options, "ad_name") ??
    nonEmptyString(bodyOverride.ad_name) ??
    sparkLaunchName(templateAd, authorization, options);

  const candidates = [
    templateAd,
    ...nestedRecordCandidates(templateAd, [
      "creatives",
      "creative_infos",
      "creative_info",
      "creative_list",
      "materials",
    ]),
  ];
  const copiedCreative = compactObject({
    ad_name: adName,
    ad_text: pickFirstDefined(candidates, ["ad_text", "text"]),
    call_to_action: pickFirstDefined(candidates, ["call_to_action", "callToAction"]),
    landing_page_url: pickFirstDefined(candidates, ["landing_page_url", "landingPageUrl"]),
    deeplink: pickFirstDefined(candidates, ["deeplink"]),
    deeplink_type: pickFirstDefined(candidates, ["deeplink_type", "deeplinkType"]),
    app_name: pickFirstDefined(candidates, ["app_name", "appName"]),
    display_name: pickFirstDefined(candidates, ["display_name", "displayName"]),
    profile_image_url: pickFirstDefined(candidates, [
      "profile_image_url",
      "profileImageUrl",
      "profile_image",
      "profileImage",
    ]),
    avatar_icon_web_uri: pickFirstDefined(candidates, [
      "avatar_icon_web_uri",
      "avatarIconWebUri",
    ]),
    tracking_url: pickFirstDefined(candidates, ["tracking_url", "trackingUrl"]),
    impression_tracking_url: pickFirstDefined(candidates, [
      "impression_tracking_url",
      "impressionTrackingUrl",
    ]),
    click_tracking_url: pickFirstDefined(candidates, ["click_tracking_url", "clickTrackingUrl"]),
    monitor_url: pickFirstDefined(candidates, ["monitor_url", "monitorUrl"]),
  });
  const sparkFields = sparkFieldsFromAuthorization(authorization);
  const placement = sparkFieldPlacement(options);
  const firstOverrideCreative = overrideCreatives[0] ?? {};
  const creative = compactObject({
    ...copiedCreative,
    ...firstOverrideCreative,
    ...creativeOverride,
    ...(placement === "creative" || placement === "both" ? sparkFields : {}),
  });
  const body = compactObject({
    advertiser_id: account.advertiserId,
    adgroup_id: destinationAdgroupId,
    ad_name: adName,
    ad_format: pickFirstDefined(candidates, ["ad_format", "adFormat"]),
    ...(placement === "top-level" || placement === "both" ? sparkFields : {}),
    ...bodyWithoutCreatives,
    creatives: [creative, ...overrideCreatives.slice(1)],
  });

  return {
    method: "POST",
    path: "/open_api/v1.3/ad/create/",
    body,
  };
}

async function buildSparkLaunchPlan(env, options, selected, authorization) {
  const destinationAdgroupId = requiredString(options, "dest_adgroup_id");
  const templateAdId = requiredString(options, "template_ad_id");
  const warnings = [];

  if (!boolOption(options, "allow_inactive") && !isSparkAuthorizationActive(authorization)) {
    throw new CliError("Spark authorization is not active. Pass --allow-inactive only if this is intentional.", {
      authorization: publicSparkAuthorization(authorization),
    });
  }

  const duplicateMap = await fetchLaunchedSparkItemMap(env, selected.account, options);
  warnings.push(...duplicateMap.warnings);
  const duplicateMatches = authorization.tiktokItemId
    ? duplicateMap.itemMap.get(authorization.tiktokItemId) ?? []
    : [];

  if (duplicateMatches.length > 0 && !boolOption(options, "allow_duplicate")) {
    throw new CliError("This Spark item is already used by an existing TikTok ad. Refusing duplicate launch.", {
      authorization: publicSparkAuthorization(authorization),
      existingAds: duplicateMatches,
      override: "Pass --allow-duplicate only after confirming another ad for this same TikTok item is intended.",
    });
  }

  const template = await fetchTemplateAdForSparkLaunch(
    env,
    selected.account,
    templateAdId,
    options,
  );
  warnings.push(...template.warnings);

  if (!template.row) {
    throw new CliError(`No template ad found for ad_id ${templateAdId}.`);
  }

  const launchTemplate = await maybeUseDuplicateSparkSourceTemplate(
    env,
    selected.account,
    authorization,
    template,
    templateAdId,
    duplicateMatches,
    options,
  );
  warnings.push(...launchTemplate.warnings);

  const request = sparkLaunchRequestFromTemplate(
    selected.account,
    authorization,
    launchTemplate.row,
    destinationAdgroupId,
    options,
  );

  return {
    warnings,
    destinationAdgroupId,
    templateAd: adItemMatchSummary(launchTemplate.row, "template_ad"),
    requestedTemplateAd: adItemMatchSummary(template.row, "requested_template_ad"),
    duplicateMatches,
    request: {
      accessToken: selected.account.accessToken,
      ...request,
    },
  };
}

async function selectedSparkAuthorizationForLaunch(env, options, selected) {
  const authorizationId = stringOption(options, "authorization_id");
  const tiktokItemId = stringOption(options, "tiktok_item_id");
  const source = lower(stringOption(options, "source") ?? "auto");

  if (!authorizationId && !tiktokItemId) {
    throw new CliError("Provide --authorization-id or --tiktok-item-id.");
  }

  if (!["auto", "local", "tiktok-api", "api", "identity-api", "identity"].includes(source)) {
    throw new CliError("--source must be auto, local, tiktok-api, or identity-api.");
  }

  if (authorizationId && ["tiktok-api", "api", "identity-api", "identity"].includes(source)) {
    throw new CliError("--authorization-id can only be used with --source local or --source auto.");
  }

  if (!["tiktok-api", "api", "identity-api", "identity"].includes(source)) {
    const result = await loadSparkAuthorizations(env, options, selected, {
      activeOnlyDefault: false,
      defaultLimit: 10,
    });

    if (result.rows.length > 1) {
      throw new CliError("Multiple local Spark authorizations matched. Use --authorization-id.", {
        matches: result.rows.map(publicSparkAuthorization),
      });
    }

    if (result.rows.length === 1) {
      return {
        ...result.rows[0],
        source: result.rows[0].source ?? "local_db",
      };
    }

    if (source === "local" || authorizationId) {
      throw new CliError("No matching local Spark authorization was found.", {
        hint: "Use --source tiktok-api with --tiktok-item-id to use TikTok's live authorized Spark posts.",
      });
    }
  }

  if (!tiktokItemId) {
    throw new CliError("TikTok API Spark lookup requires --tiktok-item-id.");
  }

  if (source === "identity-api" || source === "identity") {
    const identities = await identityRowsForVideoDiff(env, options, selected);
    const matches = [];

    for (const identity of identities) {
      const result = await loadTikTokIdentityVideos(
        env,
        {
          ...options,
          tiktok_item_id: tiktokItemId,
          limit: 10,
        },
        selected,
        identity,
      );

      for (const row of result.rows) {
        matches.push({ row, identity });
      }
    }

    if (matches.length === 0) {
      throw new CliError("No matching TikTok identity video was found.", {
        tiktokItemId,
        hint: "Run identity-videos-unlaunched --org <slug> --creator <name> or identity-videos with the identity IDs.",
      });
    }

    if (matches.length > 1) {
      throw new CliError("Multiple TikTok identity videos matched. Use --identity-id.", {
        matches: matches.map((entry) => publicTikTokIdentityVideo(entry.row, entry.identity)),
      });
    }

    return sparkAuthorizationFromTikTokIdentityVideo(
      matches[0].row,
      selected.account,
      matches[0].identity,
    );
  }

  const apiResult = await loadTikTokSparkVideos(env, options, selected, {
    activeOnlyDefault: false,
    defaultLimit: 10,
  });

  if (apiResult.rows.length === 0) {
    throw new CliError("No matching TikTok API Spark video authorization was found.", {
      tiktokItemId,
      hint: "Run spark-videos --org <slug> --creator <name> or --tiktok-item-id <id> to inspect live Spark posts.",
    });
  }

  if (apiResult.rows.length > 1) {
    throw new CliError("Multiple TikTok API Spark videos matched. Use --tiktok-item-id.", {
      matches: apiResult.rows.map((row) => publicTikTokSparkVideo(row)),
    });
  }

  return sparkAuthorizationFromTikTokSparkVideo(apiResult.rows[0], selected.account);
}

function publicSparkLaunchRequest(request) {
  return {
    method: request.method,
    path: request.path,
    body: request.body,
  };
}

async function handleSparkLaunch(env, options, mode) {
  const selected = await selectedTikTokAccount(env, options);
  const authorization = await selectedSparkAuthorizationForLaunch(env, options, selected);
  const plan = await buildSparkLaunchPlan(env, options, selected, authorization);
  const dryRun = mode === "plan" || !boolOption(options, "execute");

  if (dryRun) {
    printJson({
      dryRun: true,
      executeHint:
        mode === "plan"
          ? "Review this payload, then rerun spark-launch with the same IDs and --execute."
          : "Add --execute to run this mutation after reviewing the payload.",
      organization: organizationSummary(selected.organization),
      advertiser: advertiserSummary(selected.account),
      warnings: [...selected.warnings, ...plan.warnings],
      authorization: publicSparkAuthorization(authorization),
      templateAd: plan.templateAd,
      requestedTemplateAd:
        plan.requestedTemplateAd?.adId !== plan.templateAd?.adId ? plan.requestedTemplateAd : undefined,
      destination: {
        adgroupId: plan.destinationAdgroupId,
      },
      duplicateMatches: plan.duplicateMatches,
      request: publicSparkLaunchRequest(plan.request),
    });
    return;
  }

  if (env.TT_ADS_ALLOW_WRITES !== "1") {
    throw new CliError(
      "Write commands are disabled. Set TT_ADS_ALLOW_WRITES=1 in the bot credential env file to allow --execute.",
    );
  }

  const response = await requestTikTok(env, plan.request);

  printJson({
    executed: true,
    organization: organizationSummary(selected.organization),
    advertiser: advertiserSummary(selected.account),
    warnings: [...selected.warnings, ...plan.warnings],
    authorization: publicSparkAuthorization(authorization),
    templateAd: plan.templateAd,
    requestedTemplateAd:
      plan.requestedTemplateAd?.adId !== plan.templateAd?.adId ? plan.requestedTemplateAd : undefined,
    destination: {
      adgroupId: plan.destinationAdgroupId,
    },
    duplicateMatches: plan.duplicateMatches,
    request: publicSparkLaunchRequest(plan.request),
    response,
  });
}

async function handleSparkBulkLaunchPlan(env, options) {
  const selected = await selectedTikTokAccount(env, options);
  const limit = positiveIntegerOption(options, "limit", 10, 50);
  const result = await getSparkUnlaunchedRows(
    env,
    { ...options, limit, auth_fetch_limit: option(options, "auth_fetch_limit", Math.max(limit, 100)) },
    selected,
    {
      activeOnlyDefault: true,
      defaultLimit: limit,
    },
  );
  const plans = [];
  const errors = [];

  for (const authorization of result.unlaunchedRows.slice(0, limit)) {
    try {
      const plan = await buildSparkLaunchPlan(
        env,
        { ...options, allow_duplicate: false },
        selected,
        authorization,
      );
      plans.push({
        authorization: publicSparkAuthorization(authorization),
        templateAd: plan.templateAd,
        requestedTemplateAd:
          plan.requestedTemplateAd?.adId !== plan.templateAd?.adId ? plan.requestedTemplateAd : undefined,
        destination: {
          adgroupId: plan.destinationAdgroupId,
        },
        duplicateMatches: plan.duplicateMatches,
        request: publicSparkLaunchRequest(plan.request),
        warnings: plan.warnings,
      });
    } catch (error) {
      errors.push({
        authorization: publicSparkAuthorization(authorization),
        error: error instanceof Error ? error.message : String(error),
        details: error instanceof CliError ? error.details : undefined,
      });
    }
  }

  printJson({
    dryRun: true,
    bulkExecuteSupported: false,
    executeHint: "Review each payload and launch individual items with spark-launch --execute.",
    organization: organizationSummary(selected.organization),
    advertiser: advertiserSummary(selected.account),
    warnings: [...selected.warnings, ...result.launched.warnings],
    checkedAuthorizationCount: result.rowsWithLaunchState.length,
    unlaunchedAuthorizationCount: result.unlaunchedRows.length,
    plannedCount: plans.length,
    errorCount: errors.length,
    plans,
    errors,
  });
}

function smartPlusAdIdFromAd(ad) {
  return pickString(ad, [
    "smart_plus_ad_id",
    "smart_plus_id",
    "smart_plus_adgroup_ad_id",
    "smart_plus_campaign_ad_id",
  ]);
}

function smartPlusAdIdFromSmartPlusAd(smartPlusAd) {
  return pickString(smartPlusAd, ["smart_plus_ad_id", "ad_id", "id"]);
}

function directSearchMatch(fieldName, entry, query, mode) {
  const normalizedEntry = lower(entry);
  const normalizedQuery = lower(query);

  if (!normalizedEntry || !normalizedQuery) {
    return null;
  }

  if (normalizedEntry === normalizedQuery) {
    return {
      reason: `${fieldName}:exact`,
      score: 1,
    };
  }

  if (mode !== "exact" && normalizedEntry.includes(normalizedQuery)) {
    return {
      reason: `${fieldName}:contains`,
      score: 0.9,
    };
  }

  return null;
}

function fuzzySearchMatch(fieldName, entry, query, mode) {
  if (mode !== "fuzzy") {
    return null;
  }

  if (["ad_id", "smart_plus_ad_id", "tiktok_item_id"].includes(fieldName)) {
    return null;
  }

  const match = phraseMatch(entry, query);

  if (!match || match.kind !== "fuzzy") {
    return null;
  }

  const tokenHint = match.tokens
    .filter((tokenMatch) => tokenMatch.kind === "fuzzy")
    .slice(0, 2)
    .map((tokenMatch) => `${tokenMatch.queryToken}~${tokenMatch.token}`)
    .join(",");

  return {
    reason: `${fieldName}:fuzzy:${match.score.toFixed(2)}${tokenHint ? `:${tokenHint}` : ""}`,
    score: match.score,
  };
}

function searchMatches(result, query, mode) {
  const needle = lower(query);
  const fields = [
    ["ad_id", result.adId],
    ["smart_plus_ad_id", result.smartPlusAdId],
    ["tiktok_item_id", result.tiktokItemIds],
    ["ad_name", result.searchValues?.name ?? result.name],
    ["ad_text", result.searchValues?.adText ?? result.adText],
    ["campaign", [result.path.campaignId, result.path.campaignName]],
    ["adgroup", [result.path.adgroupId, result.path.adgroupName]],
  ];
  const matches = [];

  for (const [fieldName, value] of fields) {
    for (const entry of fieldValueList(value)) {
      const direct = directSearchMatch(fieldName, entry, needle, mode);

      if (direct) {
        matches.push(direct);
        continue;
      }

      const fuzzy = fuzzySearchMatch(fieldName, entry, query, mode);

      if (fuzzy) {
        matches.push(fuzzy);
      }
    }
  }

  const deduped = new Map();

  for (const match of matches) {
    const existing = deduped.get(match.reason);

    if (!existing || match.score > existing.score) {
      deduped.set(match.reason, match);
    }
  }

  return [...deduped.values()];
}

function searchScore(result) {
  return result.matchReasons.reduce((score, reason, index) => {
    const matchScore = result.matchScores?.[index] ?? 1;

    if (reason.endsWith(":exact")) {
      return score + 100 * matchScore;
    }

    if (reason.startsWith("ad_id") || reason.startsWith("smart_plus_ad_id")) {
      return score + 40 * matchScore;
    }

    if (reason.startsWith("tiktok_item_id")) {
      return score + 30 * matchScore;
    }

    if (reason.startsWith("ad_name")) {
      return score + 20 * matchScore;
    }

    if (reason.startsWith("adgroup") || reason.startsWith("campaign")) {
      return score + 10 * matchScore;
    }

    return score + 5 * matchScore;
  }, 0);
}

function buildSearchResult(ad, smartPlusAd, campaignById, adgroupById) {
  const adId = pickString(ad, ["ad_id", "id"]);
  const smartPlusAdId = smartPlusAdIdFromAd(ad) ?? smartPlusAdIdFromSmartPlusAd(smartPlusAd);
  const adgroupId =
    pickString(ad, ["adgroup_id"]) ??
    pickString(smartPlusAd, ["adgroup_id", "smart_plus_adgroup_id"]);
  const campaignId =
    pickString(ad, ["campaign_id"]) ??
    pickString(smartPlusAd, ["campaign_id", "smart_plus_campaign_id"]) ??
    adgroupById.get(adgroupId)?.campaignId ??
    null;
  const campaign = campaignById.get(campaignId) ?? {
    id: campaignId,
    name: pickString(smartPlusAd, ["campaign_name"]),
  };
  const adgroup = adgroupById.get(adgroupId) ?? {
    id: adgroupId,
    name: pickString(smartPlusAd, ["adgroup_name"]),
  };
  const name = pickString(ad, ["ad_name", "name"]) ?? pickString(smartPlusAd, ["ad_name", "name"]);
  const adText =
    pickString(ad, ["ad_text"]) ??
    firstArrayValue(smartPlusAd, ["ad_text_list"]).map((entry) => String(entry)).join(" ");
  const result = {
    name: displayString(name),
    adId,
    smartPlusAdId,
    tiktokItemIds: tiktokItemIdsFromAd(ad, smartPlusAd),
    kind: smartPlusAdId || smartPlusAd ? "smart_plus" : "regular",
    operationStatus:
      pickString(ad, ["operation_status", "status"]) ??
      pickString(smartPlusAd, ["operation_status", "status"]),
    secondaryStatus:
      pickString(ad, ["secondary_status"]) ??
      pickString(smartPlusAd, ["secondary_status"]),
    campaignAutomationType:
      pickString(ad, ["campaign_automation_type"]) ??
      pickString(smartPlusAd, ["campaign_automation_type"]),
    adText: displayString(adText),
    videoIds: videoIdsFromAd(ad, smartPlusAd),
    imageIds: imageIdsFromAd(ad, smartPlusAd),
    searchValues: {
      name,
      adText,
    },
    path: {
      campaignId: campaign.id ?? null,
      campaignName: campaign.name ?? null,
      adgroupId: adgroup.id ?? null,
      adgroupName: adgroup.name ?? null,
    },
  };

  return result;
}

function tiktokItemPreviewLinks(itemId) {
  return {
    tiktokItemId: itemId,
    playerUrl: `https://www.tiktok.com/player/v1/${itemId}`,
  };
}

function previewSummaryFromSearchResult(result) {
  return compactObject({
    note: "Creative links are best-effort, not official Ads Manager previews.",
    tiktokItemLinks: result.tiktokItemIds.map((itemId) => tiktokItemPreviewLinks(itemId)),
    videoIds: result.videoIds,
    imageIds: result.imageIds,
  });
}

function publicSearchResult(result) {
  const { searchValues, previewSource, ...publicResult } = result;

  return publicResult;
}

async function handleSearch(env, options) {
  const { organization, account, warnings } = await selectedTikTokAccount(env, options);
  const query = requiredString(options, "query");
  const matchMode = searchModeFromOptions(options);
  const outputLimit = positiveIntegerOption(options, "limit", 25, 100);
  const commandWarnings = [...warnings];
  const [campaigns, adgroups, ads] = await Promise.all([
    fetchCampaignsForContext(env, account, options),
    fetchAdgroupsForContext(env, account, options),
    fetchAdsForContext(env, account, options),
  ]);
  let smartPlusAds = [];

  try {
    const smartPlusResult = await fetchSmartPlusAdsForContext(env, account, options);
    smartPlusAds = smartPlusResult.rows;
  } catch (error) {
    commandWarnings.push(
      `Smart+ ad listing failed, so Smart+ context is limited to regular ad rows: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const adgroupById = new Map(adgroups.map((adgroup) => [adgroup.id, adgroup]));
  const smartPlusAdById = new Map(
    smartPlusAds
      .map((smartPlusAd) => [smartPlusAdIdFromSmartPlusAd(smartPlusAd), smartPlusAd])
      .filter(([id]) => Boolean(id)),
  );
  const seenSmartPlusIds = new Set();
  const results = [];

  for (const ad of ads) {
    const smartPlusAdId = smartPlusAdIdFromAd(ad);
    const smartPlusAd = smartPlusAdId ? smartPlusAdById.get(smartPlusAdId) : null;
    const result = buildSearchResult(ad, smartPlusAd, campaignById, adgroupById);

    if (smartPlusAdId) {
      seenSmartPlusIds.add(smartPlusAdId);
    }

    results.push(result);
  }

  for (const smartPlusAd of smartPlusAds) {
    const smartPlusAdId = smartPlusAdIdFromSmartPlusAd(smartPlusAd);

    if (smartPlusAdId && seenSmartPlusIds.has(smartPlusAdId)) {
      continue;
    }

    results.push(buildSearchResult({}, smartPlusAd, campaignById, adgroupById));
  }

  const campaignFilter = option(options, "campaign");
  const adgroupFilter = option(options, "adgroup");
  const matched = results
    .map((result) => {
      const matches = searchMatches(result, query, matchMode);

      return {
        ...result,
        matchReasons: matches.map((match) => match.reason),
        matchScores: matches.map((match) => Number(match.score.toFixed(3))),
        ...(boolOption(options, "preview") ? { preview: previewSummaryFromSearchResult(result) } : {}),
      };
    })
    .filter((result) => result.matchReasons.length > 0)
    .filter((result) =>
      matchesEntityFilter(
        { id: result.path.campaignId, name: result.path.campaignName },
        campaignFilter,
        matchMode,
      ),
    )
    .filter((result) =>
      matchesEntityFilter(
        { id: result.path.adgroupId, name: result.path.adgroupName },
        adgroupFilter,
        matchMode,
      ),
    )
    .sort((left, right) => searchScore(right) - searchScore(left));

  printJson({
    organization: organizationSummary(organization),
    advertiser: advertiserSummary(account),
    query,
    matchMode,
    filters: compactObject({
      campaign: campaignFilter,
      adgroup: adgroupFilter,
    }),
    warnings: commandWarnings,
    resultCount: matched.length,
    rows: matched.slice(0, outputLimit).map(publicSearchResult),
  });
}

async function fetchRegularAdById(env, account, adId, options = {}) {
  const result = await fetchTikTokRows(
    env,
    account,
    "/open_api/v1.3/ad/get/",
    {
      advertiser_id: account.advertiserId,
      fields: SEARCH_AD_FIELDS,
      filtering: {
        ad_ids: [adId],
      },
    },
    { ...options, fetch_limit: 10, page_size: 10, pages: 1 },
    10,
  );

  return result.rows.find((row) => pickString(row, ["ad_id", "id"]) === adId) ?? null;
}

async function fetchRegularAdgroupById(env, account, adgroupId, options = {}) {
  const result = await fetchTikTokRows(
    env,
    account,
    "/open_api/v1.3/adgroup/get/",
    {
      advertiser_id: account.advertiserId,
      fields: SEARCH_ADGROUP_FIELDS,
      filtering: {
        adgroup_ids: [adgroupId],
      },
    },
    { ...options, fetch_limit: 10, page_size: 10, pages: 1 },
    10,
  );

  return result.rows.find((row) => pickString(row, ["adgroup_id", "id"]) === adgroupId) ?? null;
}

async function fetchSmartPlusAdById(env, account, smartPlusAdId, options = {}) {
  const filterAttempts = [
    { smart_plus_ad_ids: [smartPlusAdId] },
    { smart_plus_ad_id: smartPlusAdId },
  ];
  const errors = [];

  for (const filtering of filterAttempts) {
    try {
      const result = await fetchSmartPlusAdsForContext(
        env,
        account,
        { ...options, fetch_limit: 10, page_size: 10, pages: 1 },
        filtering,
      );
      const row =
        result.rows.find((entry) => smartPlusAdIdFromSmartPlusAd(entry) === smartPlusAdId) ??
        null;

      if (row) {
        return { row, warnings: [] };
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const result = await fetchSmartPlusAdsForContext(env, account, {
    ...options,
    fetch_limit: 1000,
  });
  const row =
    result.rows.find((entry) => smartPlusAdIdFromSmartPlusAd(entry) === smartPlusAdId) ??
    null;

  return {
    row,
    warnings:
      errors.length > 0
        ? [`Smart+ filtered lookup failed; searched the first ${result.rowCount} Smart+ ads instead.`, ...errors]
        : [],
  };
}

async function fetchSmartPlusAdgroupById(env, account, adgroupId, options = {}) {
  const warnings = [];

  try {
    const result = await fetchTikTokRows(
      env,
      account,
      "/open_api/v1.3/smart_plus/adgroup/get/",
      {
        advertiser_id: account.advertiserId,
        filtering: {
          adgroup_ids: [adgroupId],
        },
      },
      { ...options, fetch_limit: 10, page_size: 10, pages: 1 },
      10,
    );
    const row =
      result.rows.find((entry) => pickString(entry, ["adgroup_id", "id"]) === adgroupId) ??
      null;

    if (row) {
      return { smartPlusAdgroup: row, regularAdgroup: null, warnings };
    }
  } catch (error) {
    warnings.push(
      `Smart+ destination ad group lookup failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    smartPlusAdgroup: null,
    regularAdgroup: await fetchRegularAdgroupById(env, account, adgroupId, options),
    warnings,
  };
}

async function inspectSmartPlusSource(env, account, options) {
  const adId = stringOption(options, "source_ad_id") ?? stringOption(options, "ad_id");
  let smartPlusAdId =
    stringOption(options, "source_smart_plus_ad_id") ?? stringOption(options, "smart_plus_ad_id");
  const warnings = [];
  let regularAd = null;

  if (!adId && !smartPlusAdId) {
    throw new CliError("Provide --ad-id, --source-ad-id, --smart-plus-ad-id, or --source-smart-plus-ad-id.");
  }

  if (adId) {
    regularAd = await fetchRegularAdById(env, account, adId, options);

    if (!regularAd) {
      return {
        adId,
        smartPlusAdId,
        regularAd: null,
        smartPlusAd: null,
        warnings,
        error: `No regular ad found for ad_id ${adId}.`,
      };
    }

    smartPlusAdId = smartPlusAdId ?? smartPlusAdIdFromAd(regularAd);
  }

  if (!smartPlusAdId) {
    return {
      adId,
      smartPlusAdId: null,
      regularAd,
      smartPlusAd: null,
      warnings,
      error: "The selected regular ad does not expose smart_plus_ad_id.",
    };
  }

  const smartPlusLookup = await fetchSmartPlusAdById(env, account, smartPlusAdId, options);
  warnings.push(...smartPlusLookup.warnings);

  return {
    adId,
    smartPlusAdId,
    regularAd,
    smartPlusAd: smartPlusLookup.row,
    warnings,
    error: smartPlusLookup.row ? null : `No Smart+ ad found for smart_plus_ad_id ${smartPlusAdId}.`,
  };
}

async function resolveSmartPlusSource(env, account, options) {
  const source = await inspectSmartPlusSource(env, account, options);

  if (source.error) {
    throw new CliError(source.error, {
      adId: source.adId,
      smartPlusAdId: source.smartPlusAdId,
    });
  }

  return source;
}

function smartPlusSourceSummary(source) {
  return {
    adId: source.adId ?? pickString(source.regularAd, ["ad_id", "id"]),
    smartPlusAdId: source.smartPlusAdId,
    name: displayString(
      pickString(source.regularAd, ["ad_name", "name"]) ??
        pickString(source.smartPlusAd, ["ad_name", "name"]),
    ),
    adgroupId:
      pickString(source.regularAd, ["adgroup_id"]) ??
      pickString(source.smartPlusAd, ["adgroup_id", "smart_plus_adgroup_id"]),
    campaignId:
      pickString(source.regularAd, ["campaign_id"]) ??
      pickString(source.smartPlusAd, ["campaign_id", "smart_plus_campaign_id"]),
    operationStatus:
      pickString(source.regularAd, ["operation_status", "status"]) ??
      pickString(source.smartPlusAd, ["operation_status", "status"]),
    secondaryStatus:
      pickString(source.regularAd, ["secondary_status"]) ??
      pickString(source.smartPlusAd, ["secondary_status"]),
    tiktokItemIds: tiktokItemIdsFromAd(source.regularAd, source.smartPlusAd),
  };
}

function previewCreativesFromSource(source) {
  const regularCreative = compactObject({
    source: "regular_ad",
    adFormat: pickString(source.regularAd, ["ad_format"]),
    identityId: pickString(source.regularAd, ["identity_id"]),
    identityType: pickString(source.regularAd, ["identity_type"]),
    tiktokItemIds: tiktokItemIdsFromAd(source.regularAd, null),
    videoIds: videoIdsFromAd(source.regularAd, null),
    imageIds: imageIdsFromAd(source.regularAd, null),
  });
  const smartPlusCreatives = arrayFrom(source.smartPlusAd?.creative_list).map((creative, index) => {
    const creativeInfo = isRecord(creative?.creative_info) ? creative.creative_info : creative;

    return compactObject({
      source: "smart_plus",
      index,
      adFormat: pickString(creativeInfo, ["ad_format"]),
      identityAuthorizedBcId: pickString(creativeInfo, ["identity_authorized_bc_id"]),
      identityId: pickString(creativeInfo, ["identity_id"]),
      identityType: pickString(creativeInfo, ["identity_type"]),
      tiktokItemIds: uniqueNonEmptyStrings([
        ...fieldValueList(creativeInfo?.tiktok_item_id),
        ...fieldValueList(creativeInfo?.tiktok_item_ids),
      ]),
      videoIds: videoIdsFromCreativeInfo(creativeInfo),
      imageIds: imageIdsFromCreativeInfo(creativeInfo),
    });
  });

  return [regularCreative, ...smartPlusCreatives].filter(
    (creative) =>
      creative.tiktokItemIds ||
      creative.videoIds ||
      creative.imageIds ||
      creative.adFormat ||
      creative.identityId,
  );
}

function previewPacketFromSource(source) {
  const tiktokItemIds = tiktokItemIdsFromAd(source.regularAd, source.smartPlusAd);
  const videoIds = videoIdsFromAd(source.regularAd, source.smartPlusAd);
  const imageIds = imageIdsFromAd(source.regularAd, source.smartPlusAd);

  return compactObject({
    notes: [
      "Best-effort creative preview, not official Ads Manager rendering.",
      "Smart+ share URL preview is unavailable; use QR/User ID in Ads Manager.",
    ],
    source: smartPlusSourceSummary(source),
    adText:
      displayString(pickString(source.regularAd, ["ad_text"])) ??
      arrayFrom(source.smartPlusAd?.ad_text_list).map((text) => displayString(text)),
    tiktokItemLinks: tiktokItemIds.map((itemId) => tiktokItemPreviewLinks(itemId)),
    videoIds,
    imageIds,
    creatives: previewCreativesFromSource(source),
  });
}

function creativeInfoFromSmartPlusCreative(creative) {
  if (isRecord(creative?.creative_info)) {
    return creative.creative_info;
  }

  return isRecord(creative) ? creative : null;
}

function creativeScopeFromOptions(options, source) {
  const explicitScope = stringOption(options, "creative_scope");

  if (explicitScope) {
    const normalized = explicitScope.toLowerCase();

    if (!["source-ad", "enabled-bundle", "full-bundle"].includes(normalized)) {
      throw new CliError("--creative-scope must be source-ad, enabled-bundle, or full-bundle.");
    }

    return normalized;
  }

  return tiktokItemIdsFromAd(source.regularAd, null).length > 0 ? "source-ad" : "enabled-bundle";
}

function selectedTiktokItemIdFromOptions(options, source) {
  return stringOption(options, "tiktok_item_id") ?? tiktokItemIdsFromAd(source.regularAd, null)[0] ?? null;
}

function selectCreativeListForCreate(source, options) {
  const scope = creativeScopeFromOptions(options, source);
  const selectedTiktokItemId = selectedTiktokItemIdFromOptions(options, source);
  const includeDisabledMaterials = boolOption(options, "include_disabled_materials");
  const selected = [];
  const excluded = [];

  for (const [index, creative] of arrayFrom(source.smartPlusAd?.creative_list).entries()) {
    const creativeInfo = creativeInfoFromSmartPlusCreative(creative);
    const tiktokItemIds = uniqueNonEmptyStrings([
      ...fieldValueList(creativeInfo?.tiktok_item_id),
      ...fieldValueList(creativeInfo?.tiktok_item_ids),
    ]);
    const materialStatus = pickString(creative, [
      "material_operation_status",
      "operation_status",
      "status",
    ]);
    const summary = compactObject({
      index,
      adMaterialId: pickString(creative, ["ad_material_id", "material_id"]),
      materialStatus,
      tiktokItemIds,
      adFormat: pickString(creativeInfo, ["ad_format"]),
      identityType: pickString(creativeInfo, ["identity_type"]),
    });

    if (!creativeInfo) {
      excluded.push({ ...summary, reason: "missing creative_info" });
      continue;
    }

    if (
      scope !== "full-bundle" &&
      materialStatus &&
      materialStatus !== "ENABLE" &&
      !includeDisabledMaterials
    ) {
      excluded.push({ ...summary, reason: `material status ${materialStatus}` });
      continue;
    }

    if (scope === "source-ad" && selectedTiktokItemId && !tiktokItemIds.includes(selectedTiktokItemId)) {
      excluded.push({ ...summary, reason: "not selected source ad item" });
      continue;
    }

    if (scope === "source-ad" && !selectedTiktokItemId) {
      excluded.push({ ...summary, reason: "source ad has no tiktok_item_id" });
      continue;
    }

    selected.push({
      summary,
      requestCreative: { creative_info: cloneJson(creativeInfo) },
    });
  }

  return {
    scope,
    selectedTiktokItemId,
    includeDisabledMaterials,
    creativeList: selected.map((creative) => creative.requestCreative),
    selectedCreatives: selected.map((creative) => creative.summary),
    excludedCreatives: excluded,
  };
}

function smartPlusCreatePayloadFromSource(source, destinationAdgroupId, options, advertiserId) {
  const smartPlusAd = source.smartPlusAd;
  const overrideBody = requireJsonObject(parseJsonOption(options, "body", {}), "--body");
  const creativeSelection = selectCreativeListForCreate(source, options);
  const copied = {};

  for (const fieldName of SMART_PLUS_MOVE_COPY_FIELDS) {
    if (fieldName === "creative_list") {
      continue;
    }

    if (smartPlusAd[fieldName] !== undefined && smartPlusAd[fieldName] !== null) {
      copied[fieldName] = cloneJson(smartPlusAd[fieldName]);
    }
  }

  const body = compactObject({
    advertiser_id: advertiserId,
    adgroup_id: destinationAdgroupId,
    ad_name:
      stringOption(options, "name") ??
      pickString(smartPlusAd, ["ad_name", "name"]) ??
      pickString(source.regularAd, ["ad_name", "name"]),
    ...copied,
    creative_list: creativeSelection.creativeList,
    ...overrideBody,
  });

  if (!body.ad_name) {
    throw new CliError("Could not infer Smart+ ad name. Provide --name.");
  }

  if (!Array.isArray(body.creative_list) || body.creative_list.length === 0) {
    const disabledSelectedSourceCreative =
      creativeSelection.scope === "source-ad" &&
      creativeSelection.selectedTiktokItemId &&
      creativeSelection.excludedCreatives.some(
        (creative) =>
          arrayFrom(creative.tiktokItemIds).includes(creativeSelection.selectedTiktokItemId) &&
          String(creative.reason ?? "").startsWith("material status "),
      );

    throw new CliError(
      disabledSelectedSourceCreative
        ? "Selected source Smart+ creative is not enabled, so it cannot be moved again."
        : "No Smart+ creatives were selected for create. Use --creative-scope enabled-bundle or --tiktok-item-id to choose a valid creative.",
      compactObject({
        creativeSelection,
        recommendedCommand: disabledSelectedSourceCreative
          ? "Search the destination for this TikTok item; if the destination copy exists, treat the move as already complete."
          : null,
      }),
    );
  }

  return {
    body,
    creativeSelection,
  };
}

function selectedTiktokItemIds(creativeSelection) {
  return uniqueNonEmptyStrings(
    arrayFrom(creativeSelection?.selectedCreatives).flatMap((creative) =>
      fieldValueList(creative?.tiktokItemIds),
    ),
  );
}

async function findDestinationSmartPlusCreatives(env, account, destinationAdgroupId, tiktokItemIds, options) {
  if (tiktokItemIds.length === 0) {
    return [];
  }

  const result = await fetchSmartPlusAdsForContext(
    env,
    account,
    { ...options, fetch_limit: 100, page_size: 100, pages: 1 },
    { adgroup_ids: [destinationAdgroupId] },
  );
  const selectedItems = new Set(tiktokItemIds);
  const matches = [];

  for (const smartPlusAd of result.rows) {
    const smartPlusAdId = smartPlusAdIdFromSmartPlusAd(smartPlusAd);

    for (const [index, creative] of arrayFrom(smartPlusAd?.creative_list).entries()) {
      const creativeInfo = creativeInfoFromSmartPlusCreative(creative);
      const creativeItems = uniqueNonEmptyStrings([
        ...fieldValueList(creativeInfo?.tiktok_item_id),
        ...fieldValueList(creativeInfo?.tiktok_item_ids),
      ]);
      const matchedItems = creativeItems.filter((itemId) => selectedItems.has(itemId));

      if (matchedItems.length === 0) {
        continue;
      }

      matches.push(
        compactObject({
          smartPlusAdId,
          adId: pickString(smartPlusAd, ["ad_id", "id"]),
          adName: pickString(smartPlusAd, ["ad_name", "name"]),
          adgroupId: pickString(smartPlusAd, ["adgroup_id", "smart_plus_adgroup_id"]),
          campaignId: pickString(smartPlusAd, ["campaign_id", "smart_plus_campaign_id"]),
          operationStatus: pickString(smartPlusAd, ["operation_status", "status"]),
          secondaryStatus: pickString(smartPlusAd, ["secondary_status"]),
          creativeIndex: index,
          adMaterialId: pickString(creative, ["ad_material_id", "material_id"]),
          materialStatus: pickString(creative, ["material_operation_status", "operation_status", "status"]),
          tiktokItemIds: matchedItems,
        }),
      );
    }
  }

  return matches;
}

function sourceActionFromOptions(options) {
  const sourceAction = String(option(options, "source_action", "disable")).toLowerCase();

  if (!["disable", "keep"].includes(sourceAction)) {
    throw new CliError("--source-action must be disable or keep.");
  }

  return sourceAction;
}

function assertSmartPlusMoveSourceSafety(source, options, sourceAction) {
  const sourceAdId = source.adId ?? pickString(source.regularAd, ["ad_id", "id"]);

  if (sourceAdId || sourceAction !== "disable") {
    return;
  }

  if (boolOption(options, "confirm_parent_move")) {
    return;
  }

  throw new CliError(
    "Refusing Smart+ parent move without --confirm-parent-move. If the user named one ad or creative, use --source-ad-id for that regular ad instead.",
    {
      source: smartPlusSourceSummary(source),
      wouldDisable: {
        target: "smart-plus-ad",
        smartPlusAdId: source.smartPlusAdId,
      },
      recommendedCommand:
        "Search for the named creative, then rerun smart-plus-ad-move with --source-ad-id <regular-ad-id>.",
      parentMoveCommand:
        "Only if the user explicitly wants the whole Smart+ bundle moved, rerun with --source-smart-plus-ad-id <id> --confirm-parent-move.",
    },
  );
}

function extractCreatedSmartPlusAdId(responseData) {
  const direct = pickString(responseData, ["smart_plus_ad_id", "ad_id", "id"]);

  if (direct) {
    return direct;
  }

  for (const fieldName of ["smart_plus_ad_ids", "ad_ids", "ids"]) {
    const values = fieldValueList(responseData?.[fieldName]);

    if (values.length > 0) {
      return values[0];
    }
  }

  return null;
}

function sourceUsesSmartPlusMaterialStatus(source) {
  return Boolean(source.smartPlusAdId && source.regularAd);
}

function selectedSmartPlusMaterialIds(creativeSelection) {
  return uniqueNonEmptyStrings(
    arrayFrom(creativeSelection?.selectedCreatives).flatMap((creative) =>
      fieldValueList(creative?.adMaterialId),
    ),
  );
}

function smartPlusMaterialStatusRequest(account, smartPlusAdId, adMaterialIds, status) {
  return {
    accessToken: account.accessToken,
    method: "POST",
    path: "/open_api/v1.3/smart_plus/ad/material_status/update/",
    body: {
      advertiser_id: account.advertiserId,
      smart_plus_ad_id: smartPlusAdId,
      ad_material_ids: adMaterialIds,
      operation_status: status,
    },
  };
}

function smartPlusParentStatusRequest(account, smartPlusAdIds, status) {
  return {
    accessToken: account.accessToken,
    method: "POST",
    path: "/open_api/v1.3/smart_plus/ad/status/update/",
    body: {
      advertiser_id: account.advertiserId,
      smart_plus_ad_ids: smartPlusAdIds,
      operation_status: status,
    },
  };
}

function smartPlusMoveSourceStatusRequest(account, source, sourceAction, creativeSelection) {
  if (sourceAction !== "disable") {
    return null;
  }

  const sourceAdId = source.adId ?? pickString(source.regularAd, ["ad_id", "id"]);

  if (sourceAdId && sourceUsesSmartPlusMaterialStatus(source)) {
    const adMaterialIds = selectedSmartPlusMaterialIds(creativeSelection);

    if (adMaterialIds.length === 0) {
      throw new CliError("Cannot disable the selected Smart+ creative safely because no ad_material_id was found.", {
        source: smartPlusSourceSummary(source),
        creativeSelection,
        recommendedCommand:
          "Inspect the source with smart-plus-ad-get and use smart-plus-material-status with an explicit --ad-material-id.",
      });
    }

    return {
      target: "smart-plus-material",
      request: smartPlusMaterialStatusRequest(account, source.smartPlusAdId, adMaterialIds, "DISABLE"),
    };
  }

  if (sourceAdId) {
    return {
      target: "regular-ad",
      request: {
        accessToken: account.accessToken,
        method: "POST",
        path: "/open_api/v1.3/ad/status/update/",
        body: {
          advertiser_id: account.advertiserId,
          ad_ids: [sourceAdId],
          operation_status: "DISABLE",
        },
      },
    };
  }

  return {
    target: "smart-plus-ad",
    request: smartPlusParentStatusRequest(account, [source.smartPlusAdId], "DISABLE"),
  };
}

async function handleSmartPlusAdGet(env, options) {
  const { organization, account, warnings } = await selectedTikTokAccount(env, options);
  const source = await resolveSmartPlusSource(env, account, options);

  printJson({
    organization: organizationSummary(organization),
    advertiser: advertiserSummary(account),
    warnings: [...warnings, ...source.warnings],
    source: smartPlusSourceSummary(source),
    capabilities: {
      canMoveWithCli: true,
      moveBehavior: "Create in destination, verify, then apply requested source action.",
      defaultSourceAction:
        "disable selected Smart+ material when source is --source-ad-id inside Smart+; disable Smart+ parent only when source is --source-smart-plus-ad-id.",
      copyInstead: "Use smart-plus-ad-move --source-action keep.",
    },
    preview: previewPacketFromSource(source),
    regularAd: source.regularAd,
    smartPlusAd: source.smartPlusAd,
  });
}

async function handleAdPreview(env, options) {
  const { organization, account, warnings } = await selectedTikTokAccount(env, options);
  const source = await inspectSmartPlusSource(env, account, options);

  if (source.error && !source.regularAd) {
    throw new CliError(source.error, {
      adId: source.adId,
      smartPlusAdId: source.smartPlusAdId,
    });
  }

  printJson({
    organization: organizationSummary(organization),
    advertiser: advertiserSummary(account),
    warnings: [...warnings, ...source.warnings, ...(source.error ? [source.error] : [])],
    preview: previewPacketFromSource(source),
    ...(boolOption(options, "include_raw")
      ? {
          regularAd: source.regularAd,
          smartPlusAd: source.smartPlusAd,
        }
      : {}),
  });
}

async function handleSmartPlusAdMove(env, options) {
  const { organization, account, warnings } = await selectedTikTokAccount(env, options);
  const destinationAdgroupId = requiredString(options, "dest_adgroup_id");
  const sourceAction = sourceActionFromOptions(options);
  const source = await resolveSmartPlusSource(env, account, options);
  const destination = await fetchSmartPlusAdgroupById(env, account, destinationAdgroupId, options);
  const commandWarnings = [
    ...warnings,
    ...source.warnings,
    ...destination.warnings,
    "Move creates destination, verifies it, then applies source action; no in-place endpoint is used.",
  ];

  assertSmartPlusMoveSourceSafety(source, options, sourceAction);

  if (!destination.smartPlusAdgroup) {
    throw new CliError("Destination ad group was not found as a Smart+ ad group.", {
      destinationAdgroupId,
      regularAdgroup: destination.regularAdgroup,
      warnings: commandWarnings,
    });
  }

  const createPayload = smartPlusCreatePayloadFromSource(
    source,
    destinationAdgroupId,
    options,
    account.advertiserId,
  );
  const destinationDuplicates = await findDestinationSmartPlusCreatives(
    env,
    account,
    destinationAdgroupId,
    selectedTiktokItemIds(createPayload.creativeSelection),
    options,
  );

  if (destinationDuplicates.length > 0 && !boolOption(options, "allow_duplicate_destination")) {
    throw new CliError(
      "Destination already contains the selected Smart+ creative; refusing to create a duplicate.",
      {
        source: smartPlusSourceSummary(source),
        creativeSelection: createPayload.creativeSelection,
        destinationAdgroupId,
        destinationDuplicates,
        recommendedCommand:
          "If the destination copy is already correct, verify source material status or use smart-plus-material-status to disable only the source ad_material_id.",
        override:
          "Only if the user explicitly wants another duplicate, rerun with --allow-duplicate-destination.",
      },
    );
  }

  const createRequest = {
    accessToken: account.accessToken,
    method: "POST",
    path: "/open_api/v1.3/smart_plus/ad/create/",
    body: createPayload.body,
  };
  const disableRequest =
    smartPlusMoveSourceStatusRequest(account, source, sourceAction, createPayload.creativeSelection);

  if (!boolOption(options, "execute")) {
    printJson({
      dryRun: true,
      executeHint: "Add --execute after the user confirms source, destination, and source action.",
      organization: organizationSummary(organization),
      advertiser: advertiserSummary(account),
      warnings: commandWarnings,
      source: smartPlusSourceSummary(source),
      creativeSelection: createPayload.creativeSelection,
      sourceActionTarget: disableRequest?.target ?? "none",
      destination: {
        adgroupId: destinationAdgroupId,
        smartPlusAdgroup: destination.smartPlusAdgroup,
      },
      sourceAction,
      requests: compactObject({
        create: {
          method: createRequest.method,
          path: createRequest.path,
          body: createRequest.body,
        },
        sourceStatusUpdate: disableRequest
          ? {
              target: disableRequest.target,
              method: disableRequest.request.method,
              path: disableRequest.request.path,
              body: disableRequest.request.body,
            }
          : null,
      }),
    });
    return;
  }

  if (env.TT_ADS_ALLOW_WRITES !== "1") {
    throw new CliError(
      "Write commands are disabled. Set TT_ADS_ALLOW_WRITES=1 in the bot credential env file to allow --execute.",
    );
  }

  let createResponse = null;

  try {
    createResponse = await requestTikTok(env, createRequest);
  } catch (error) {
    if (error instanceof TikTokApiError) {
      throw new CliError("Smart+ destination create failed; source was not changed.", {
        stage: "create",
        sourceActionWasApplied: false,
        source: smartPlusSourceSummary(source),
        creativeSelection: createPayload.creativeSelection,
        destinationAdgroupId,
        request: tikTokRequestSummary(createRequest, createRequest.method),
        tiktokError: {
          message: error.message,
          ...error.details,
        },
      });
    }

    throw error;
  }

  const createdSmartPlusAdId = extractCreatedSmartPlusAdId(createResponse.data);

  if (!createdSmartPlusAdId) {
    throw new CliError("Smart+ create succeeded, but the response did not include the created Smart+ ad ID. Source was not changed.", {
      createResponse,
    });
  }

  const verification = await fetchSmartPlusAdById(env, account, createdSmartPlusAdId, options);
  const verifiedDestinationAdgroupId = pickString(verification.row, [
    "adgroup_id",
    "smart_plus_adgroup_id",
  ]);

  if (!verification.row || verifiedDestinationAdgroupId !== destinationAdgroupId) {
    throw new CliError("Created Smart+ ad could not be verified in the destination ad group. Source was not changed.", {
      createdSmartPlusAdId,
      expectedDestinationAdgroupId: destinationAdgroupId,
      verifiedDestinationAdgroupId,
      verificationWarnings: verification.warnings,
    });
  }

  let sourceStatusResponse = null;

  if (disableRequest) {
    try {
      sourceStatusResponse = await requestTikTok(env, disableRequest.request);
    } catch (error) {
      let rollbackResponse = null;
      let rollbackError = null;

      try {
        rollbackResponse = await requestTikTok(
          env,
          smartPlusParentStatusRequest(account, [createdSmartPlusAdId], "DISABLE"),
        );
      } catch (rollbackCaught) {
        rollbackError =
          rollbackCaught instanceof Error
            ? {
                name: rollbackCaught.name,
                message: rollbackCaught.message,
                ...(rollbackCaught instanceof TikTokApiError ? rollbackCaught.details : {}),
              }
            : { message: String(rollbackCaught) };
      }

      if (error instanceof TikTokApiError) {
        throw new CliError(
          rollbackResponse
            ? "Destination Smart+ ad was created, but source status update failed; the created destination was disabled as rollback."
            : "Destination Smart+ ad was created, but source status update failed; rollback of the created destination also failed.",
          {
            stage: "source-status-update",
            sourceActionWasApplied: false,
            sourceActionTarget: disableRequest.target,
            createdSmartPlusAdId,
            rollback: compactObject({
              attempted: true,
              createdDestinationDisabled: Boolean(rollbackResponse),
              response: rollbackResponse,
              error: rollbackError,
            }),
            source: smartPlusSourceSummary(source),
            destinationAdgroupId,
            request: tikTokRequestSummary(disableRequest.request, disableRequest.request.method),
            createResponse,
            tiktokError: {
              message: error.message,
              ...error.details,
            },
          },
        );
      }

      throw error;
    }
  }

  printJson({
    executed: true,
    organization: organizationSummary(organization),
    advertiser: advertiserSummary(account),
    warnings: [...commandWarnings, ...verification.warnings],
    source: smartPlusSourceSummary(source),
    creativeSelection: createPayload.creativeSelection,
    sourceActionTarget: disableRequest?.target ?? "none",
    destination: {
      adgroupId: destinationAdgroupId,
      smartPlusAdgroup: destination.smartPlusAdgroup,
    },
    sourceAction,
    created: {
      smartPlusAdId: createdSmartPlusAdId,
      smartPlusAd: verification.row,
    },
    responses: compactObject({
      create: createResponse,
      sourceStatusUpdate: sourceStatusResponse,
    }),
  });
}

async function handleSmartPlusCapabilities(env, options) {
  const capabilityMatrix = {
    search: {
      supported: true,
      command: "tt-ads search --org <slug> --query <text> [--match fuzzy|contains|exact] [--preview]",
      defaultMatch: "fuzzy",
    },
    previews: {
      supported: true,
      command: "tt-ads ad-preview --org <slug> --ad-id <id>",
      officialSmartPlusShareUrl: false,
      note: "Preview packet uses API creative IDs and best-effort item links.",
    },
    regularAds: {
      read: "ads",
      status: "ad-status",
      create: "ad-create",
      smartPlusMove: "Only available when the regular ad exposes smart_plus_ad_id.",
    },
    smartPlusAds: {
      read: "smart-plus-ad-get",
      move: "Create in destination, verify, then apply source action.",
      copy: "Use smart-plus-ad-move --source-action keep.",
      materialStatus: "Use smart-plus-material-status to enable/disable specific Smart+ creative materials by ad_material_id.",
      inPlaceMove: false,
      deleteOnMove: false,
    },
    safety: {
      dryRunByDefault: true,
      executeRequires: ["--execute", "TT_ADS_ALLOW_WRITES=1"],
      defaultSourceAction:
        "--source-ad-id in Smart+ disables selected ad material; Smart+ ID disables parent only with --confirm-parent-move",
    },
  };

  if (
    !option(options, "ad_id") &&
    !option(options, "source_ad_id") &&
    !option(options, "smart_plus_ad_id") &&
    !option(options, "source_smart_plus_ad_id")
  ) {
    printJson({
      capabilities: capabilityMatrix,
    });
    return;
  }

  const { organization, account, warnings } = await selectedTikTokAccount(env, options);
  const source = await inspectSmartPlusSource(env, account, options);

  printJson({
    organization: organizationSummary(organization),
    advertiser: advertiserSummary(account),
    warnings: [...warnings, ...source.warnings],
    capabilities: capabilityMatrix,
    source: source.error
      ? {
          adId: source.adId,
          smartPlusAdId: source.smartPlusAdId,
          canMoveWithCli: false,
          reason: source.error,
          regularAd: source.regularAd,
        }
      : {
          ...smartPlusSourceSummary(source),
          canMoveWithCli: true,
          requiredForMove: ["--dest-adgroup-id <smart-plus-adgroup-id>"],
        },
  });
}

async function handleReport(env, options) {
  const { organization, account, warnings } = await selectedTikTokAccount(env, options);
  const startDate = dateStringOption(options, "start");
  const endDate = dateStringOption(options, "end");
  const dimensions = parseCsv(option(options, "dimensions"), ["stat_time_day", "ad_id"]);
  const metrics = parseCsv(option(options, "metrics"), [
    "spend",
    "impressions",
    "clicks",
    "conversion",
  ]);
  const pageSize = positiveIntegerOption(options, "page_size", 1000, MAX_PAGE_SIZE);
  const maxPages = positiveIntegerOption(options, "pages", DEFAULT_MAX_PAGES, 20);
  const result = await pagedList(env, {
    accessToken: account.accessToken,
    path: "/open_api/v1.3/report/integrated/get/",
    query: {
      advertiser_id: account.advertiserId,
      report_type: option(options, "report_type", "BASIC"),
      data_level: option(options, "data_level", "AUCTION_AD"),
      dimensions,
      metrics,
      start_date: startDate,
      end_date: endDate,
    },
    pageSize,
    maxPages,
  });

  printJson({
    organization: organization ? { slug: organization.slug, name: organization.name } : null,
    advertiser: {
      advertiserId: account.advertiserId,
      advertiserName: account.advertiserName ?? null,
    },
    startDate,
    endDate,
    dimensions,
    metrics,
    warnings,
    ...result,
  });
}

function mutationBlockedResponse(env, request, options) {
  if (!boolOption(options, "execute")) {
    return {
      dryRun: true,
      executeHint: "Add --execute to run this mutation after reviewing the payload.",
      request,
    };
  }

  if (env.TT_ADS_ALLOW_WRITES !== "1") {
    throw new CliError(
      "Write commands are disabled. Set TT_ADS_ALLOW_WRITES=1 in the bot credential env file to allow --execute.",
    );
  }

  return null;
}

async function mutate(env, options, request) {
  const blocked = mutationBlockedResponse(env, request, options);

  if (blocked) {
    printJson(blocked);
    return;
  }

  const response = await requestTikTok(env, request);
  printJson({
    executed: true,
    request: {
      method: request.method,
      path: request.path,
      query: request.query,
      body: request.body,
    },
    response,
  });
}

async function mutateMultipart(env, options, request) {
  const blocked = mutationBlockedResponse(env, request.dryRunRequest, options);

  if (blocked) {
    printJson(blocked);
    return;
  }

  const response = await requestTikTokMultipart(env, request);
  printJson({
    executed: true,
    request: request.dryRunRequest,
    response,
  });
}

function operationStatus(options) {
  const status = requiredString(options, "status").toUpperCase();
  const allowed = new Set(["ENABLE", "DISABLE", "DELETE"]);

  if (!allowed.has(status)) {
    throw new CliError("--status must be ENABLE, DISABLE, or DELETE.");
  }

  return status;
}

function enableDisableStatus(options) {
  const status = requiredString(options, "status").toUpperCase();
  const allowed = new Set(["ENABLE", "DISABLE"]);

  if (!allowed.has(status)) {
    throw new CliError("--status must be ENABLE or DISABLE.");
  }

  return status;
}

function idsFromOptions(options, singularName, pluralName) {
  const values = [
    ...parseCsv(option(options, singularName), []),
    ...parseCsv(option(options, pluralName), []),
  ];

  if (values.length === 0) {
    throw new CliError(
      `Missing --${singularName.replaceAll("_", "-")} or --${pluralName.replaceAll("_", "-")}.`,
    );
  }

  return [...new Set(values)];
}

async function handleStatusMutation(env, options, kind) {
  const { account } = await selectedTikTokAccount(env, options);
  const status = operationStatus(options);
  const configs = {
    campaign: {
      path: "/open_api/v1.3/campaign/status/update/",
      singular: "campaign_id",
      plural: "campaign_ids",
    },
    adgroup: {
      path: "/open_api/v1.3/adgroup/status/update/",
      singular: "adgroup_id",
      plural: "adgroup_ids",
    },
    ad: {
      path: "/open_api/v1.3/ad/status/update/",
      singular: "ad_id",
      plural: "ad_ids",
    },
  };
  const config = configs[kind];
  const ids = idsFromOptions(options, config.singular, config.plural);

  await mutate(env, options, {
    accessToken: account.accessToken,
    method: "POST",
    path: config.path,
    body: {
      advertiser_id: account.advertiserId,
      [config.plural]: ids,
      operation_status: status,
    },
  });
}

async function handleSmartPlusMaterialStatus(env, options) {
  const { account } = await selectedTikTokAccount(env, options);
  const smartPlusAdId = requiredString(options, "smart_plus_ad_id");
  const adMaterialIds = idsFromOptions(options, "ad_material_id", "ad_material_ids");
  const status = enableDisableStatus(options);

  await mutate(
    env,
    options,
    smartPlusMaterialStatusRequest(account, smartPlusAdId, adMaterialIds, status),
  );
}

async function handleUpdateMutation(env, options, kind) {
  const { account } = await selectedTikTokAccount(env, options);
  const patch = parseJsonOption(options, "set", {});

  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new CliError("--set must be a JSON object.");
  }

  const configs = {
    campaign: {
      path: "/open_api/v1.3/campaign/update/",
      idKey: "campaign_id",
    },
    adgroup: {
      path: "/open_api/v1.3/adgroup/update/",
      idKey: "adgroup_id",
    },
    ad: {
      path: "/open_api/v1.3/ad/update/",
      idKey: "ad_id",
    },
  };
  const config = configs[kind];
  const id = requiredString(options, config.idKey);

  await mutate(env, options, {
    accessToken: account.accessToken,
    method: "POST",
    path: config.path,
    body: {
      advertiser_id: account.advertiserId,
      [config.idKey]: id,
      ...patch,
    },
  });
}

function requireJsonObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError(`${label} must be a JSON object.`);
  }

  return value;
}

function stringOption(options, name) {
  const value = option(options, name);

  if (value === undefined || value === null || value === false) {
    return undefined;
  }

  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function numberOption(options, name) {
  const value = option(options, name);

  if (value === undefined || value === null || value === false) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new CliError(`--${name.replaceAll("_", "-")} must be a number.`);
  }

  return parsed;
}

function createBodyFromOptions(options, kind) {
  const body = requireJsonObject(parseJsonOption(options, "body", {}), "--body");

  if (kind === "campaign") {
    return {
      ...(stringOption(options, "name") ? { campaign_name: stringOption(options, "name") } : {}),
      ...(stringOption(options, "campaign_name")
        ? { campaign_name: stringOption(options, "campaign_name") }
        : {}),
      ...(stringOption(options, "objective") ? { objective_type: stringOption(options, "objective") } : {}),
      ...(stringOption(options, "objective_type")
        ? { objective_type: stringOption(options, "objective_type") }
        : {}),
      ...(stringOption(options, "budget_mode") ? { budget_mode: stringOption(options, "budget_mode") } : {}),
      ...(numberOption(options, "budget") !== undefined ? { budget: numberOption(options, "budget") } : {}),
      ...body,
    };
  }

  if (kind === "adgroup") {
    return {
      ...(stringOption(options, "campaign_id") ? { campaign_id: stringOption(options, "campaign_id") } : {}),
      ...(stringOption(options, "name") ? { adgroup_name: stringOption(options, "name") } : {}),
      ...(stringOption(options, "adgroup_name")
        ? { adgroup_name: stringOption(options, "adgroup_name") }
        : {}),
      ...(numberOption(options, "budget") !== undefined ? { budget: numberOption(options, "budget") } : {}),
      ...body,
    };
  }

  if (kind === "ad") {
    return {
      ...(stringOption(options, "adgroup_id") ? { adgroup_id: stringOption(options, "adgroup_id") } : {}),
      ...(stringOption(options, "name") ? { ad_name: stringOption(options, "name") } : {}),
      ...(stringOption(options, "ad_name") ? { ad_name: stringOption(options, "ad_name") } : {}),
      ...body,
    };
  }

  throw new CliError(`Unsupported create kind "${kind}".`);
}

async function handleCreateMutation(env, options, kind) {
  const { account } = await selectedTikTokAccount(env, options);
  const body = createBodyFromOptions(options, kind);
  const requiredFields = {
    campaign: ["campaign_name", "objective_type", "budget_mode"],
    adgroup: ["campaign_id", "adgroup_name"],
    ad: ["adgroup_id", "ad_name"],
  }[kind];
  const missing = requiredFields.filter((field) => body[field] === undefined || body[field] === null || body[field] === "");

  if (missing.length > 0) {
    throw new CliError(
      `${kind}-create is missing required field(s): ${missing.join(", ")}. Provide flags or include them in --body JSON.`,
    );
  }

  await mutate(env, options, {
    accessToken: account.accessToken,
    method: "POST",
    path: `/open_api/v1.3/${kind}/create/`,
    body: {
      advertiser_id: account.advertiserId,
      ...body,
    },
  });
}

function mimeTypeForFile(filePath, type) {
  const ext = path.extname(filePath).toLowerCase();

  if (type === "image") {
    if (ext === ".png") return "image/png";
    if (ext === ".webp") return "image/webp";
    return "image/jpeg";
  }

  if (ext === ".mov" || ext === ".qt") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  return "video/mp4";
}

async function handleCreativeUpload(env, options) {
  const { account } = await selectedTikTokAccount(env, options);
  const type = requiredString(options, "type").toLowerCase();

  if (!["image", "video"].includes(type)) {
    throw new CliError("--type must be image or video.");
  }

  const filePath = path.resolve(process.cwd(), requiredString(options, "file"));
  const stat = statSync(filePath);

  if (!stat.isFile()) {
    throw new CliError(`--file is not a file: ${filePath}`);
  }

  const uploadType = stringOption(options, "upload_type") ?? "UPLOAD_BY_FILE";
  const fileField = type === "image" ? "image_file" : "video_file";
  const fileNameField = type === "image" ? "image_file_name" : "video_file_name";
  const fileName = stringOption(options, "file_name") ?? path.basename(filePath);
  const body = requireJsonObject(parseJsonOption(options, "body", {}), "--body");
  const form = new FormData();

  form.set("advertiser_id", account.advertiserId);
  form.set("upload_type", uploadType);
  form.set(fileNameField, fileName);

  for (const [key, value] of Object.entries(body)) {
    form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }

  form.set(
    fileField,
    new Blob([readFileSync(filePath)], { type: mimeTypeForFile(filePath, type) }),
    fileName,
  );

  const endpoint = type === "image" ? "/open_api/v1.3/file/image/ad/upload/" : "/open_api/v1.3/file/video/ad/upload/";

  await mutateMultipart(env, options, {
    accessToken: account.accessToken,
    method: "POST",
    path: endpoint,
    query: {},
    form,
    dryRunRequest: {
      method: "POST",
      path: endpoint,
      query: {},
      body: {
        advertiser_id: account.advertiserId,
        upload_type: uploadType,
        [fileNameField]: fileName,
        [fileField]: {
          path: filePath,
          bytes: stat.size,
          mimeType: mimeTypeForFile(filePath, type),
        },
        ...body,
      },
    },
  });
}

function normalizedEndpointPath(pathValue) {
  return `/${String(pathValue).trim().replace(/^\/+/, "").replace(/\/+$/, "")}/`;
}

function assertRawMutationAllowed(method, pathValue, options) {
  const endpoint = normalizedEndpointPath(pathValue);

  if (
    method !== "GET" &&
    endpoint === "/open_api/v1.3/smart_plus/ad/create/" &&
    !boolOption(options, "allow_smart_plus_raw_create")
  ) {
    throw new CliError(
      "Refusing raw Smart+ ad create. Use smart-plus-ad-move so the source action, verification, and rollback guards stay attached.",
      {
        path: endpoint,
        recommendedCommand:
          "tt-ads smart-plus-ad-move --org <slug> --source-ad-id <regular-ad-id> --dest-adgroup-id <adgroup-id>",
        override:
          "Only for manual low-level debugging, rerun raw with --allow-smart-plus-raw-create.",
      },
    );
  }
}

async function handleRaw(env, options) {
  const { account } = await selectedTikTokAccount(env, options);
  const method = String(option(options, "method", "GET")).toUpperCase();
  const pathValue = requiredString(options, "path");
  const query = parseJsonOption(options, "query", {});
  const body = parseJsonOption(options, "body", undefined);
  const request = {
    accessToken: account.accessToken,
    method,
    path: pathValue,
    query: {
      advertiser_id: account.advertiserId,
      ...query,
    },
    body,
  };

  if (!SAFE_GET_METHODS.has(method)) {
    assertRawMutationAllowed(method, pathValue, options);
    await mutate(env, options, request);
    return;
  }

  printJson(await requestTikTok(env, request));
}

async function handleAccounts(env, options) {
  const { organization, accounts } = await listTikTokAccounts(env, options);
  let organizationsById = new Map();

  if (!organization && accounts.length > 0) {
    const organizationIds = [...new Set(accounts.map((account) => account.organizationId).filter(Boolean))];

    if (organizationIds.length > 0) {
      const organizations = await supabaseSelect(env, "Organization", {
        select: "id,slug,name",
        id: `in.(${organizationIds.join(",")})`,
      });

      organizationsById = new Map(organizations.map((entry) => [entry.id, entry]));
    }
  }

  printJson({
    organization: organization ? { slug: organization.slug, name: organization.name } : null,
    count: accounts.length,
    accounts: accounts.map((account) => ({
      id: account.id,
      organizationId: account.organizationId,
      organizationSlug: organizationsById.get(account.organizationId)?.slug ?? organization?.slug ?? null,
      organizationName: organizationsById.get(account.organizationId)?.name ?? organization?.name ?? null,
      advertiserId: account.advertiserId,
      advertiserName: account.advertiserName,
      status: account.status,
      hasAccessToken: Boolean(account.accessToken),
      hasRefreshToken: Boolean(account.refreshToken),
      accessTokenExpiresAt: account.accessTokenExpiresAt ?? null,
      refreshTokenExpiresAt: account.refreshTokenExpiresAt ?? null,
      lastValidatedAt: account.lastValidatedAt ?? null,
      updatedAt: account.updatedAt ?? null,
      scope: account.scope ?? null,
    })),
  });
}

async function handleAdvertisers(env, options) {
  const { account, warnings } = await selectedTikTokAccount(env, options);
  const appId = firstEnv(env, ["TIKTOK_APP_ID"]);
  const secret = firstEnv(env, ["TIKTOK_SECRET"]);

  if (!appId || !secret) {
    throw new CliError("TIKTOK_APP_ID and TIKTOK_SECRET are required.");
  }

  const response = await requestTikTok(env, {
    accessToken: account.accessToken,
    method: "GET",
    path: "/open_api/v1.3/oauth2/advertiser/get/",
    query: {
      app_id: appId,
      secret,
    },
  });

  printJson({
    warnings,
    requestId: response.requestId,
    data: response.data,
  });
}

async function handleEnvCheck(env, options) {
  const checks = {
    TIKTOK_BUSINESS_BASE_URL: Boolean(env.TIKTOK_BUSINESS_BASE_URL || DEFAULT_TIKTOK_BASE_URL),
    TIKTOK_APP_ID: Boolean(env.TIKTOK_APP_ID),
    TIKTOK_SECRET: Boolean(env.TIKTOK_SECRET),
    SUPABASE_URL: Boolean(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL),
    SUPABASE_SERVER_KEY: Boolean(serviceRoleKey(env)),
    TT_ADS_ALLOW_WRITES: env.TT_ADS_ALLOW_WRITES === "1",
  };
  let account = null;
  let accountError = null;

  if (option(options, "org") || env.TT_ADS_DEFAULT_ORG_SLUG) {
    try {
      const selected = await selectedTikTokAccount(env, options);
      account = {
        organizationSlug: selected.organization?.slug ?? null,
        advertiserId: selected.account.advertiserId,
        advertiserName: selected.account.advertiserName ?? null,
        status: selected.account.status ?? null,
        hasAccessToken: Boolean(selected.account.accessToken),
      };
    } catch (error) {
      accountError = error instanceof Error ? error.message : String(error);
    }
  }

  printJson({
    ok:
      checks.TIKTOK_BUSINESS_BASE_URL &&
      checks.TIKTOK_APP_ID &&
      checks.TIKTOK_SECRET &&
      checks.SUPABASE_URL &&
      checks.SUPABASE_SERVER_KEY,
    checks,
    account,
    accountError,
  });
}

async function handleDoctor(env, options) {
  const selected = await selectedTikTokAccount(env, {
    ...options,
    limit: 10,
  });
  const sample = await pagedList(env, {
    accessToken: selected.account.accessToken,
    path: "/open_api/v1.3/campaign/get/",
    query: {
      advertiser_id: selected.account.advertiserId,
      fields: ["campaign_id", "campaign_name", "operation_status"],
    },
    pageSize: 1,
    maxPages: 1,
  });

  printJson({
    ok: true,
    organization: selected.organization
      ? { slug: selected.organization.slug, name: selected.organization.name }
      : null,
    advertiser: {
      advertiserId: selected.account.advertiserId,
      advertiserName: selected.account.advertiserName ?? null,
      status: selected.account.status ?? null,
    },
    warnings: selected.warnings,
    canReadCampaigns: true,
    sampleCampaignCount: sample.rowCount,
    writeGateEnabled: env.TT_ADS_ALLOW_WRITES === "1",
  });
}

function helpText() {
  return `
TikTok Business CLI for OpenClaw

Usage:
  tt-ads <command> [options]

Environment:
  --env-file <path>              Load a specific env file.
  --org <slug>                   Organization slug to read saved TikTok account from Supabase.
  --advertiser-id <id>           Override/select advertiser ID.

Read commands:
  help
  env-check [--org <slug>]
  doctor --org <slug>
  accounts [--org <slug>]
  advertisers --org <slug>
  campaigns --org <slug> [--fields campaign_id,campaign_name] [--filtering JSON]
  adgroups --org <slug> [--fields adgroup_id,adgroup_name,campaign_id]
  ads --org <slug> [--fields ad_id,ad_name,campaign_id,adgroup_id]
  search --org <slug> --query "bledar" [--match fuzzy|contains|exact] [--preview]
    [--campaign "Scaling Campaign"] [--adgroup "Feet and inches"]
  ad-preview --org <slug> (--ad-id <id>|--smart-plus-ad-id <id>) [--include-raw]
  smart-plus-capabilities [--org <slug>] [--ad-id <id>|--smart-plus-ad-id <id>]
  smart-plus-ad-get --org <slug> (--ad-id <id>|--smart-plus-ad-id <id>)
  identities --org <slug> [--identity-type BC_AUTH_TT] [--query "bledar"]
  identity-info --org <slug> --identity-id <id> [--identity-type BC_AUTH_TT] [--identity-authorized-bc-id <id>]
  identity-videos --org <slug> --identity-id <id> [--identity-type BC_AUTH_TT] [--identity-authorized-bc-id <id>]
  identity-video-info --org <slug> --identity-id <id> --item-id <tiktok-item-id> [--identity-type BC_AUTH_TT]
  identity-videos-unlaunched --org <slug> (--creator "name"|--identity-id <id>) [--identity-type BC_AUTH_TT]
  spark-videos --org <slug> [--creator "name"] [--tiktok-item-id <id>] [--active-only]
  spark-api-unlaunched --org <slug> [--creator "name"] [--include-inactive]
  spark-authorizations --org <slug> [--creator "name or handle"] [--active-only]
  spark-unlaunched --org <slug> [--creator "name or handle"] [--include-inactive]
  spark-launch-plan --org <slug> (--authorization-id <id>|--tiktok-item-id <id>) \\
    --template-ad-id <id> --dest-adgroup-id <id> [--source local|tiktok-api|identity-api|auto] [--creative JSON] [--body JSON] [--allow-duplicate] [--preserve-template]
  spark-bulk-launch-plan --org <slug> --template-ad-id <id> --dest-adgroup-id <id> [--limit 10]
  report --org <slug> --start YYYY-MM-DD --end YYYY-MM-DD \\
    [--dimensions stat_time_day,ad_id] [--metrics spend,impressions,clicks,conversion]
  raw --org <slug> --method GET --path /open_api/v1.3/campaign/get/ --query JSON

Write commands are dry-run by default and require both TT_ADS_ALLOW_WRITES=1
and --execute:
  smart-plus-ad-move --org <slug> --source-ad-id <id> --dest-adgroup-id <id> \\
    [--name "Ad"] [--source-action disable|keep] [--creative-scope source-ad|enabled-bundle|full-bundle]
    [--allow-duplicate-destination]
  smart-plus-ad-move --org <slug> --source-smart-plus-ad-id <id> --dest-adgroup-id <id> \\
    --confirm-parent-move [--source-action disable|keep]
  smart-plus-material-status --org <slug> --smart-plus-ad-id <id> --ad-material-id <id> --status ENABLE|DISABLE
  campaign-create --org <slug> --name "Campaign" --objective TRAFFIC --budget-mode BUDGET_MODE_TOTAL --budget 50
  adgroup-create --org <slug> --campaign-id <id> --name "Ad group" --body JSON
  creative-upload --org <slug> --type video|image --file ./creative.mp4
  ad-create --org <slug> --adgroup-id <id> --name "Ad" --body JSON
  spark-launch --org <slug> (--authorization-id <id>|--tiktok-item-id <id>) \\
    --template-ad-id <id> --dest-adgroup-id <id> [--source local|tiktok-api|identity-api|auto] [--creative JSON] [--body JSON] [--allow-duplicate] [--preserve-template]
  campaign-status --org <slug> --campaign-id <id> --status ENABLE|DISABLE|DELETE
  adgroup-status --org <slug> --adgroup-id <id> --status ENABLE|DISABLE|DELETE
  ad-status --org <slug> --ad-id <id> --status ENABLE|DISABLE|DELETE
  campaign-update --org <slug> --campaign-id <id> --set '{"budget":50.5}'
  adgroup-update --org <slug> --adgroup-id <id> --set '{"budget":100}'
  ad-update --org <slug> --ad-id <id> --set '{"ad_name":"new name"}'

Examples:
  tt-ads doctor --org gotall
  tt-ads search --org gotall --query "bleder" --preview
  tt-ads search --org gotall --query "bledar" --campaign "Scaling Campaign" --adgroup "Feet and inches"
  tt-ads ad-preview --org gotall --ad-id 123
  tt-ads smart-plus-ad-get --org gotall --ad-id 123
  tt-ads smart-plus-capabilities --org gotall --ad-id 123
  tt-ads smart-plus-ad-move --org gotall --source-ad-id 123 --dest-adgroup-id 456
  tt-ads smart-plus-ad-move --org gotall --source-ad-id 123 --dest-adgroup-id 456 --creative-scope enabled-bundle
  tt-ads smart-plus-ad-move --org gotall --source-smart-plus-ad-id 123 --dest-adgroup-id 456 --confirm-parent-move
  tt-ads smart-plus-material-status --org gotall --smart-plus-ad-id 123 --ad-material-id 456 --status DISABLE
  tt-ads campaigns --org gotall --limit 20 --fields campaign_id,campaign_name,budget,operation_status
  tt-ads report --org gotall --start 2026-05-01 --end 2026-05-04 --dimensions stat_time_day,campaign_id,adgroup_id,ad_id --metrics spend,impressions,clicks,conversion
  tt-ads campaign-create --org gotall --name "New Traffic Campaign" --objective TRAFFIC --budget-mode BUDGET_MODE_TOTAL --budget 50
  tt-ads adgroup-create --org gotall --campaign-id 123 --name "Prospecting" --body '{"promotion_type":"WEBSITE","placement_type":"PLACEMENT_TYPE_AUTOMATIC"}'
  tt-ads creative-upload --org gotall --type video --file ./creative.mp4
  tt-ads ad-create --org gotall --adgroup-id 456 --name "Hook test" --body '{"creatives":[{"ad_text":"Try it today"}]}'
  tt-ads identities --org gotall --identity-type BC_AUTH_TT --query bledar
  tt-ads identity-videos-unlaunched --org gotall --creator bledar
  tt-ads spark-videos --org gotall --creator bledar --active-only
  tt-ads spark-api-unlaunched --org gotall --creator bledar
  tt-ads spark-unlaunched --org gotall --creator "bledar"
  tt-ads spark-launch-plan --org gotall --tiktok-item-id 7601781140742999310 --source tiktok-api --template-ad-id 123 --dest-adgroup-id 456
  tt-ads spark-launch-plan --org gotall --tiktok-item-id 7636527758406880526 --source identity-api --creator bledar --template-ad-id 123 --dest-adgroup-id 456
  tt-ads spark-launch-plan --org gotall --tiktok-item-id 7601781140742999310 --source tiktok-api --template-ad-id 123 --dest-adgroup-id 456 --allow-duplicate
  tt-ads spark-launch-plan --org gotall --authorization-id abc --template-ad-id 123 --dest-adgroup-id 456
  tt-ads spark-launch --org gotall --authorization-id abc --template-ad-id 123 --dest-adgroup-id 456 --execute
  tt-ads adgroup-status --org gotall --adgroup-id 123 --status DISABLE
  tt-ads adgroup-status --org gotall --adgroup-id 123 --status DISABLE --execute
`.trim();
}

async function maybeListSkillFiles() {
  const skillDir = path.join(repoRoot, "openclaw", "tiktok-ads");

  try {
    return await readdir(skillDir);
  } catch {
    return [];
  }
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const env = loadEnv({
    envFile: option(options, "env_file"),
  });

  switch (command) {
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(`${helpText()}\n`);
      break;
    case "env-check":
      await handleEnvCheck(env, options);
      break;
    case "doctor":
      await handleDoctor(env, options);
      break;
    case "accounts":
      await handleAccounts(env, options);
      break;
    case "advertisers":
      await handleAdvertisers(env, options);
      break;
    case "campaigns":
      await handleListCommand(env, options, "campaign", [
        "campaign_id",
        "campaign_name",
        "budget",
        "operation_status",
        "secondary_status",
      ]);
      break;
    case "adgroups":
      await handleListCommand(env, options, "adgroup", [
        "adgroup_id",
        "adgroup_name",
        "campaign_id",
        "budget",
        "operation_status",
        "secondary_status",
      ]);
      break;
    case "ads":
      await handleListCommand(env, options, "ad", [
        "ad_id",
        "ad_name",
        "campaign_id",
        "adgroup_id",
        "operation_status",
        "secondary_status",
        "tiktok_item_id",
        "smart_plus_ad_id",
      ]);
      break;
    case "search":
      await handleSearch(env, options);
      break;
    case "ad-preview":
      await handleAdPreview(env, options);
      break;
    case "smart-plus-capabilities":
      await handleSmartPlusCapabilities(env, options);
      break;
    case "smart-plus-ad-get":
      await handleSmartPlusAdGet(env, options);
      break;
    case "identities":
    case "identity-list":
      await handleTikTokIdentities(env, options);
      break;
    case "identity-info":
      await handleTikTokIdentityInfo(env, options);
      break;
    case "identity-videos":
      await handleTikTokIdentityVideos(env, options);
      break;
    case "identity-videos-unlaunched":
    case "identity-unlaunched":
    case "creator-videos-unlaunched":
      await handleTikTokIdentityUnlaunched(env, options);
      break;
    case "identity-video-info":
      await handleTikTokIdentityVideoInfo(env, options);
      break;
    case "spark-videos":
    case "spark-api-videos":
      await handleTikTokSparkVideos(env, options);
      break;
    case "spark-api-unlaunched":
      await handleTikTokSparkUnlaunched(env, options);
      break;
    case "spark-authorizations":
      await handleSparkAuthorizations(env, options);
      break;
    case "spark-unlaunched":
      await handleSparkUnlaunched(env, options);
      break;
    case "spark-launch-plan":
      await handleSparkLaunch(env, options, "plan");
      break;
    case "spark-launch":
      await handleSparkLaunch(env, options, "launch");
      break;
    case "spark-bulk-launch-plan":
      await handleSparkBulkLaunchPlan(env, options);
      break;
    case "smart-plus-ad-move":
      await handleSmartPlusAdMove(env, options);
      break;
    case "smart-plus-material-status":
      await handleSmartPlusMaterialStatus(env, options);
      break;
    case "report":
      await handleReport(env, options);
      break;
    case "raw":
      await handleRaw(env, options);
      break;
    case "campaign-create":
      await handleCreateMutation(env, options, "campaign");
      break;
    case "adgroup-create":
      await handleCreateMutation(env, options, "adgroup");
      break;
    case "ad-create":
      await handleCreateMutation(env, options, "ad");
      break;
    case "creative-upload":
      await handleCreativeUpload(env, options);
      break;
    case "campaign-status":
      await handleStatusMutation(env, options, "campaign");
      break;
    case "adgroup-status":
      await handleStatusMutation(env, options, "adgroup");
      break;
    case "ad-status":
      await handleStatusMutation(env, options, "ad");
      break;
    case "campaign-update":
      await handleUpdateMutation(env, options, "campaign");
      break;
    case "adgroup-update":
      await handleUpdateMutation(env, options, "adgroup");
      break;
    case "ad-update":
      await handleUpdateMutation(env, options, "ad");
      break;
    case "skill-files":
      printJson({ files: await maybeListSkillFiles() });
      break;
    case "self-test-temp":
      printJson({ tmp: mkdtempSync(path.join(tmpdir(), "tt-ads-cli-")) });
      break;
    case "self-test-clean-temp": {
      const tempPath = requiredString(options, "path");
      rmSync(tempPath, { recursive: true, force: true });
      printJson({ removed: tempPath });
      break;
    }
    default:
      throw new CliError(`Unknown command "${command}". Run "tt-ads help".`);
  }
}

main().catch((error) => {
  const payload = {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
    name: error instanceof Error ? error.name : "Error",
    details: error?.details ?? undefined,
  };

  process.stderr.write(`${JSON.stringify(redactDeep(payload), null, 2)}\n`);
  process.exitCode = 1;
});
