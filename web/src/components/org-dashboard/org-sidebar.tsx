"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import {
  getDashboardNavGroupsForRole,
  getDashboardHref,
  resolveDashboardSectionFromPathname,
} from "./mock-data";
import { DashboardIcon } from "./org-icons";
import { OrganizationSwitcher } from "./organization-switcher";

type OrgSidebarProps = {
  changeAccountAction: () => Promise<void>;
  organizationSlug: string;
  organizationName: string;
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
  }>;
  userName?: string | null;
  userEmail?: string | null;
  viewerRole: string;
  signOutAction: () => Promise<void>;
};

function getInitials(value: string) {
  const parts = value.split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "BV";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function OrgSidebar({
  changeAccountAction,
  organizationSlug,
  organizationName,
  organizations,
  userName,
  userEmail,
  viewerRole,
  signOutAction,
}: OrgSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeSection = resolveDashboardSectionFromPathname(pathname);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountMenuId = useId();
  const viewerLabel = userName ?? userEmail ?? "Operator";
  const navGroups = getDashboardNavGroupsForRole(viewerRole);
  const persistedQueryString = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("notice");
    params.delete("error");
    return params.toString();
  }, [searchParams]);

  function withCurrentSearch(href: string) {
    return persistedQueryString ? `${href}?${persistedQueryString}` : href;
  }

  useEffect(() => {
    if (!isAccountMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsAccountMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAccountMenuOpen]);

  return (
    <aside className="relative z-30 w-full lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:w-[248px] lg:shrink-0">
      <div className="flex h-full flex-col rounded-[1.85rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(12,12,15,0.94),rgba(6,6,8,0.96))] p-3.5 shadow-[0_22px_70px_rgba(0,0,0,0.3)] backdrop-blur xl:p-4">
        <OrganizationSwitcher
          currentOrganizationName={organizationName}
          currentOrganizationSlug={organizationSlug}
          organizations={organizations}
          variant="sidebar"
        />

        <nav className="mt-5 flex-1">
          <div className="space-y-5">
            {navGroups.map((group) => (
              <div key={group.label}>
                <div className="mb-2 flex items-center gap-2 px-1">
                  <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
                    {group.label}
                  </p>
                  {group.badge ? (
                    <span className="rounded-full border border-[#90FF4D]/25 bg-[#90FF4D]/10 px-2 py-0.5 text-[0.58rem] uppercase tracking-[0.2em] text-[#B8FF86]">
                      {group.badge}
                    </span>
                  ) : null}
                </div>

                <div className="space-y-1">
                  {group.items.map((item) => {
                    const isActive = item.key === activeSection;

                    return (
                      <Link
                        key={item.key}
                        className={`flex items-center gap-3 rounded-[0.95rem] border px-3 py-2.5 text-[0.92rem] transition ${
                          isActive
                            ? "border-white/[0.12] bg-white/[0.08] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                            : "border-transparent bg-transparent text-muted-foreground hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-foreground/92"
                        }`}
                        href={withCurrentSearch(
                          getDashboardHref(organizationSlug, item.segment),
                        )}
                        prefetch={false}
                      >
                        <DashboardIcon
                          className={`h-4 w-4 ${
                            isActive ? "text-foreground" : "text-muted-foreground"
                          }`}
                          name={item.icon}
                        />
                        <span className="flex-1">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <div className="mt-5 border-t border-white/[0.07] pt-4">
          <div className="relative" ref={accountMenuRef}>
            {isAccountMenuOpen ? (
              <div
                className="absolute bottom-full left-0 right-0 z-20 mb-2 rounded-[1.2rem] border border-white/[0.08] bg-[#0b0b0d] p-1.5 shadow-[0_28px_80px_rgba(0,0,0,0.48)]"
                id={accountMenuId}
                role="menu"
              >
                <div className="rounded-[0.95rem] border border-white/[0.06] bg-black/[0.18] px-3 py-3">
                  <p className="text-[0.58rem] uppercase tracking-[0.22em] text-muted-foreground">
                    Account
                  </p>
                  <p className="mt-1 truncate text-sm text-foreground">{viewerLabel}</p>
                  {userEmail ? (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {userEmail}
                    </p>
                  ) : null}
                </div>

                <form action={changeAccountAction} className="mt-1.5">
                  <button
                    className="flex w-full flex-col items-start rounded-[0.9rem] px-3 py-2.5 text-left transition hover:bg-white/[0.05]"
                    role="menuitem"
                    type="submit"
                  >
                    <span className="text-sm text-foreground">Change account</span>
                    <span className="mt-0.5 text-xs text-muted-foreground">
                      Use a different sign-in
                    </span>
                  </button>
                </form>

                <form action={signOutAction} className="mt-1">
                  <button
                    className="flex w-full flex-col items-start rounded-[0.9rem] px-3 py-2.5 text-left transition hover:bg-white/[0.05]"
                    role="menuitem"
                    type="submit"
                  >
                    <span className="text-sm text-foreground">Sign out</span>
                    <span className="mt-0.5 text-xs text-muted-foreground">
                      End this session
                    </span>
                  </button>
                </form>
              </div>
            ) : null}

            <button
              aria-controls={accountMenuId}
              aria-expanded={isAccountMenuOpen}
              aria-haspopup="menu"
              className={`flex w-full items-center gap-3 rounded-[1.2rem] border px-3.5 py-3.5 text-left transition ${
                isAccountMenuOpen
                  ? "border-white/[0.14] bg-white/[0.05]"
                  : "border-white/[0.08] bg-black/[0.24] hover:border-white/[0.14] hover:bg-white/[0.04]"
              }`}
              onClick={() => setIsAccountMenuOpen((current) => !current)}
              type="button"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] text-[0.82rem] font-semibold text-foreground">
                {getInitials(viewerLabel)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.92rem] font-medium text-foreground">
                  {viewerLabel}
                </p>
                {userEmail ? (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {userEmail}
                  </p>
                ) : null}
              </div>
              <DashboardIcon
                className={`h-4 w-4 transition ${
                  isAccountMenuOpen ? "rotate-180 text-foreground/82" : "text-muted-foreground"
                }`}
                name="chevronDown"
              />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
