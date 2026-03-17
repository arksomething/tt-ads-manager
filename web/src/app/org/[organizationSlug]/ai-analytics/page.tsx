import { AiAnalyticsClient } from "@/components/org-dashboard/ai-analytics-client";
import { getAiAnalyticsPageData } from "@/server/ai-analytics/workspace";

export const dynamic = "force-dynamic";

type AiAnalyticsPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
};

export default async function AiAnalyticsPage({
  params,
}: AiAnalyticsPageProps) {
  const { organizationSlug } = await params;
  const data = await getAiAnalyticsPageData(organizationSlug);

  return <AiAnalyticsClient data={data} />;
}
