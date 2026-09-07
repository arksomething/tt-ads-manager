import { createClient } from "@/lib/supabase/server";

export type ContentPlatform = "TIKTOK" | "INSTAGRAM_REELS";
export type ContentMatchState =
  | "submitted"
  | "matching"
  | "matched"
  | "needs_review"
  | "rejected"
  | "withdrawn";

export type CreatorPlatformAccountOption = {
  id: string;
  platform: ContentPlatform;
  handle: string;
};

export type CreatorContentSubmission = {
  id: string;
  platform: ContentPlatform;
  url: string;
  declaredNativePostId: string | null;
  matchState: ContentMatchState;
  matchedPostId: string | null;
  submittedAt: string;
  matchedAt: string | null;
  creatorNote: string | null;
};

export type CreatorPostObservation = {
  observedAt: string;
  viewCount: string | null;
  likeCount: string | null;
  commentCount: string | null;
  shareCount: string | null;
};

export type CreatorPost = {
  id: string;
  platform: ContentPlatform;
  nativePostId: string | null;
  canonicalUrl: string | null;
  publishedAt: string | null;
  attributionState: "unattributed" | "creator_claimed" | "verified" | "disputed";
  latestObservation: CreatorPostObservation | null;
};

export type CreatorContentWorkspace = {
  canSubmit: boolean;
  platformAccounts: CreatorPlatformAccountOption[];
  submissions: CreatorContentSubmission[];
  posts: CreatorPost[];
};

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function platformValue(value: unknown): ContentPlatform | null {
  const candidate = stringValue(value);
  return candidate === "TIKTOK" || candidate === "INSTAGRAM_REELS" ? candidate : null;
}

function nullableCounter(value: unknown) {
  const candidate = stringValue(value);
  return candidate && /^\d+$/u.test(candidate) ? candidate : null;
}

function normalizeObservation(value: unknown): CreatorPostObservation | null {
  const row = recordValue(value);
  const observedAt = stringValue(row?.observedAt ?? row?.observed_at);
  if (!row || !observedAt) return null;

  return {
    observedAt,
    viewCount: nullableCounter(row.viewCount ?? row.view_count),
    likeCount: nullableCounter(row.likeCount ?? row.like_count),
    commentCount: nullableCounter(row.commentCount ?? row.comment_count),
    shareCount: nullableCounter(row.shareCount ?? row.share_count),
  };
}

function normalizePlatformAccounts(value: unknown): CreatorPlatformAccountOption[] | null {
  if (!Array.isArray(value)) return null;
  const accounts: CreatorPlatformAccountOption[] = [];
  for (const candidate of value) {
    const row = recordValue(candidate);
    const id = stringValue(row?.id);
    const platform = platformValue(row?.platform);
    const handle = stringValue(row?.handle);
    if (!id || !platform || !handle) return null;
    accounts.push({ id, platform, handle });
  }
  return accounts;
}

function normalizeSubmissions(value: unknown): CreatorContentSubmission[] | null {
  if (!Array.isArray(value)) return null;
  const validStates = new Set<ContentMatchState>([
    "submitted",
    "matching",
    "matched",
    "needs_review",
    "rejected",
    "withdrawn",
  ]);

  const submissions: CreatorContentSubmission[] = [];
  for (const candidate of value) {
    const row = recordValue(candidate);
    const id = stringValue(row?.id);
    const platform = platformValue(row?.platform);
    const url = stringValue(row?.url);
    const matchState = stringValue(row?.matchState ?? row?.match_state) as ContentMatchState | null;
    const submittedAt = stringValue(row?.submittedAt ?? row?.submitted_at);

    if (!id || !platform || !url || !matchState || !validStates.has(matchState) || !submittedAt) {
      return null;
    }

    submissions.push({
      id,
      platform,
      url,
      declaredNativePostId: stringValue(
        row?.declaredNativePostId ?? row?.declared_native_post_id,
      ),
      matchState,
      matchedPostId: stringValue(row?.matchedPostId ?? row?.matched_post_id),
      submittedAt,
      matchedAt: stringValue(row?.matchedAt ?? row?.matched_at),
      creatorNote: stringValue(row?.creatorNote ?? row?.creator_note),
    });
  }
  return submissions;
}

function normalizePosts(value: unknown): CreatorPost[] | null {
  if (!Array.isArray(value)) return null;
  const validAttributionStates = new Set<CreatorPost["attributionState"]>([
    "unattributed",
    "creator_claimed",
    "verified",
    "disputed",
  ]);

  const posts: CreatorPost[] = [];
  for (const candidate of value) {
    const row = recordValue(candidate);
    if (!row) return null;
    const id = stringValue(row?.id);
    const platform = platformValue(row?.platform);
    const attributionState = stringValue(
      row?.attributionState ?? row?.attribution_state,
    ) as CreatorPost["attributionState"] | null;

    if (!id || !platform || !attributionState || !validAttributionStates.has(attributionState)) {
      return null;
    }

    const rawObservation = row.latestObservation ?? row.latest_observation;
    const latestObservation = normalizeObservation(rawObservation);
    if (rawObservation !== null && rawObservation !== undefined && !latestObservation) return null;

    posts.push({
      id,
      platform,
      nativePostId: stringValue(row?.nativePostId ?? row?.native_post_id),
      canonicalUrl: stringValue(row?.canonicalUrl ?? row?.canonical_url),
      publishedAt: stringValue(row?.publishedAt ?? row?.published_at),
      attributionState,
      latestObservation,
    });
  }
  return posts;
}

export function normalizeCreatorContentWorkspace(
  value: unknown,
): CreatorContentWorkspace | null {
  const row = recordValue(Array.isArray(value) ? value[0] : value);
  if (
    !row || typeof row.canSubmit !== "boolean" ||
    !Array.isArray(row.platformAccounts ?? row.platform_accounts) ||
    !Array.isArray(row.submissions) ||
    !Array.isArray(row.posts)
  ) return null;

  const platformAccounts = normalizePlatformAccounts(
    row.platformAccounts ?? row.platform_accounts,
  );
  const submissions = normalizeSubmissions(row.submissions);
  const posts = normalizePosts(row.posts);
  if (!platformAccounts || !submissions || !posts) return null;

  return {
    canSubmit: row.canSubmit,
    platformAccounts,
    submissions,
    posts,
  };
}

export async function getOwnContentWorkspace() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_own_content_workspace");
  if (error) {
    throw new Error("Could not load the creator content workspace.", { cause: error });
  }

  const workspace = normalizeCreatorContentWorkspace(data);
  if (!workspace) throw new Error("The creator content workspace returned invalid data.");
  return workspace;
}
