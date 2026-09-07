import { createClient } from "@/lib/supabase/server";

type UnknownRecord = Record<string, unknown>;

export type AdminWorkspaceSummary = {
  creatorCount: number;
  activeCreatorCount: number;
  applicationAttentionCount: number;
  verifiedPlatformAccountCount: number;
  publishedPostCount: number;
  contentAttentionCount: number;
  observedPostCount: number;
  knownDeltaPostCount: number;
  viewsGained: string | null;
  discordConnectedCount: number;
};

export type AdminMoneySummary = {
  currency: string;
  currencyExponent: number;
  state: string;
  amountMinor: string;
  count: number;
};

export type AdminDailyActivity = {
  date: string;
  posts: number;
  submissions: number;
  observedPosts: number;
};

export type AdminCreatorDirectoryItem = {
  accountId: string;
  name: string | null;
  email: string;
  lifecycleStatus: string;
  applicationId: string | null;
  applicationStatus: string | null;
  enrollmentStatus: string | null;
  joinedAt: string;
  approvedAt: string | null;
  platforms: Array<{ platform: string; handle: string; status: string }>;
  postCount: number;
  openSubmissionCount: number;
  lastPostAt: string | null;
  lastActivityAt: string;
};

export type AdminWorkspace = {
  range: { start: string; end: string };
  summary: AdminWorkspaceSummary;
  earnings: AdminMoneySummary[];
  settlements: AdminMoneySummary[];
  dailyActivity: AdminDailyActivity[];
  creators: AdminCreatorDirectoryItem[];
};

export type AdminCreatorProfile = {
  account: UnknownRecord;
  application: UnknownRecord | null;
  enrollment: UnknownRecord | null;
  agreement: UnknownRecord | null;
  platformClaims: UnknownRecord[];
  posts: UnknownRecord[];
  submissions: UnknownRecord[];
  earnings: UnknownRecord[];
  settlements: UnknownRecord[];
  scripts: UnknownRecord[];
};

function recordValue(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function countValue(value: unknown): number | null {
  const number = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/u.test(value.trim())
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function recordArray(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((candidate) => {
        const record = recordValue(candidate);
        return record ? [record] : [];
      })
    : [];
}

function normalizeMoney(value: unknown): AdminMoneySummary[] | null {
  if (!Array.isArray(value)) return null;
  const rows: AdminMoneySummary[] = [];
  for (const candidate of value) {
    const record = recordValue(candidate);
    if (!record) return null;
    const currency = stringValue(record.currency);
    const exponent = countValue(record.currencyExponent ?? record.currency_exponent);
    const state = stringValue(record.state);
    const amountMinor = stringValue(record.amountMinor ?? record.amount_minor);
    const count = countValue(record.entryCount ?? record.settlementCount ?? record.count);
    if (
      !currency || !state || !amountMinor || !/^-?\d+$/u.test(amountMinor) ||
      exponent === null || exponent > 4 || count === null
    ) return null;
    rows.push({
      currency,
      currencyExponent: exponent,
      state,
      amountMinor,
      count,
    });
  }
  return rows;
}

function timestampValue(value: unknown) {
  const candidate = stringValue(value);
  return candidate && !Number.isNaN(Date.parse(candidate)) ? candidate : null;
}

function normalizeCreators(value: unknown): AdminCreatorDirectoryItem[] | null {
  if (!Array.isArray(value)) return null;
  const creators: AdminCreatorDirectoryItem[] = [];
  for (const candidate of value) {
    const record = recordValue(candidate);
    if (!record || !Array.isArray(record.platforms)) return null;
    const accountId = stringValue(record.accountId ?? record.account_id);
    const email = stringValue(record.email);
    const lifecycleStatus = stringValue(record.lifecycleStatus ?? record.lifecycle_status);
    const joinedAt = timestampValue(record.joinedAt ?? record.joined_at);
    const lastActivityAt = timestampValue(record.lastActivityAt ?? record.last_activity_at);
    const postCount = countValue(record.postCount ?? record.post_count);
    const openSubmissionCount = countValue(record.openSubmissionCount ?? record.open_submission_count);
    if (
      !accountId || !email || !lifecycleStatus || !joinedAt || !lastActivityAt ||
      postCount === null || openSubmissionCount === null
    ) return null;
    const platforms: AdminCreatorDirectoryItem["platforms"] = [];
    for (const platformCandidate of record.platforms) {
      const platform = recordValue(platformCandidate);
      if (!platform) return null;
      const platformName = stringValue(platform.platform);
      const handle = stringValue(platform.handle);
      const status = stringValue(platform.status);
      if (!platformName || !handle || !status) return null;
      platforms.push({ platform: platformName, handle, status });
    }
    creators.push({
      accountId,
      name: stringValue(record.name),
      email,
      lifecycleStatus,
      applicationId: stringValue(record.applicationId ?? record.application_id),
      applicationStatus: stringValue(record.applicationStatus ?? record.application_status),
      enrollmentStatus: stringValue(record.enrollmentStatus ?? record.enrollment_status),
      joinedAt,
      approvedAt: stringValue(record.approvedAt ?? record.approved_at),
      platforms,
      postCount,
      openSubmissionCount,
      lastPostAt: timestampValue(record.lastPostAt ?? record.last_post_at),
      lastActivityAt,
    });
  }
  return creators;
}

function normalizeDailyActivity(value: unknown): AdminDailyActivity[] | null {
  if (!Array.isArray(value)) return null;
  const days: AdminDailyActivity[] = [];
  for (const candidate of value) {
    const record = recordValue(candidate);
    const date = stringValue(record?.date);
    const posts = countValue(record?.posts);
    const submissions = countValue(record?.submissions);
    const observedPosts = countValue(record?.observedPosts ?? record?.observed_posts);
    if (
      !date || !/^\d{4}-\d{2}-\d{2}$/u.test(date) ||
      posts === null || submissions === null || observedPosts === null
    ) return null;
    days.push({ date, posts, submissions, observedPosts });
  }
  return days;
}

export function normalizeAdminWorkspace(value: unknown): AdminWorkspace | null {
  const root = recordValue(value);
  const range = recordValue(root?.range);
  const summary = recordValue(root?.summary);
  const start = stringValue(range?.start);
  const end = stringValue(range?.end);
  if (!root || !summary || !start || !end) return null;

  const creatorCount = countValue(summary.creatorCount ?? summary.creator_count);
  const activeCreatorCount = countValue(summary.activeCreatorCount ?? summary.active_creator_count);
  const applicationAttentionCount = countValue(summary.applicationAttentionCount ?? summary.application_attention_count);
  const verifiedPlatformAccountCount = countValue(summary.verifiedPlatformAccountCount ?? summary.verified_platform_account_count);
  const publishedPostCount = countValue(summary.publishedPostCount ?? summary.published_post_count);
  const contentAttentionCount = countValue(summary.contentAttentionCount ?? summary.content_attention_count);
  const observedPostCount = countValue(summary.observedPostCount ?? summary.observed_post_count);
  const knownDeltaPostCount = countValue(summary.knownDeltaPostCount ?? summary.known_delta_post_count);
  const discordConnectedCount = countValue(summary.discordConnectedCount ?? summary.discord_connected_count);
  const rawViewsGained = summary.viewsGained ?? summary.views_gained;
  const viewsGained = rawViewsGained === null || rawViewsGained === undefined
    ? null
    : stringValue(rawViewsGained);
  const earnings = normalizeMoney(root.earnings);
  const settlements = normalizeMoney(root.settlements);
  const dailyActivity = normalizeDailyActivity(root.dailyActivity ?? root.daily_activity);
  const creators = normalizeCreators(root.creators);
  if (
    [creatorCount, activeCreatorCount, applicationAttentionCount, verifiedPlatformAccountCount,
      publishedPostCount, contentAttentionCount, observedPostCount, knownDeltaPostCount,
      discordConnectedCount].some((value) => value === null) ||
    (viewsGained !== null && !/^\d+$/u.test(viewsGained)) ||
    !earnings || !settlements || !dailyActivity || !creators
  ) return null;

  return {
    range: { start, end },
    summary: {
      creatorCount: creatorCount as number,
      activeCreatorCount: activeCreatorCount as number,
      applicationAttentionCount: applicationAttentionCount as number,
      verifiedPlatformAccountCount: verifiedPlatformAccountCount as number,
      publishedPostCount: publishedPostCount as number,
      contentAttentionCount: contentAttentionCount as number,
      observedPostCount: observedPostCount as number,
      knownDeltaPostCount: knownDeltaPostCount as number,
      viewsGained,
      discordConnectedCount: discordConnectedCount as number,
    },
    earnings,
    settlements,
    dailyActivity,
    creators,
  };
}

export function normalizeAdminCreatorProfile(value: unknown): AdminCreatorProfile | null {
  const root = recordValue(value);
  const account = recordValue(root?.account);
  if (!root || !account || !stringValue(account.id)) return null;
  const platformClaimsRaw = root.platformClaims ?? root.platform_claims;
  const postsRaw = root.posts;
  const submissionsRaw = root.submissions;
  const earningsRaw = root.earnings;
  const settlementsRaw = root.settlements;
  const scriptsRaw = root.scripts;
  const platformClaims = Array.isArray(platformClaimsRaw)
    ? recordArray(platformClaimsRaw)
    : null;
  const posts = Array.isArray(postsRaw) ? recordArray(postsRaw) : null;
  const submissions = Array.isArray(submissionsRaw) ? recordArray(submissionsRaw) : null;
  const earnings = Array.isArray(earningsRaw) ? recordArray(earningsRaw) : null;
  const settlements = Array.isArray(settlementsRaw) ? recordArray(settlementsRaw) : null;
  const scripts = Array.isArray(scriptsRaw) ? recordArray(scriptsRaw) : null;
  if (
    !platformClaims || !Array.isArray(platformClaimsRaw) || platformClaims.length !== platformClaimsRaw.length ||
    !posts || !Array.isArray(postsRaw) || posts.length !== postsRaw.length ||
    !submissions || !Array.isArray(submissionsRaw) || submissions.length !== submissionsRaw.length ||
    !earnings || !Array.isArray(earningsRaw) || earnings.length !== earningsRaw.length ||
    !settlements || !Array.isArray(settlementsRaw) || settlements.length !== settlementsRaw.length ||
    !scripts || !Array.isArray(scriptsRaw) || scripts.length !== scriptsRaw.length
  ) return null;
  return {
    account,
    application: recordValue(root.application),
    enrollment: recordValue(root.enrollment),
    agreement: recordValue(root.agreement),
    platformClaims,
    posts,
    submissions,
    earnings,
    settlements,
    scripts,
  };
}

export async function getAdminWorkspace(start?: string, end?: string) {
  const supabase = await createClient();
  const args = start && end ? { range_start: start, range_end: end } : undefined;
  const { data, error } = await supabase.rpc("get_creator_admin_workspace", args);
  if (error) throw new Error("Could not load creator operations.", { cause: error });
  const workspace = normalizeAdminWorkspace(data);
  if (!workspace) throw new Error("Creator operations returned invalid data.");
  return workspace;
}

export async function getAdminCreatorProfile(accountId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_creator_admin_profile", {
    target_account_id: accountId,
  });
  if (error) throw new Error("Could not load the creator profile.", { cause: error });
  const profile = normalizeAdminCreatorProfile(data);
  if (!profile) throw new Error("Creator profile returned invalid data.");
  return profile;
}
