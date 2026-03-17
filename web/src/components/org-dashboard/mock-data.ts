import type { DashboardIconName } from "./org-icons";

export type DashboardSectionKey =
  | "overview"
  | "accounts"
  | "videos"
  | "links"
  | "tracking-options"
  | "creator-hub"
  | "creators"
  | "team"
  | "review"
  | "ai-analytics"
  | "leaderboard"
  | "campaigns"
  | "payouts"
  | "viral-videos"
  | "projects"
  | "integrations"
  | "api"
  | "settings";

export type DashboardNavItem = {
  key: DashboardSectionKey;
  label: string;
  segment: string;
  icon: DashboardIconName;
};

export type DashboardNavGroup = {
  label: string;
  badge?: string;
  items: DashboardNavItem[];
};

export type DashboardRouteMeta = {
  groupLabel: string;
  navLabel: string;
  title: string;
  description: string;
};

export type ToolbarOption = {
  id: string;
  label: string;
  meta?: string;
};

export type MetricCardData = {
  label: string;
  value: string;
  delta: string;
  direction: "up" | "down";
  scope?: string;
  icon: DashboardIconName;
};

export type MetricChartSeries = {
  id: string;
  label: string;
  summary: string;
  axisLabels: string[];
  points: Array<{
    label: string;
    shortLabel: string;
    value: number;
    highlight?: boolean;
  }>;
};

export type EngagementPoint = {
  label: string;
  value: number;
};

export type TopVideoItem = {
  id: string;
  title: string;
  account: string;
  handle: string;
  platform: string;
  views: string;
  engagement: string;
  badge: string;
  campaignId?: string | null;
  thumbnailUrl?: string;
};

export type TopAccountItem = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  views: string;
  growth: string;
  accent: string;
  imageUrl?: string;
  profileUrl?: string;
};

export type OverviewMockData = {
  accountOptions: ToolbarOption[];
  campaignOptions: ToolbarOption[];
  dateRangeOptions: Array<{
    id: string;
    label: string;
  }>;
  metricCards: MetricCardData[];
  metricChartSeries: MetricChartSeries[];
  engagementSeries: {
    summary: string;
    axisLabels: string[];
    points: EngagementPoint[];
  };
  topVideos: TopVideoItem[];
  topAccounts: TopAccountItem[];
};

export type PlaceholderSectionData = {
  eyebrow: string;
  spotlightTitle: string;
  spotlightDescription: string;
  highlights: string[];
  statCards: Array<{
    label: string;
    value: string;
  }>;
  rows: Array<{
    label: string;
    value: string;
    status: string;
  }>;
};

export const dashboardNavGroups: DashboardNavGroup[] = [
  {
    label: "Dashboard",
    items: [
      { key: "overview", label: "Overview", segment: "", icon: "overview" },
      {
        key: "campaigns",
        label: "Campaigns",
        segment: "campaigns",
        icon: "campaigns",
      },
      {
        key: "creators",
        label: "Creators",
        segment: "creators",
        icon: "creators",
      },
      { key: "videos", label: "Videos", segment: "videos", icon: "videos" },
      {
        key: "links",
        label: "Links",
        segment: "links",
        icon: "externalLink",
      },
      {
        key: "team",
        label: "Team",
        segment: "team",
        icon: "creators",
      },
      {
        key: "review",
        label: "Review",
        segment: "review",
        icon: "spotlight",
      },
      {
        key: "ai-analytics",
        label: "AI Analytics",
        segment: "ai-analytics",
        icon: "compare",
      },
      {
        key: "leaderboard",
        label: "Leaderboard",
        segment: "leaderboard",
        icon: "arrowUpRight",
      },
      {
        key: "settings",
        label: "Settings",
        segment: "settings",
        icon: "settings",
      },
    ],
  },
];

export const dashboardRouteMeta: Record<DashboardSectionKey, DashboardRouteMeta> = {
  overview: {
    groupLabel: "Analytics",
    navLabel: "Overview",
    title: "A composed read on accounts, campaigns, and short-form performance.",
    description:
      "Mirror the viral.app operator dashboard while keeping Billion Views' darker, calmer product tone and campaign-first model.",
  },
  accounts: {
    groupLabel: "Analytics",
    navLabel: "Accounts",
    title: "Watch account health, publishing output, and source quality in one surface.",
    description:
      "This section is shaped for multi-account reporting so the later API layer can plug directly into real account performance tables.",
  },
  videos: {
    groupLabel: "Analytics",
    navLabel: "Videos",
    title: "Review recent videos with the same clarity as the headline analytics view.",
    description:
      "The final version will connect campaign filters, creator context, and video-level signal without leaving the dashboard shell.",
  },
  links: {
    groupLabel: "Organization",
    navLabel: "Links",
    title: "Links is in the works.",
    description:
      "This tab is reserved for the future links workspace and is intentionally just a placeholder for now.",
  },
  team: {
    groupLabel: "Organization",
    navLabel: "Team",
    title: "Manage members, roles, and internal access inside a dedicated team workspace.",
    description:
      "This route gives collaboration, ownership, and member-level controls a clear place in the dashboard without adding extra navigation noise.",
  },
  review: {
    groupLabel: "Operations",
    navLabel: "Review",
    title: "Keep approvals, QA checks, and content decisioning in one review surface.",
    description:
      "The page is reserved for internal review workflow so campaigns, videos, and creator output can be approved from a shared operating layer.",
  },
  "ai-analytics": {
    groupLabel: "Analytics",
    navLabel: "AI Analytics",
    title: "Turn raw performance into AI-assisted summaries, pattern detection, and next-step recommendations.",
    description:
      "This placeholder creates room for automated analysis, narrative insights, and anomaly surfacing while keeping the same dashboard shell.",
  },
  leaderboard: {
    groupLabel: "Analytics",
    navLabel: "Leaderboard",
    title: "Rank creators, videos, and campaigns in one shared performance leaderboard.",
    description:
      "The future view can compare momentum, output, and conversion signals across the organization without leaving the workspace.",
  },
  "tracking-options": {
    groupLabel: "Analytics",
    navLabel: "Tracking Options",
    title: "Configure how synced campaign signal gets grouped, filtered, and compared.",
    description:
      "This placeholder keeps the future tracking controls in the same navigation and visual system as the overview experience.",
  },
  "creator-hub": {
    groupLabel: "Creator Hub",
    navLabel: "Overview",
    title: "Move from creator selection to payout progress without breaking campaign context.",
    description:
      "Creator Hub stays campaign-first, matching the PRD while keeping the viral-style density and navigation flow.",
  },
  creators: {
    groupLabel: "Creator Hub",
    navLabel: "Creators",
    title: "Keep creator status, platform presence, and recent signal in a tighter operating layer.",
    description:
      "Later we can connect this to real creator records, filters, and enrichment fields without changing the shell.",
  },
  campaigns: {
    groupLabel: "Creator Hub",
    navLabel: "Campaigns",
    title: "Manage multiple campaigns under one organization from the same top-toolbar frame.",
    description:
      "The toolbar already remaps viral.app's project model into campaign selection so this section is ready for deeper workflow pages.",
  },
  payouts: {
    groupLabel: "Creator Hub",
    navLabel: "Payouts",
    title: "See what is agreed, approved, scheduled, and paid without leaving the shared workspace.",
    description:
      "The UI is set up to accept real payout states and campaign-level spend data once the backend endpoints arrive.",
  },
  "viral-videos": {
    groupLabel: "Library",
    navLabel: "Viral Videos",
    title: "Save the highest-signal short-form examples in a reusable internal library.",
    description:
      "This keeps a dedicated place for reference content while preserving the same dashboard controls and styling language.",
  },
  projects: {
    groupLabel: "Organization",
    navLabel: "Projects",
    title: "Keep org-wide initiatives, internal workstreams, and meta reporting in a separate layer.",
    description:
      "Projects stay available in the sidebar, while campaign selection remains the operator control in the top toolbar.",
  },
  integrations: {
    groupLabel: "Organization",
    navLabel: "Integrations",
    title: "Bring data providers, exports, and destination systems into one quiet control plane.",
    description:
      "The shell is already organized for future sync status, credentials, and environment-level controls.",
  },
  api: {
    groupLabel: "Organization",
    navLabel: "API",
    title: "Expose the same calm dashboard layer to internal tooling and future programmatic access.",
    description:
      "This placeholder keeps an API section in the nav so later docs and tokens can live beside the rest of the workspace.",
  },
  settings: {
    groupLabel: "Organization",
    navLabel: "Settings",
    title: "Adjust organization defaults, workspace behavior, and member-facing preferences.",
    description:
      "Settings inherits the same shell so the product still feels unified when we swap in real forms and controls later.",
  },
};

export function getDashboardHref(
  organizationSlug: string,
  segment: string,
) {
  return segment
    ? `/org/${organizationSlug}/${segment}`
    : `/org/${organizationSlug}`;
}

export function resolveDashboardSectionFromPathname(
  pathname: string,
): DashboardSectionKey {
  const segments = pathname.split("/").filter(Boolean);
  const sectionSegment = segments.slice(2).join("/");

  const flatItems = dashboardNavGroups.flatMap((group) => group.items);
  const match = flatItems.find((item) => item.segment === sectionSegment);

  return match?.key ?? "overview";
}

export function createOverviewMockData({
  organizationName,
  accountOptions = [],
  campaignOptions = [],
}: {
  organizationName: string;
  accountOptions?: ToolbarOption[];
  campaignOptions?: ToolbarOption[];
}): OverviewMockData {
  void organizationName;

  return {
    accountOptions,
    campaignOptions,
    dateRangeOptions: [
      { id: "7d", label: "Last 7 days" },
      { id: "14d", label: "Last 14 days" },
      { id: "30d", label: "Last 30 days" },
      { id: "qtd", label: "Quarter to date" },
    ],
    metricCards: [
      {
        label: "Published Videos",
        value: "412",
        delta: "+29",
        direction: "up",
        scope: "All",
        icon: "videos",
      },
      {
        label: "Active Accounts",
        value: "49",
        delta: "+13",
        direction: "up",
        scope: "All",
        icon: "accounts",
      },
      {
        label: "Views",
        value: "11.7M",
        delta: "+873.4K",
        direction: "up",
        icon: "overview",
      },
      {
        label: "Likes",
        value: "274.6K",
        delta: "-27.2K",
        direction: "down",
        icon: "spotlight",
      },
      {
        label: "App Revenue",
        value: "$52",
        delta: "+$8.99",
        direction: "up",
        icon: "payouts",
      },
      {
        label: "App Installs",
        value: "4",
        delta: "+2",
        direction: "up",
        icon: "campaigns",
      },
    ],
    metricChartSeries: [
      {
        id: "views",
        label: "Views",
        summary: "Volume is clustering around the March 9 release window.",
        axisLabels: ["5M", "3M", "0"],
        points: [
          { label: "Mar 3", shortLabel: "Mar 3", value: 0.6 },
          { label: "Mar 4", shortLabel: "Mar 4", value: 0.8 },
          { label: "Mar 5", shortLabel: "Mar 5", value: 1.1 },
          { label: "Mar 6", shortLabel: "Mar 6", value: 0.7 },
          { label: "Mar 7", shortLabel: "Mar 7", value: 0.6 },
          { label: "Mar 8", shortLabel: "Mar 8", value: 0.6 },
          { label: "Mar 9", shortLabel: "Mar 9", value: 1.3 },
          { label: "Mar 10", shortLabel: "Mar 10", value: 4.0, highlight: true },
          { label: "Mar 11", shortLabel: "Mar 11", value: 0.9 },
          { label: "Mar 12", shortLabel: "Mar 12", value: 0.6 },
          { label: "Mar 13", shortLabel: "Mar 13", value: 0.5 },
          { label: "Mar 14", shortLabel: "Mar 14", value: 0.5 },
          { label: "Mar 15", shortLabel: "Mar 15", value: 0.3 },
        ],
      },
      {
        id: "likes",
        label: "Likes",
        summary: "Engagement depth is still concentrated on two breakout posts.",
        axisLabels: ["150K", "90K", "0"],
        points: [
          { label: "Mar 3", shortLabel: "Mar 3", value: 24 },
          { label: "Mar 4", shortLabel: "Mar 4", value: 31 },
          { label: "Mar 5", shortLabel: "Mar 5", value: 38 },
          { label: "Mar 6", shortLabel: "Mar 6", value: 29 },
          { label: "Mar 7", shortLabel: "Mar 7", value: 24 },
          { label: "Mar 8", shortLabel: "Mar 8", value: 22 },
          { label: "Mar 9", shortLabel: "Mar 9", value: 41 },
          { label: "Mar 10", shortLabel: "Mar 10", value: 132, highlight: true },
          { label: "Mar 11", shortLabel: "Mar 11", value: 36 },
          { label: "Mar 12", shortLabel: "Mar 12", value: 28 },
          { label: "Mar 13", shortLabel: "Mar 13", value: 22 },
          { label: "Mar 14", shortLabel: "Mar 14", value: 19 },
          { label: "Mar 15", shortLabel: "Mar 15", value: 12 },
        ],
      },
      {
        id: "revenue",
        label: "Revenue",
        summary: "Revenue stays modest, but the same campaign burst is visible.",
        axisLabels: ["$80", "$40", "$0"],
        points: [
          { label: "Mar 3", shortLabel: "Mar 3", value: 7 },
          { label: "Mar 4", shortLabel: "Mar 4", value: 11 },
          { label: "Mar 5", shortLabel: "Mar 5", value: 14 },
          { label: "Mar 6", shortLabel: "Mar 6", value: 10 },
          { label: "Mar 7", shortLabel: "Mar 7", value: 8 },
          { label: "Mar 8", shortLabel: "Mar 8", value: 7 },
          { label: "Mar 9", shortLabel: "Mar 9", value: 18 },
          { label: "Mar 10", shortLabel: "Mar 10", value: 56, highlight: true },
          { label: "Mar 11", shortLabel: "Mar 11", value: 13 },
          { label: "Mar 12", shortLabel: "Mar 12", value: 9 },
          { label: "Mar 13", shortLabel: "Mar 13", value: 8 },
          { label: "Mar 14", shortLabel: "Mar 14", value: 6 },
          { label: "Mar 15", shortLabel: "Mar 15", value: 4 },
        ],
      },
    ],
    engagementSeries: {
      summary: "Steady lift after the mid-cycle dip suggests stronger creator fit.",
      axisLabels: ["5%", "3%", "0%"],
      points: [
        { label: "Mar 3", value: 3.8 },
        { label: "Mar 4", value: 2.1 },
        { label: "Mar 5", value: 2.7 },
        { label: "Mar 6", value: 3.2 },
        { label: "Mar 7", value: 3.4 },
        { label: "Mar 8", value: 3.0 },
        { label: "Mar 9", value: 2.2 },
        { label: "Mar 10", value: 3.6 },
        { label: "Mar 11", value: 3.9 },
        { label: "Mar 12", value: 4.0 },
        { label: "Mar 13", value: 4.1 },
        { label: "Mar 14", value: 4.2 },
        { label: "Mar 15", value: 4.3 },
      ],
    },
    topVideos: [
      {
        id: "video-1",
        title: "Growing Tall Tutorial",
        account: "getgotal.app",
        handle: "@gotal.app",
        platform: "TikTok",
        views: "3.4M",
        engagement: "4.8%",
        badge: "UGC",
      },
      {
        id: "video-2",
        title: "Day 67 #weight #heightincrease #growthspurt",
        account: "heightmaster",
        handle: "@heightmaster",
        platform: "TikTok",
        views: "417.6K",
        engagement: "3.9%",
        badge: "How-to",
      },
      {
        id: "video-3",
        title: "How you can add 2-3 inches simply by fixing pelvic tilt",
        account: "dobbingotall",
        handle: "@dobbingotall",
        platform: "YouTube",
        views: "318.7K",
        engagement: "4.1%",
        badge: "Education",
      },
      {
        id: "video-4",
        title: "The posture routine that changed my growth journey",
        account: "kh_power",
        handle: "@kh_power",
        platform: "Instagram",
        views: "261.2K",
        engagement: "5.0%",
        badge: "Lifestyle",
      },
      {
        id: "video-5",
        title: "Three fixes for stronger creator retention this week",
        account: "viralops",
        handle: "@viralops",
        platform: "TikTok",
        views: "198.4K",
        engagement: "3.4%",
        badge: "Operator",
      },
    ],
    topAccounts: [
      {
        id: "account-1",
        name: "kh_power",
        handle: "@2020bek0",
        platform: "TikTok",
        views: "3.4M",
        growth: "+12%",
        accent:
          "linear-gradient(135deg, rgba(144,255,77,0.96), rgba(19,202,45,0.78))",
      },
      {
        id: "account-2",
        name: "gottalash",
        handle: "@gottalash",
        platform: "Instagram",
        views: "1.4M",
        growth: "+6%",
        accent:
          "linear-gradient(135deg, rgba(124,255,176,0.96), rgba(44,198,117,0.78))",
      },
      {
        id: "account-3",
        name: "dobbingotall",
        handle: "@dobbingotall",
        platform: "TikTok",
        views: "1M",
        growth: "+8%",
        accent:
          "linear-gradient(135deg, rgba(121,168,255,0.96), rgba(124,125,255,0.78))",
      },
      {
        id: "account-4",
        name: "getgotal.app",
        handle: "@getgotal.app",
        platform: "YouTube",
        views: "884K",
        growth: "+4%",
        accent:
          "linear-gradient(135deg, rgba(248,201,114,0.96), rgba(239,139,53,0.8))",
      },
      {
        id: "account-5",
        name: "viralstudio",
        handle: "@viralstudio",
        platform: "TikTok",
        views: "512K",
        growth: "-2%",
        accent:
          "linear-gradient(135deg, rgba(255,181,122,0.96), rgba(255,107,90,0.8))",
      },
    ],
  };
}

export const placeholderSectionData: Record<
  Exclude<DashboardSectionKey, "overview">,
  PlaceholderSectionData
> = {
  accounts: {
    eyebrow: "Analytics workspace",
    spotlightTitle: "Account-level health, source syncing, and performance slices will live here.",
    spotlightDescription:
      "This placeholder keeps room for platform filters, sync status, and per-account breakdowns while preserving the same toolbar controls as the overview page.",
    highlights: ["Platform mix", "Account health", "Sync recency"],
    statCards: [
      { label: "Connected accounts", value: "49" },
      { label: "Healthy syncs", value: "46" },
      { label: "Needs review", value: "3" },
    ],
    rows: [
      { label: "TikTok performance layer", value: "Ready for real data", status: "Queued" },
      { label: "Instagram breakdowns", value: "UI scaffolded", status: "Draft" },
      { label: "YouTube Shorts tracking", value: "Awaiting API", status: "Next" },
    ],
  },
  videos: {
    eyebrow: "Analytics workspace",
    spotlightTitle: "Video-level discovery, trend sorting, and campaign grouping will land here.",
    spotlightDescription:
      "The layout is prepared for top videos, content hooks, and platform-specific sorting once the feed is wired to backend data.",
    highlights: ["Recent feed", "Hook summaries", "Campaign match"],
    statCards: [
      { label: "Tracked videos", value: "412" },
      { label: "Top hook clusters", value: "8" },
      { label: "Platforms covered", value: "3" },
    ],
    rows: [
      { label: "Recent content feed", value: "Shell ready", status: "Ready" },
      { label: "Hook tagging", value: "Mocked structure in place", status: "Planned" },
      { label: "Campaign joins", value: "Prepared for API", status: "Queued" },
    ],
  },
  links: {
    eyebrow: "Organization",
    spotlightTitle: "Links is in the works.",
    spotlightDescription:
      "This placeholder simply keeps the new sidebar route active until the real links workspace is built.",
    highlights: ["In progress"],
    statCards: [{ label: "Status", value: "In progress" }],
    rows: [{ label: "Links tab", value: "Coming soon", status: "WIP" }],
  },
  team: {
    eyebrow: "Organization",
    spotlightTitle: "Team access, member roles, and workspace ownership will live here.",
    spotlightDescription:
      "This route is reserved for the internal team layer so invitations, permissions, and collaboration controls can sit in a dedicated place.",
    highlights: ["Members", "Roles", "Invites"],
    statCards: [
      { label: "Members", value: "7" },
      { label: "Admins", value: "2" },
      { label: "Pending invites", value: "3" },
    ],
    rows: [
      { label: "Team roster", value: "Ready for live data", status: "Ready" },
      { label: "Role controls", value: "Planned in shell", status: "Draft" },
      { label: "Invite history", value: "Reserved", status: "Next" },
    ],
  },
  review: {
    eyebrow: "Operations",
    spotlightTitle: "Approvals, QA, and content review workflow will land in this section.",
    spotlightDescription:
      "The page keeps a dedicated home for internal checks so teams can review creators, videos, and deliverables without overloading the analytics views.",
    highlights: ["Approvals", "QA queue", "Feedback state"],
    statCards: [
      { label: "Items in review", value: "24" },
      { label: "Needs changes", value: "6" },
      { label: "Approved today", value: "11" },
    ],
    rows: [
      { label: "Approval queue", value: "Shell ready", status: "Ready" },
      { label: "Feedback threads", value: "Planned", status: "Draft" },
      { label: "Review SLAs", value: "Reserved", status: "Next" },
    ],
  },
  "ai-analytics": {
    eyebrow: "Analytics",
    spotlightTitle: "AI-generated summaries, anomaly alerts, and pattern reads will live here.",
    spotlightDescription:
      "This placeholder keeps room for automated insight generation without changing the surrounding dashboard shell or filters.",
    highlights: ["Narrative insights", "Anomalies", "Recommendations"],
    statCards: [
      { label: "Summaries generated", value: "18" },
      { label: "Signals flagged", value: "9" },
      { label: "Recommendations", value: "14" },
    ],
    rows: [
      { label: "Insight feed", value: "Designed for shell", status: "Ready" },
      { label: "Anomaly detection", value: "Awaiting model wiring", status: "Queued" },
      { label: "Suggested actions", value: "Planned", status: "Draft" },
    ],
  },
  leaderboard: {
    eyebrow: "Analytics",
    spotlightTitle: "A ranked view of top creators, videos, and campaigns will appear here.",
    spotlightDescription:
      "The layout is prepared for score-based comparisons so operators can quickly see who is winning across the workspace.",
    highlights: ["Rankings", "Momentum", "Scorecards"],
    statCards: [
      { label: "Entities ranked", value: "132" },
      { label: "Top movers", value: "17" },
      { label: "Tracked scorecards", value: "42" },
    ],
    rows: [
      { label: "Ranking table", value: "Reserved in UI", status: "Ready" },
      { label: "Score weighting", value: "Planned", status: "Draft" },
      { label: "Compare mode", value: "Queued", status: "Next" },
    ],
  },
  "tracking-options": {
    eyebrow: "Analytics workspace",
    spotlightTitle: "Tracking rules, saved views, and comparison logic will live inside this panel.",
    spotlightDescription:
      "This page gives the future analytics controls a dedicated home without breaking the viral-style navigation pattern.",
    highlights: ["Saved filters", "Timezone logic", "Comparison presets"],
    statCards: [
      { label: "Saved views", value: "6" },
      { label: "Date presets", value: "4" },
      { label: "Export states", value: "2" },
    ],
    rows: [
      { label: "Date range presets", value: "Visible in toolbar", status: "Ready" },
      { label: "UTC handling", value: "UI state only", status: "Draft" },
      { label: "Compare mode", value: "Reserved in controls", status: "Next" },
    ],
  },
  "creator-hub": {
    eyebrow: "Creator Hub",
    spotlightTitle: "Creator operations overview will anchor campaign workflow here.",
    spotlightDescription:
      "This section is reserved for the operator view that joins creators, deliverables, approvals, and payouts under a single campaign-first model.",
    highlights: ["Status pipeline", "Deliverables", "Approvals"],
    statCards: [
      { label: "Live creators", value: "18" },
      { label: "Active campaigns", value: "3" },
      { label: "Open approvals", value: "7" },
    ],
    rows: [
      { label: "Creator pipeline", value: "Ready for real states", status: "Ready" },
      { label: "Campaign join tables", value: "Modeled in schema", status: "Live" },
      { label: "Team workflow layer", value: "UI stubbed", status: "Next" },
    ],
  },
  creators: {
    eyebrow: "Creator Hub",
    spotlightTitle: "Creators will get a denser internal roster tuned for campaign decisions.",
    spotlightDescription:
      "The shell is ready for filters, niche tags, regional fields, and per-creator performance rows that map to the existing schema.",
    highlights: ["Creator roster", "Internal status", "Platform accounts"],
    statCards: [
      { label: "Creators tracked", value: "112" },
      { label: "Qualified", value: "47" },
      { label: "Need review", value: "19" },
    ],
    rows: [
      { label: "Creator filters", value: "Schema-aligned", status: "Ready" },
      { label: "Profile links", value: "Placeholder state", status: "Draft" },
      { label: "Campaign assignment", value: "Prepared for CRUD", status: "Next" },
    ],
  },
  campaigns: {
    eyebrow: "Creator Hub",
    spotlightTitle: "Campaign management is now the top-toolbar control inside each organization.",
    spotlightDescription:
      "This placeholder sets up campaign-specific workflow pages while the shared toolbar already supports multi-campaign selection in the viral-style frame.",
    highlights: ["Multi-campaign select", "Owners", "Delivery state"],
    statCards: [
      { label: "Campaigns", value: "9" },
      { label: "Active now", value: "3" },
      { label: "Scheduled", value: "2" },
    ],
    rows: [
      { label: "Toolbar remap", value: "Projects -> Campaigns", status: "Live" },
      { label: "Campaign summaries", value: "Mocked for UI", status: "Ready" },
      { label: "Campaign CRUD", value: "API later", status: "Queued" },
    ],
  },
  payouts: {
    eyebrow: "Creator Hub",
    spotlightTitle: "Payout tracking will follow the same calm card system as the analytics overview.",
    spotlightDescription:
      "The future page can slot in agreed rates, approvals, payout states, and spend totals without changing the surrounding shell.",
    highlights: ["Agreed rates", "Paid state", "Spend rollups"],
    statCards: [
      { label: "Pending", value: "$7.2K" },
      { label: "Paid", value: "$20.8K" },
      { label: "Scheduled", value: "$3.4K" },
    ],
    rows: [
      { label: "Spend summaries", value: "Designed", status: "Ready" },
      { label: "Approval statuses", value: "Waiting for API", status: "Queued" },
      { label: "Payment history", value: "Reserved", status: "Next" },
    ],
  },
  "viral-videos": {
    eyebrow: "Library",
    spotlightTitle: "A saved bank of breakout content will sit here for creative benchmarking.",
    spotlightDescription:
      "This gives the product a separate library surface while keeping the same dark premium shell and operator controls.",
    highlights: ["Saved references", "Hook library", "Format tags"],
    statCards: [
      { label: "Saved examples", value: "128" },
      { label: "Hook clusters", value: "14" },
      { label: "Reusable formats", value: "23" },
    ],
    rows: [
      { label: "Bookmarking flow", value: "Planned in shell", status: "Draft" },
      { label: "Creative tags", value: "Ready for schema", status: "Queued" },
      { label: "Cross-campaign reference", value: "Reserved", status: "Next" },
    ],
  },
  projects: {
    eyebrow: "Organization",
    spotlightTitle: "Projects remain a separate org-level layer without replacing campaign controls.",
    spotlightDescription:
      "This preserves the viral.app information architecture while respecting Billion Views' campaign-first product model.",
    highlights: ["Org initiatives", "Internal streams", "Meta reporting"],
    statCards: [
      { label: "Projects", value: "5" },
      { label: "Cross-team", value: "3" },
      { label: "Archived", value: "2" },
    ],
    rows: [
      { label: "Campaign distinction", value: "Maintained in toolbar", status: "Live" },
      { label: "Org-wide views", value: "Stubbed", status: "Ready" },
      { label: "Internal reporting", value: "Next layer", status: "Queued" },
    ],
  },
  integrations: {
    eyebrow: "Organization",
    spotlightTitle: "Integrations will handle data providers, exports, and internal tooling connections.",
    spotlightDescription:
      "This placeholder keeps a clear location for sync health and provider settings once the backend work starts.",
    highlights: ["Provider sync", "Destinations", "Environment state"],
    statCards: [
      { label: "Connections", value: "4" },
      { label: "Healthy", value: "3" },
      { label: "Needs config", value: "1" },
    ],
    rows: [
      { label: "Provider status", value: "Reserved in UI", status: "Ready" },
      { label: "Export targets", value: "Planned", status: "Draft" },
      { label: "Credential forms", value: "Later", status: "Queued" },
    ],
  },
  api: {
    eyebrow: "Organization",
    spotlightTitle: "API docs, tokens, and internal automation hooks will slot into this route.",
    spotlightDescription:
      "The shell already matches the rest of the workspace, so programmatic access can be added without a separate product feel.",
    highlights: ["Tokens", "Docs", "Internal use"],
    statCards: [
      { label: "Endpoints planned", value: "12" },
      { label: "Scopes", value: "4" },
      { label: "Examples", value: "6" },
    ],
    rows: [
      { label: "API surface", value: "Reserved in nav", status: "Ready" },
      { label: "Auth tokens", value: "Future", status: "Queued" },
      { label: "Code examples", value: "Planned", status: "Draft" },
    ],
  },
  settings: {
    eyebrow: "Organization",
    spotlightTitle: "Workspace-level defaults and member-facing controls will live here.",
    spotlightDescription:
      "This preserves a dedicated place for organization settings while the rest of the dashboard stays focused on analytics and operations.",
    highlights: ["Members", "Defaults", "Preferences"],
    statCards: [
      { label: "Members", value: "7" },
      { label: "Roles", value: "3" },
      { label: "Defaults set", value: "8" },
    ],
    rows: [
      { label: "Role management", value: "Design ready", status: "Ready" },
      { label: "Workspace defaults", value: "Placeholder", status: "Draft" },
      { label: "Notifications", value: "Later", status: "Queued" },
    ],
  },
};
