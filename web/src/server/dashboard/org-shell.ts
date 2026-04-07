import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { isGoogleAuthDisabled } from "@/lib/server-env";
import {
  getViewerOrganizations,
} from "@/server/auth/organizations";
import { getCurrentUser } from "@/server/auth/session";
import { getAccessibleCampaignOptionsForMembership } from "@/server/campaigns/queries";

export const getOrganizationDashboardLayoutData = cache(
  async (organizationSlug: string) => {
    const user = await getCurrentUser();
    const publicAccessEnabled = isGoogleAuthDisabled();

    if (!user?.id && !publicAccessEnabled) {
      redirect("/login");
    }

    const organizations = await getViewerOrganizations();
    const membership = organizations.find(
      ({ organization }) => organization.slug === organizationSlug,
    );

    if (!membership) {
      notFound();
    }

    return {
      user: user ?? {
        id: "public-access",
        name: "Public access",
        email: null,
        image: null,
      },
      membership,
      organizations: organizations.map(({ organization, role }) => ({
        id: organization.id,
        name: organization.displayName,
        slug: organization.slug,
        role,
      })),
    };
  },
);

export const getOrganizationDashboardShellData = cache(
  async (organizationSlug: string) => {
    const layoutData = await getOrganizationDashboardLayoutData(organizationSlug);
    const campaigns = await getAccessibleCampaignOptionsForMembership(
      layoutData.membership,
    );

    return {
      ...layoutData,
      campaigns,
      accountOptions: [],
    };
  },
);
