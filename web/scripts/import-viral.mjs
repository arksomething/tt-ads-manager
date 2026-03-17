#!/usr/bin/env node

import nextEnvPackage from "@next/env";
import prismaPackage from "@prisma/client";

const { loadEnvConfig } = nextEnvPackage;
const {
  CreatorStatus,
  ExternalSource,
  Platform,
  PrismaClient,
  SourceEntityType,
  SyncJobStatus,
  SyncJobType,
} = prismaPackage;

loadEnvConfig(process.cwd());

const DEFAULT_BASE_URL = "https://viral.app/api/v1/";
const MAX_INT = 2_147_483_647;
const PAGE_CONCURRENCY = 1;
const PAGE_SIZE = 100;

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: getDatabaseUrl(),
    },
  },
});

class ViralApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = "ViralApiError";
    this.status = status;
    this.payload = payload;
  }
}

function parseArgs(argv) {
  const options = {
    days: 7,
    includeCompetitors: false,
    org: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--org" || token === "--organization") {
      options.org = argv[index + 1];
      index += 1;
      continue;
    }

    if (token.startsWith("--org=")) {
      options.org = token.slice("--org=".length);
      continue;
    }

    if (token.startsWith("--organization=")) {
      options.org = token.slice("--organization=".length);
      continue;
    }

    if (token === "--days") {
      options.days = Number(argv[index + 1]);
      index += 1;
      continue;
    }

    if (token.startsWith("--days=")) {
      options.days = Number(token.slice("--days=".length));
      continue;
    }

    if (token === "--include-competitors") {
      options.includeCompetitors = true;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (!options.org) {
    throw new Error("Missing --org <organization-slug-or-name>.");
  }

  if (!Number.isInteger(options.days) || options.days < 1) {
    throw new Error("--days must be a positive integer.");
  }

  return options;
}

function getEnv() {
  const apiKey = process.env.VIRAL_APP_API_KEY ?? process.env.DATA_PROVIDER_API_KEY;
  const baseUrl =
    process.env.VIRAL_APP_BASE_URL ??
    process.env.DATA_PROVIDER_BASE_URL ??
    DEFAULT_BASE_URL;

  if (!apiKey) {
    throw new Error(
      "Missing VIRAL_APP_API_KEY (or DATA_PROVIDER_API_KEY) in the environment.",
    );
  }

  return {
    apiKey,
    baseUrl: baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  };
}

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("Missing DATABASE_URL in the environment.");
  }

  const url = new URL(databaseUrl);

  if (
    url.hostname.endsWith(".pooler.supabase.com") &&
    (url.port === "5432" || url.port === "")
  ) {
    url.port = "6543";
  }

  if (!url.searchParams.has("pgbouncer")) {
    url.searchParams.set("pgbouncer", "true");
  }

  if (!url.searchParams.has("connection_limit")) {
    url.searchParams.set("connection_limit", "1");
  }

  return url.toString();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeText(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function toDate(value) {
  const text = normalizeText(value);

  if (!text) {
    return null;
  }

  const normalized = text.includes("T")
    ? text.replace(/\+00$/, "Z")
    : text.replace(" ", "T").replace(/\+00$/, "Z");
  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : date;
}

function toSafeInt(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Math.max(0, Math.min(MAX_INT, Math.round(numeric)));
}

function toPercent(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  if (numeric > 0 && numeric < 1) {
    return Number((numeric * 100).toFixed(4));
  }

  return Number(numeric.toFixed(4));
}

function sanitizeTags(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const tags = [];
  const seen = new Set();

  for (const entry of value) {
    const normalized = normalizeText(entry);

    if (!normalized) {
      continue;
    }

    const cleaned = normalized.replace(/^#/, "").slice(0, 64);
    const lookupKey = cleaned.toLowerCase();

    if (cleaned.length === 0 || seen.has(lookupKey)) {
      continue;
    }

    seen.add(lookupKey);
    tags.push(cleaned);
  }

  return tags;
}

function mapPlatform(platform) {
  switch (platform) {
    case "instagram":
      return Platform.INSTAGRAM_REELS;
    case "tiktok":
      return Platform.TIKTOK;
    case "youtube":
      return Platform.YOUTUBE_SHORTS;
    default:
      throw new Error(`Unsupported viral.app platform: ${platform}`);
  }
}

function getCreatorDisplayName(accountOrVideo) {
  return (
    normalizeText(accountOrVideo.displayName) ??
    normalizeText(accountOrVideo.accountDisplayName) ??
    normalizeText(accountOrVideo.creatorName) ??
    normalizeText(accountOrVideo.username) ??
    normalizeText(accountOrVideo.accountUsername) ??
    normalizeText(accountOrVideo.platformAccountId) ??
    "Imported Creator"
  );
}

function buildProfileUrl(account) {
  const username =
    normalizeText(account.username) ?? normalizeText(account.accountUsername);

  if (!username) {
    return null;
  }

  const cleanUsername = username.startsWith("@") ? username.slice(1) : username;

  switch (account.platform) {
    case "instagram":
      return `https://www.instagram.com/${encodeURIComponent(cleanUsername)}/`;
    case "tiktok":
      return `https://www.tiktok.com/@${encodeURIComponent(cleanUsername)}`;
    case "youtube":
      return `https://www.youtube.com/@${encodeURIComponent(cleanUsername)}`;
    default:
      return null;
  }
}

function buildVideoUrl(video) {
  const platformVideoId = normalizeText(video.platformVideoId);

  if (!platformVideoId) {
    return null;
  }

  const accountUsername = normalizeText(video.accountUsername);
  const cleanUsername = accountUsername?.startsWith("@")
    ? accountUsername.slice(1)
    : accountUsername;

  switch (video.platform) {
    case "instagram":
      return `https://www.instagram.com/reel/${encodeURIComponent(platformVideoId)}/`;
    case "tiktok":
      return cleanUsername
        ? `https://www.tiktok.com/@${encodeURIComponent(cleanUsername)}/video/${encodeURIComponent(platformVideoId)}`
        : `https://www.tiktok.com/video/${encodeURIComponent(platformVideoId)}`;
    case "youtube":
      return `https://www.youtube.com/shorts/${encodeURIComponent(platformVideoId)}`;
    default:
      return null;
  }
}

function buildAccountContactInfo(account) {
  const email = normalizeText(account.creatorEmail);

  return email ? { email } : undefined;
}

function accountSourceKey(platform, sourceAccountId) {
  return sourceAccountId ? `${platform}:${sourceAccountId}` : null;
}

function accountHandleKey(platform, handle) {
  return handle ? `${platform}:${handle.toLowerCase()}` : null;
}

function videoSourceKey(platform, sourceVideoId) {
  return sourceVideoId ? `${platform}:${sourceVideoId}` : null;
}

function getWindowStart(days) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start;
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function chunk(values, size) {
  const batches = [];

  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }

  return batches;
}

class ViralClient {
  constructor(env) {
    this.apiKey = env.apiKey;
    this.baseUrl = env.baseUrl;
  }

  async request(path, query = {}, attempt = 0) {
    const relativePath = path.startsWith("/") ? path.slice(1) : path;
    const url = new URL(relativePath, this.baseUrl);

    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-api-key": this.apiKey,
      },
      cache: "no-store",
    });

    const rawText = await response.text();
    let payload;

    try {
      payload = rawText ? JSON.parse(rawText) : {};
    } catch {
      payload = rawText;
    }

    if (!response.ok) {
      if ((response.status === 429 || response.status >= 500) && attempt < 3) {
        const retryAfterHeader = Number(response.headers.get("Retry-After"));
        const retryAfterMs =
          Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
            ? retryAfterHeader * 1_000
            : 500 * 2 ** attempt;

        await sleep(retryAfterMs);
        return this.request(path, query, attempt + 1);
      }

      throw new ViralApiError(
        payload?.message ?? `viral.app request failed with ${response.status}.`,
        response.status,
        payload,
      );
    }

    return payload;
  }

  async getAllPages(path, label, baseQuery = {}, options = {}) {
    const allowPartial = options.allowPartial === true;
    const firstPage = await this.request(path, {
      ...baseQuery,
      page: 1,
      perPage: PAGE_SIZE,
    });
    const records = Array.isArray(firstPage.data) ? [...firstPage.data] : [];
    const pageCount =
      Number.isInteger(firstPage.pageCount) && firstPage.pageCount > 0
        ? firstPage.pageCount
        : 1;

    console.log(
      `Fetched page 1/${pageCount} for ${label} (${records.length} rows so far).`,
    );

    const remainingPages = [];

    for (let page = 2; page <= pageCount; page += 1) {
      remainingPages.push(page);
    }

    for (const pageBatch of chunk(remainingPages, PAGE_CONCURRENCY)) {
      try {
        const batchResponses = await Promise.all(
          pageBatch.map((page) =>
            this.request(path, {
              ...baseQuery,
              page,
              perPage: PAGE_SIZE,
            }),
          ),
        );

        for (const batchResponse of batchResponses) {
          if (Array.isArray(batchResponse.data)) {
            records.push(...batchResponse.data);
          }
        }

        const lastPage = pageBatch[pageBatch.length - 1];
        console.log(
          `Fetched pages ${pageBatch[0]}-${lastPage} for ${label} (${records.length} rows so far).`,
        );
      } catch (error) {
        if (allowPartial && records.length > 0) {
          const failedPage = pageBatch[0] ?? pageCount;
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          console.warn(
            `Stopped fetching ${label} at page ${failedPage} after partial success: ${errorMessage}`,
          );

          return {
            records,
            partial: true,
            pageCount,
            fetchedPages: failedPage - 1,
            errorMessage,
          };
        }

        throw error;
      }
    }

    return {
      records,
      partial: false,
      pageCount,
      fetchedPages: pageCount,
      errorMessage: null,
    };
  }
}

function recordAccountInMaps(maps, accountRecord) {
  const sourceKey = accountSourceKey(
    accountRecord.platform,
    normalizeText(accountRecord.sourceAccountId),
  );

  if (sourceKey) {
    maps.bySource.set(sourceKey, accountRecord);
  }

  const handleKey = accountHandleKey(
    accountRecord.platform,
    normalizeText(accountRecord.handle),
  );

  if (handleKey) {
    maps.byHandle.set(handleKey, accountRecord);
  }
}

async function syncAccount({
  importedAccount,
  maps,
  organizationId,
  stats,
  syncCapturedAt,
}) {
  const platform = mapPlatform(importedAccount.platform);
  const sourceAccountId = normalizeText(importedAccount.platformAccountId);
  const handle =
    normalizeText(importedAccount.username) ??
    normalizeText(importedAccount.accountUsername);

  if (!handle) {
    stats.skippedAccounts += 1;
    return null;
  }

  const sourceKey = accountSourceKey(platform, sourceAccountId);
  const handleKey = accountHandleKey(platform, handle);
  const existingAccount =
    (sourceKey ? maps.bySource.get(sourceKey) : null) ??
    (handleKey ? maps.byHandle.get(handleKey) : null);

  const syncedAt =
    toDate(importedAccount.loadAt) ??
    toDate(importedAccount.updatedAt) ??
    syncCapturedAt;
  const accountPayload = {
    handle,
    profileUrl: buildProfileUrl(importedAccount),
    followerCount: toSafeInt(importedAccount.followerCount),
    averageViews: toSafeInt(importedAccount.averageViewsPerVideo),
    averageEngagementRate: toPercent(importedAccount.engagementRate),
    contactInfo: buildAccountContactInfo(importedAccount),
    lastSyncedAt: syncedAt,
    rawPayload: importedAccount,
  };

  if (sourceAccountId) {
    accountPayload.sourceAccountId = sourceAccountId;
  }

  if (existingAccount) {
    await prisma.$transaction(async (tx) => {
      await tx.creatorPlatformAccount.update({
        where: {
          id: existingAccount.id,
        },
        data: accountPayload,
      });

      await tx.creatorMetricsSnapshot.create({
        data: {
          creatorId: existingAccount.creatorId,
          platformAccountId: existingAccount.id,
          capturedAt: syncedAt,
          followerCount: accountPayload.followerCount,
          averageViews: accountPayload.averageViews,
          averageEngagementRate: accountPayload.averageEngagementRate,
          sourcePayload: importedAccount,
        },
      });

      if (sourceAccountId) {
        await tx.sourceMapping.upsert({
          where: {
            externalSource_externalResourceType_externalId: {
              externalSource: ExternalSource.DATA_PROVIDER,
              externalResourceType: `viral-account:${platform}`,
              externalId: sourceAccountId,
            },
          },
          update: {
            organizationId,
            localEntityType: SourceEntityType.PLATFORM_ACCOUNT,
            localEntityId: existingAccount.id,
            lastSyncedAt: syncedAt,
            rawPayload: importedAccount,
          },
          create: {
            organizationId,
            localEntityType: SourceEntityType.PLATFORM_ACCOUNT,
            localEntityId: existingAccount.id,
            externalSource: ExternalSource.DATA_PROVIDER,
            externalResourceType: `viral-account:${platform}`,
            externalId: sourceAccountId,
            lastSyncedAt: syncedAt,
            rawPayload: importedAccount,
          },
        });
      }
    });

    const refreshedRecord = {
      ...existingAccount,
      handle,
      platform,
      sourceAccountId,
    };

    recordAccountInMaps(maps, refreshedRecord);
    stats.updatedAccounts += 1;
    stats.accountSnapshots += 1;
    return refreshedRecord;
  }

  const created = await prisma.$transaction(async (tx) => {
    const creator = await tx.creator.create({
      data: {
        organizationId,
        displayName: getCreatorDisplayName(importedAccount),
        region: normalizeText(importedAccount.countryCode),
        internalStatus: CreatorStatus.ACTIVE,
        contactEmail: normalizeText(importedAccount.creatorEmail),
      },
    });

    const account = await tx.creatorPlatformAccount.create({
      data: {
        creatorId: creator.id,
        platform,
        sourceAccountId,
        handle,
        profileUrl: accountPayload.profileUrl,
        followerCount: accountPayload.followerCount,
        averageViews: accountPayload.averageViews,
        averageEngagementRate: accountPayload.averageEngagementRate,
        contactInfo: accountPayload.contactInfo,
        lastSyncedAt: syncedAt,
        rawPayload: importedAccount,
      },
    });

    await tx.creatorMetricsSnapshot.create({
      data: {
        creatorId: creator.id,
        platformAccountId: account.id,
        capturedAt: syncedAt,
        followerCount: accountPayload.followerCount,
        averageViews: accountPayload.averageViews,
        averageEngagementRate: accountPayload.averageEngagementRate,
        sourcePayload: importedAccount,
      },
    });

    if (sourceAccountId) {
      await tx.sourceMapping.create({
        data: {
          organizationId,
          localEntityType: SourceEntityType.PLATFORM_ACCOUNT,
          localEntityId: account.id,
          externalSource: ExternalSource.DATA_PROVIDER,
          externalResourceType: `viral-account:${platform}`,
          externalId: sourceAccountId,
          lastSyncedAt: syncedAt,
          rawPayload: importedAccount,
        },
      });
    }

    return {
      id: account.id,
      creatorId: creator.id,
      platform,
      sourceAccountId,
      handle,
    };
  });

  recordAccountInMaps(maps, created);
  stats.createdCreators += 1;
  stats.createdAccounts += 1;
  stats.accountSnapshots += 1;
  return created;
}

async function syncVideo({
  importedVideo,
  maps,
  organizationId,
  stats,
  syncCapturedAt,
  videoMap,
}) {
  const platform = mapPlatform(importedVideo.platform);
  const sourceVideoId = normalizeText(importedVideo.platformVideoId);

  if (!sourceVideoId) {
    stats.skippedVideos += 1;
    return null;
  }

  const sourceAccountId = normalizeText(importedVideo.platformAccountId);
  const handle =
    normalizeText(importedVideo.accountUsername) ??
    normalizeText(importedVideo.username);
  const account =
    (sourceAccountId
      ? maps.bySource.get(accountSourceKey(platform, sourceAccountId))
      : null) ??
    (handle ? maps.byHandle.get(accountHandleKey(platform, handle)) : null) ??
    (await syncAccount({
      importedAccount: {
        accountUsername: importedVideo.accountUsername,
        creatorEmail: null,
        countryCode: null,
        displayName: importedVideo.accountDisplayName,
        followerCount: null,
        platform: importedVideo.platform,
        platformAccountId: importedVideo.platformAccountId,
        username: importedVideo.accountUsername,
        updatedAt: importedVideo.loadAt,
        loadAt: importedVideo.loadAt,
        engagementRate: importedVideo.engagementRate,
      },
      maps,
      organizationId,
      stats,
      syncCapturedAt,
    }));

  if (!account) {
    stats.skippedVideos += 1;
    return null;
  }

  const publishedAt = toDate(importedVideo.publishedAt) ?? syncCapturedAt;
  const syncedAt = toDate(importedVideo.loadAt) ?? syncCapturedAt;
  const videoKey = videoSourceKey(platform, sourceVideoId);
  const existingVideo = videoMap.get(videoKey);
  const videoUrl = buildVideoUrl(importedVideo);

  if (!videoUrl) {
    stats.skippedVideos += 1;
    return null;
  }

  const videoPayload = {
    creatorId: account.creatorId,
    creatorPlatformAccountId: account.id,
    platform,
    sourceVideoId,
    videoUrl,
    titleOrCaption: normalizeText(importedVideo.caption),
    publishedAt,
    views: toSafeInt(importedVideo.viewCount),
    likes: toSafeInt(importedVideo.likeCount),
    comments: toSafeInt(importedVideo.commentCount),
    engagementRate: toPercent(importedVideo.engagementRate),
    contentTags: sanitizeTags(importedVideo.hashtags),
    rawPayload: importedVideo,
    lastSyncedAt: syncedAt,
  };

  if (existingVideo) {
    await prisma.$transaction(async (tx) => {
      await tx.video.update({
        where: {
          id: existingVideo.id,
        },
        data: videoPayload,
      });

      await tx.videoMetricsSnapshot.create({
        data: {
          videoId: existingVideo.id,
          capturedAt: syncedAt,
          views: videoPayload.views,
          likes: videoPayload.likes,
          comments: videoPayload.comments,
          engagementRate: videoPayload.engagementRate,
          sourcePayload: importedVideo,
        },
      });

      await tx.sourceMapping.upsert({
        where: {
          externalSource_externalResourceType_externalId: {
            externalSource: ExternalSource.DATA_PROVIDER,
            externalResourceType: `viral-video:${platform}`,
            externalId: sourceVideoId,
          },
        },
        update: {
          organizationId,
          localEntityType: SourceEntityType.VIDEO,
          localEntityId: existingVideo.id,
          lastSyncedAt: syncedAt,
          rawPayload: importedVideo,
        },
        create: {
          organizationId,
          localEntityType: SourceEntityType.VIDEO,
          localEntityId: existingVideo.id,
          externalSource: ExternalSource.DATA_PROVIDER,
          externalResourceType: `viral-video:${platform}`,
          externalId: sourceVideoId,
          lastSyncedAt: syncedAt,
          rawPayload: importedVideo,
        },
      });
    });

    stats.updatedVideos += 1;
    stats.videoSnapshots += 1;
    return existingVideo.id;
  }

  const createdVideoId = await prisma.$transaction(async (tx) => {
    const video = await tx.video.create({
      data: videoPayload,
    });

    await tx.videoMetricsSnapshot.create({
      data: {
        videoId: video.id,
        capturedAt: syncedAt,
        views: videoPayload.views,
        likes: videoPayload.likes,
        comments: videoPayload.comments,
        engagementRate: videoPayload.engagementRate,
        sourcePayload: importedVideo,
      },
    });

    await tx.sourceMapping.create({
      data: {
        organizationId,
        localEntityType: SourceEntityType.VIDEO,
        localEntityId: video.id,
        externalSource: ExternalSource.DATA_PROVIDER,
        externalResourceType: `viral-video:${platform}`,
        externalId: sourceVideoId,
        lastSyncedAt: syncedAt,
        rawPayload: importedVideo,
      },
    });

    return video.id;
  });

  videoMap.set(videoKey, {
    id: createdVideoId,
  });
  stats.createdVideos += 1;
  stats.videoSnapshots += 1;
  return createdVideoId;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = getEnv();
  const client = new ViralClient(env);
  const syncCapturedAt = new Date();
  const since = getWindowStart(args.days);
  const until = new Date();

  const organization = await prisma.organization.findFirst({
    where: {
      OR: [
        {
          slug: args.org,
        },
        {
          name: {
            equals: args.org,
            mode: "insensitive",
          },
        },
      ],
    },
    select: {
      id: true,
      name: true,
      slug: true,
    },
  });

  if (!organization) {
    throw new Error(
      `Organization '${args.org}' was not found by slug or case-insensitive name.`,
    );
  }

  const syncJob = await prisma.externalSyncJob.create({
    data: {
      organizationId: organization.id,
      jobType: SyncJobType.ORGANIZATION_IMPORT,
      status: SyncJobStatus.RUNNING,
      resourceType: "viral.app",
      startedAt: syncCapturedAt,
      requestPayload: {
        source: "viral.app",
        includeCompetitors: args.includeCompetitors,
        organizationSlug: organization.slug,
        windowDays: args.days,
        windowStart: since.toISOString(),
        windowEnd: until.toISOString(),
      },
    },
    select: {
      id: true,
    },
  });

  try {
    console.log(
      `Importing viral.app data into '${organization.name}' (${organization.slug}) for ${args.days} day(s)...`,
    );

    const stats = {
      accountSnapshots: 0,
      createdAccounts: 0,
      createdCreators: 0,
      createdVideos: 0,
      skippedAccounts: 0,
      skippedVideos: 0,
      updatedAccounts: 0,
      updatedVideos: 0,
      videoSnapshots: 0,
    };
    const warnings = [];
    const viewMode = args.includeCompetitors ? "all" : "internal";
    const dateRangeQuery = {
      "dateRange[from]": formatDateOnly(since),
      "dateRange[to]": formatDateOnly(until),
      sortCol: "publishedAt",
      sortDir: "desc",
      viewMode,
    };
    const existingAccounts = await prisma.creatorPlatformAccount.findMany({
      where: {
        creator: {
          organizationId: organization.id,
        },
      },
      select: {
        id: true,
        creatorId: true,
        handle: true,
        platform: true,
        sourceAccountId: true,
      },
    });
    const accountMaps = {
      byHandle: new Map(),
      bySource: new Map(),
    };

    for (const account of existingAccounts) {
      recordAccountInMaps(accountMaps, account);
    }

    const accountsResult = await client.getAllPages(
      "/accounts",
      "accounts",
      dateRangeQuery,
      { allowPartial: true },
    );

    if (accountsResult.partial) {
      warnings.push(
        `Account sync was partial after page ${accountsResult.fetchedPages} of ${accountsResult.pageCount}: ${accountsResult.errorMessage}`,
      );
    }

    const importedAccounts = accountsResult.records.filter((account) => {
      if (args.includeCompetitors) {
        return true;
      }

      return account.isCompetitor !== true;
    });

    console.log(
      `Prepared ${importedAccounts.length} account rows for import.`,
    );

    for (const importedAccount of importedAccounts) {
      await syncAccount({
        importedAccount,
        maps: accountMaps,
        organizationId: organization.id,
        stats,
        syncCapturedAt,
      });
    }

    let videosResult = {
      records: [],
      partial: false,
      pageCount: 0,
      fetchedPages: 0,
      errorMessage: null,
    };

    try {
      videosResult = await client.getAllPages(
        "/videos",
        "videos",
        dateRangeQuery,
        { allowPartial: true },
      );
    } catch (error) {
      if (error instanceof ViralApiError) {
        warnings.push(`Video sync was skipped: ${error.message}`);
      } else {
        throw error;
      }
    }

    if (videosResult.partial) {
      warnings.push(
        `Video sync was partial after page ${videosResult.fetchedPages} of ${videosResult.pageCount}: ${videosResult.errorMessage}`,
      );
    }

    const recentVideos = videosResult.records.filter((video) => {
      if (!args.includeCompetitors && video.isCompetitor === true) {
        return false;
      }

      const publishedAt = toDate(video.publishedAt);

      return publishedAt && publishedAt >= since && publishedAt <= until;
    });
    const existingVideos = recentVideos.length
      ? await prisma.video.findMany({
          where: {
            creator: {
              organizationId: organization.id,
            },
            sourceVideoId: {
              in: recentVideos
                .map((video) => normalizeText(video.platformVideoId))
                .filter(Boolean),
            },
          },
          select: {
            id: true,
            platform: true,
            sourceVideoId: true,
          },
        })
      : [];
    const videoMap = new Map();

    for (const video of existingVideos) {
      const key = videoSourceKey(video.platform, normalizeText(video.sourceVideoId));

      if (key) {
        videoMap.set(key, video);
      }
    }

    console.log(`Prepared ${recentVideos.length} recent video rows for import.`);

    for (const importedVideo of recentVideos) {
      await syncVideo({
        importedVideo,
        maps: accountMaps,
        organizationId: organization.id,
        stats,
        syncCapturedAt,
        videoMap,
      });
    }

    const [creatorCount, accountCount, totalVideoCount, recentMetrics] =
      await Promise.all([
        prisma.creator.count({
          where: {
            organizationId: organization.id,
          },
        }),
        prisma.creatorPlatformAccount.count({
          where: {
            creator: {
              organizationId: organization.id,
            },
          },
        }),
        prisma.video.count({
          where: {
            creator: {
              organizationId: organization.id,
            },
          },
        }),
        prisma.video.aggregate({
          where: {
            creator: {
              organizationId: organization.id,
            },
            publishedAt: {
              gte: since,
              lte: until,
            },
          },
          _avg: {
            engagementRate: true,
          },
          _sum: {
            likes: true,
            views: true,
          },
        }),
      ]);

    const resultPayload = {
      ...stats,
      warnings,
      accountFetch: {
        fetchedPages: accountsResult.fetchedPages,
        pageCount: accountsResult.pageCount,
        partial: accountsResult.partial,
        rowCount: importedAccounts.length,
      },
      videoFetch: {
        fetchedPages: videosResult.fetchedPages,
        pageCount: videosResult.pageCount,
        partial: videosResult.partial,
        rowCount: recentVideos.length,
      },
      creatorCount,
      accountCount,
      totalVideoCount,
      recentAverageEngagementRate: recentMetrics._avg.engagementRate,
      recentLikes: recentMetrics._sum.likes ?? 0,
      recentViews: recentMetrics._sum.views ?? 0,
      recentVideoCount: recentVideos.length,
      syncedAt: new Date().toISOString(),
    };

    await prisma.externalSyncJob.update({
      where: {
        id: syncJob.id,
      },
      data: {
        status: SyncJobStatus.SUCCEEDED,
        finishedAt: new Date(),
        resultPayload,
      },
    });

    console.log(JSON.stringify(resultPayload, null, 2));
  } catch (error) {
    await prisma.externalSyncJob.update({
      where: {
        id: syncJob.id,
      },
      data: {
        status: SyncJobStatus.FAILED,
        finishedAt: new Date(),
        errorMessage:
          error instanceof Error ? error.message.slice(0, 5_000) : String(error),
        resultPayload:
          error instanceof ViralApiError
            ? {
                payload: error.payload ?? null,
                status: error.status,
              }
            : undefined,
      },
    });

    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
