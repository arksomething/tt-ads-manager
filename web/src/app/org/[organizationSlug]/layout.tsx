import type { ReactNode } from "react";

import { OrgDashboardShell } from "@/components/org-dashboard/org-dashboard-shell";
import { getOrganizationDashboardLayoutData } from "@/server/dashboard/org-shell";

export const dynamic = "force-dynamic";

type OrganizationLayoutProps = {
  children: ReactNode;
  params: Promise<{
    organizationSlug: string;
  }>;
};

export default async function OrganizationLayout({
  children,
  params,
}: OrganizationLayoutProps) {
  const { organizationSlug } = await params;
  const layoutData = await getOrganizationDashboardLayoutData(organizationSlug);

  return (
    <OrgDashboardShell
      organizationName={layoutData.membership.organization.name}
      organizationSlug={organizationSlug}
      organizations={layoutData.organizations}
      userEmail={layoutData.user.email}
      userName={layoutData.user.name}
    >
      {children}
    </OrgDashboardShell>
  );
}
