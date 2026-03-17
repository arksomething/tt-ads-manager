import { LeaderboardPageClient } from "@/components/org-dashboard/leaderboard-page-client";
import type { DashboardSearchParams } from "@/server/dashboard/filters";
import { getOrganizationLeaderboardData } from "@/server/dashboard/leaderboard";

export const dynamic = "force-dynamic";

type LeaderboardPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<DashboardSearchParams>;
};

export default async function LeaderboardPage({
  params,
  searchParams,
}: LeaderboardPageProps) {
  const { organizationSlug } = await params;
  const data = await getOrganizationLeaderboardData({
    organizationSlug,
    searchParams: await searchParams,
  });

  return <LeaderboardPageClient data={data} />;
}
