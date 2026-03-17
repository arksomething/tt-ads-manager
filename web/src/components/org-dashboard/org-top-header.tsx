"use client";

import { usePathname } from "next/navigation";

import {
  dashboardRouteMeta,
  resolveDashboardSectionFromPathname,
} from "./mock-data";
import { DashboardIcon } from "./org-icons";
import { OrganizationSwitcher } from "./organization-switcher";

type OrgTopHeaderProps = {
  organizationSlug: string;
  organizationName: string;
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
  }>;
  signedInAs: string;
};

export function OrgTopHeader({
  organizationSlug,
  organizationName,
  organizations,
  signedInAs,
}: OrgTopHeaderProps) {
  const pathname = usePathname();
  const sectionKey = resolveDashboardSectionFromPathname(pathname);
  const meta = dashboardRouteMeta[sectionKey];

  return (
    <header className="border-b border-white/[0.07] px-3 py-3 sm:px-4 lg:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5">
            <DashboardIcon className="h-3.5 w-3.5" name="layout" />
            {meta.groupLabel}
          </span>
          <DashboardIcon className="h-3.5 w-3.5 opacity-50" name="chevronRight" />
          <span className="max-w-full truncate text-foreground/82" title={meta.title}>
            {meta.navLabel}
          </span>
        </div>

        <div className="flex items-center gap-3 sm:justify-end">
          <p className="hidden max-w-[18rem] truncate text-[0.72rem] text-muted-foreground lg:block">
            {signedInAs}
          </p>

          <OrganizationSwitcher
            currentOrganizationName={organizationName}
            currentOrganizationSlug={organizationSlug}
            organizations={organizations}
          />
        </div>
      </div>
    </header>
  );
}
