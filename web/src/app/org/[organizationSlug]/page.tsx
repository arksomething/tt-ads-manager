import { OverviewClient } from "@/components/org-dashboard/overview-client";
import { getOrganizationOverviewData } from "@/server/dashboard/overview";

type OrganizationPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

export default async function OrganizationPage({
  params,
  searchParams,
}: OrganizationPageProps) {
  const { organizationSlug } = await params;
  const overviewData = await getOrganizationOverviewData({
    organizationSlug,
    searchParams: await searchParams,
  });

  return (
    <OverviewClient
      data={overviewData}
      organizationSlug={organizationSlug}
    />
  );
}
