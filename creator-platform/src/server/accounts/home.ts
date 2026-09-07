import { createClient } from "@/lib/supabase/server";
import {
  getOwnContentWorkspace,
  type CreatorContentWorkspace,
} from "@/server/accounts/content";
import {
  getOwnEarningsWorkspace,
  type CreatorEarningsWorkspace,
  type EarningState,
} from "@/server/accounts/earnings";
import {
  getOwnCreatorContentLibrary,
  type CreatorContentLibrary,
  type CreatorScript,
} from "@/server/content/library";

const ACTIVITY_DAY_COUNT = 30;
const RECENT_POST_DAY_COUNT = 7;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

const EARNING_STATE_ORDER: EarningState[] = [
  "estimated",
  "pending",
  "approved",
  "paid",
  "reconciled",
];

export type CreatorAccountUpdate = {
  id: string;
  topic: string;
  title: string;
  occurredAt: string;
};

export type CreatorHomeViewCoverage = {
  state: "empty" | "unknown" | "partial" | "covered";
  knownViews: string | null;
  totalPostCount: number;
  postsWithKnownViews: number;
  latestObservedAt: string | null;
};

export type CreatorHomeActivityDay = {
  date: string;
  postCount: number;
  submissionCount: number;
};

export type CreatorHomeEarningSummary = {
  state: EarningState;
  currency: string;
  currencyExponent: number;
  amountMinor: string;
  entryCount: number;
};

export type CreatorHomeOverview = {
  availability: {
    content: boolean;
    earnings: boolean;
    library: boolean;
    updates: boolean;
  };
  viewCoverage: CreatorHomeViewCoverage;
  postsLastSevenDays: number | null;
  undatedPostCount: number | null;
  openSubmissionCount: number | null;
  earningEntryCount: number | null;
  activity: CreatorHomeActivityDay[];
  earningSummaries: CreatorHomeEarningSummary[];
  scripts: CreatorScript[];
  updates: CreatorAccountUpdate[];
};

export type CreatorHomeNextAction = {
  kind: "onboarding" | "script" | "none" | "unavailable";
  title: string;
  description: string;
  href: string | null;
  buttonLabel: string | null;
  dueAt: string | null;
};

type CreatorHomeSources = {
  content: CreatorContentWorkspace | null;
  earnings: CreatorEarningsWorkspace | null;
  library: CreatorContentLibrary | null;
  updates: CreatorAccountUpdate[] | null;
  now?: Date;
};

type UnknownRecord = Record<string, unknown>;

function recordValue(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestampValue(value: unknown) {
  const candidate = stringValue(value);
  return candidate && !Number.isNaN(Date.parse(candidate)) ? candidate : null;
}

function utcDateKey(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function utcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function compareOptionalTimestamps(left: string | null, right: string | null) {
  const leftTime = left ? Date.parse(left) : Number.NaN;
  const rightTime = right ? Date.parse(right) : Number.NaN;
  const leftKnown = !Number.isNaN(leftTime);
  const rightKnown = !Number.isNaN(rightTime);

  if (leftKnown && rightKnown) return leftTime - rightTime;
  if (leftKnown) return -1;
  if (rightKnown) return 1;
  return 0;
}

export function normalizeCreatorAccountUpdates(value: unknown): CreatorAccountUpdate[] | null {
  if (!Array.isArray(value)) return null;

  const updates: CreatorAccountUpdate[] = [];
  for (const candidate of value) {
    const row = recordValue(candidate);
    const id = stringValue(row?.id);
    const topic = stringValue(row?.topic);
    const title = stringValue(row?.title);
    const occurredAt = timestampValue(row?.scheduled_for ?? row?.occurredAt);
    if (!id || !topic || !title || !occurredAt) return null;
    updates.push({ id, topic, title, occurredAt });
  }

  return updates.sort(
    (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
  );
}

function summarizeViews(content: CreatorContentWorkspace | null): CreatorHomeViewCoverage {
  if (!content) {
    return {
      state: "unknown",
      knownViews: null,
      totalPostCount: 0,
      postsWithKnownViews: 0,
      latestObservedAt: null,
    };
  }

  const totalPostCount = content.posts.length;
  if (totalPostCount === 0) {
    return {
      state: "empty",
      knownViews: null,
      totalPostCount,
      postsWithKnownViews: 0,
      latestObservedAt: null,
    };
  }

  let knownViews = BigInt(0);
  let postsWithKnownViews = 0;
  let latestObservedAt: string | null = null;

  for (const post of content.posts) {
    const observation = post.latestObservation;
    const observedAt = timestampValue(observation?.observedAt);
    if (observedAt && (
      latestObservedAt === null || Date.parse(observedAt) > Date.parse(latestObservedAt)
    )) {
      latestObservedAt = observedAt;
    }

    if (observation?.viewCount !== null && observation?.viewCount !== undefined) {
      knownViews += BigInt(observation.viewCount);
      postsWithKnownViews += 1;
    }
  }

  return {
    state: postsWithKnownViews === 0
      ? "unknown"
      : postsWithKnownViews === totalPostCount
        ? "covered"
        : "partial",
    knownViews: postsWithKnownViews === 0 ? null : knownViews.toString(),
    totalPostCount,
    postsWithKnownViews,
    latestObservedAt,
  };
}

function buildActivity(content: CreatorContentWorkspace | null, now: Date) {
  const today = utcDay(now);
  const days = Array.from({ length: ACTIVITY_DAY_COUNT }, (_, index) => {
    const date = new Date(
      today.getTime() - ((ACTIVITY_DAY_COUNT - index - 1) * DAY_MILLISECONDS),
    );
    return {
      date: date.toISOString().slice(0, 10),
      postCount: 0,
      submissionCount: 0,
    } satisfies CreatorHomeActivityDay;
  });

  if (!content) return days;

  const daysByDate = new Map(days.map((day) => [day.date, day]));
  for (const post of content.posts) {
    const date = utcDateKey(post.publishedAt);
    const day = date ? daysByDate.get(date) : null;
    if (day) day.postCount += 1;
  }
  for (const submission of content.submissions) {
    const date = utcDateKey(submission.submittedAt);
    const day = date ? daysByDate.get(date) : null;
    if (day) day.submissionCount += 1;
  }

  return days;
}

export function summarizeEarnings(
  earnings: CreatorEarningsWorkspace | null,
): CreatorHomeEarningSummary[] {
  if (!earnings) return [];

  const summaries = new Map<string, CreatorHomeEarningSummary>();
  for (const entry of earnings.entries) {
    const key = `${entry.state}:${entry.currency}:${entry.currencyExponent}`;
    const current = summaries.get(key);
    summaries.set(key, {
      state: entry.state,
      currency: entry.currency,
      currencyExponent: entry.currencyExponent,
      amountMinor: (
        BigInt(current?.amountMinor ?? "0") + BigInt(entry.amountMinor)
      ).toString(),
      entryCount: (current?.entryCount ?? 0) + 1,
    });
  }

  return [...summaries.values()].sort((left, right) => {
    const stateDifference = EARNING_STATE_ORDER.indexOf(left.state)
      - EARNING_STATE_ORDER.indexOf(right.state);
    return stateDifference || left.currency.localeCompare(right.currency)
      || left.currencyExponent - right.currencyExponent;
  });
}

export function buildCreatorHomeOverview({
  content,
  earnings,
  library,
  updates,
  now = new Date(),
}: CreatorHomeSources): CreatorHomeOverview {
  const activity = buildActivity(content, now);
  const recentStartDate = activity[ACTIVITY_DAY_COUNT - RECENT_POST_DAY_COUNT]?.date;
  const todayDate = activity.at(-1)?.date;
  const postsLastSevenDays = content
    ? content.posts.filter((post) => {
        const date = utcDateKey(post.publishedAt);
        return Boolean(date && recentStartDate && todayDate && date >= recentStartDate && date <= todayDate);
      }).length
    : null;
  const undatedPostCount = content
    ? content.posts.filter((post) => utcDateKey(post.publishedAt) === null).length
    : null;
  const openSubmissionCount = content
    ? content.submissions.filter((submission) => (
        submission.matchState === "submitted"
        || submission.matchState === "matching"
        || submission.matchState === "needs_review"
      )).length
    : null;

  return {
    availability: {
      content: content !== null,
      earnings: earnings !== null,
      library: library !== null,
      updates: updates !== null,
    },
    viewCoverage: summarizeViews(content),
    postsLastSevenDays,
    undatedPostCount,
    openSubmissionCount,
    earningEntryCount: earnings?.entries.length ?? null,
    activity,
    earningSummaries: summarizeEarnings(earnings),
    scripts: library?.scripts ?? [],
    updates: updates?.slice(0, 5) ?? [],
  };
}

export function deriveCreatorNextAction({
  accountNextPath,
  accountStateAvailable,
  libraryAvailable,
  scripts,
}: {
  accountNextPath: string | null | undefined;
  accountStateAvailable: boolean;
  libraryAvailable: boolean;
  scripts: CreatorScript[];
}): CreatorHomeNextAction {
  if (!accountStateAvailable || !accountNextPath) {
    return {
      kind: "unavailable",
      title: "Next action unavailable",
      description: "We cannot determine your next action right now. Refresh this page before continuing.",
      href: null,
      buttonLabel: null,
      dueAt: null,
    };
  }

  const onboardingActions: Record<string, CreatorHomeNextAction> = {
    "/apply": {
      kind: "onboarding",
      title: "Complete your application",
      description: "Finish the saved creator application before the team can review it.",
      href: "/apply",
      buttonLabel: "Continue application",
      dueAt: null,
    },
    "/application/status": {
      kind: "onboarding",
      title: "Application status",
      description: "Your saved application and the creator team’s latest decision are available here.",
      href: "/application/status",
      buttonLabel: "View application status",
      dueAt: null,
    },
    "/onboarding/accounts": {
      kind: "onboarding",
      title: "Verify campaign accounts",
      description: "Continue the ownership checks for the TikTok or Instagram accounts in onboarding.",
      href: "/onboarding/accounts",
      buttonLabel: "Verify campaign accounts",
      dueAt: null,
    },
    "/onboarding/agreement": {
      kind: "onboarding",
      title: "Review your agreement",
      description: "Open the exact agreement record prepared for your account and follow its current state.",
      href: "/onboarding/agreement",
      buttonLabel: "Continue to agreement",
      dueAt: null,
    },
  };

  if (accountNextPath !== "/account") {
    return onboardingActions[accountNextPath] ?? {
      kind: "unavailable",
      title: "Next step pending",
      description: "The creator team is preparing your next step. No action is being inferred.",
      href: null,
      buttonLabel: null,
      dueAt: null,
    };
  }

  if (!libraryAvailable) {
    return {
      kind: "unavailable",
      title: "Task data unavailable",
      description: "We could not verify your current assignments. No task or deadline is being inferred.",
      href: null,
      buttonLabel: null,
      dueAt: null,
    };
  }

  const unfinishedScripts = scripts
    .filter((script) => script.state !== "used")
    .sort((left, right) => {
      const dueDifference = compareOptionalTimestamps(left.dueAt, right.dueAt);
      if (dueDifference) return dueDifference;
      return compareOptionalTimestamps(right.assignedAt, left.assignedAt);
    });
  const script = unfinishedScripts[0];
  if (script) {
    const dueAt = timestampValue(script.dueAt);
    return {
      kind: "script",
      title: script.title,
      description: dueAt
        ? "This is the earliest unfinished script assignment with a recorded due date."
        : "This script is assigned to you. No due date was recorded.",
      href: "/account/scripts",
      buttonLabel: "Open assigned script",
      dueAt,
    };
  }

  return {
    kind: "none",
    title: "No task assigned",
    description: "There is no unfinished script assignment on your account right now.",
    href: null,
    buttonLabel: null,
    dueAt: null,
  };
}

async function getOwnCreatorAccountUpdates(accountId: string, now: Date) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("creator_notifications")
    .select("id, topic, title, scheduled_for")
    .eq("account_id", accountId)
    .is("cancelled_at", null)
    .lte("scheduled_for", now.toISOString())
    .order("scheduled_for", { ascending: false })
    .limit(5);
  if (error) throw new Error("Could not load creator account updates.", { cause: error });
  const updates = normalizeCreatorAccountUpdates(data);
  if (!updates) throw new Error("Creator account updates returned invalid data.");
  return updates;
}

export async function getCreatorHomeOverview(accountId: string, now = new Date()) {
  const [contentResult, earningsResult, libraryResult, updatesResult] = await Promise.allSettled([
    getOwnContentWorkspace(),
    getOwnEarningsWorkspace(),
    getOwnCreatorContentLibrary(),
    getOwnCreatorAccountUpdates(accountId, now),
  ]);

  return buildCreatorHomeOverview({
    content: contentResult.status === "fulfilled" ? contentResult.value : null,
    earnings: earningsResult.status === "fulfilled" ? earningsResult.value : null,
    library: libraryResult.status === "fulfilled" ? libraryResult.value : null,
    updates: updatesResult.status === "fulfilled" ? updatesResult.value : null,
    now,
  });
}
