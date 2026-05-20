import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { OrgDashboardShell } from "@/components/org-dashboard/org-dashboard-shell";
import {
  canAccessDashboardSection,
  getDefaultDashboardHrefForRole,
  resolveDashboardSectionFromPathname,
} from "@/components/org-dashboard/mock-data";
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
  const requestHeaders = await headers();
  const pathname = requestHeaders.get("x-current-pathname");
  const activeSection = pathname
    ? resolveDashboardSectionFromPathname(pathname)
    : null;

  if (
    activeSection &&
    !canAccessDashboardSection(layoutData.membership.role, activeSection)
  ) {
    redirect(
      getDefaultDashboardHrefForRole(
        organizationSlug,
        layoutData.membership.role,
      ),
    );
  }

  return (
    <OrgDashboardShell
      organizationName={layoutData.membership.organization.name}
      organizationSlug={organizationSlug}
      organizations={layoutData.organizations}
      userEmail={layoutData.user.email}
      userName={layoutData.user.name}
      viewerRole={layoutData.membership.role}
    >
      {children}
    </OrgDashboardShell>
  );
}
