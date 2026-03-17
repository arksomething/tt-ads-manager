import { OrgDashboardShell } from "@/components/org-dashboard/org-dashboard-shell";
import { getOrganizationDashboardLayoutData } from "@/server/dashboard/org-shell";

export const dynamic = "force-dynamic";

export default async function OrganizationLayout({
  children,
  params,
}: LayoutProps<"/org/[organizationSlug]">) {
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
