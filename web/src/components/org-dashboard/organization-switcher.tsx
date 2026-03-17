"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { DashboardIcon } from "./org-icons";

type OrganizationSwitcherItem = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

type OrganizationSwitcherProps = {
  currentOrganizationName: string;
  currentOrganizationSlug: string;
  organizations: OrganizationSwitcherItem[];
  variant?: "header" | "sidebar";
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

function formatRoleLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function OrganizationSwitcher({
  currentOrganizationName,
  currentOrganizationSlug,
  organizations,
  variant = "header",
}: OrganizationSwitcherProps) {
  const manageWorkspacesHref = `/app?manage=workspaces&from=${encodeURIComponent(currentOrganizationSlug)}`;
  const [openRouteKey, setOpenRouteKey] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const organizationCount = organizations.length;
  const workspaceLabel = organizationCount === 1 ? "workspace" : "workspaces";
  const trailingPath = useMemo(() => {
    const segments = pathname.split("/").filter(Boolean);
    return segments[0] === "org" ? segments.slice(2).join("/") : "";
  }, [pathname]);
  const routeQueryString = searchParams.toString();
  const persistedQueryString = useMemo(() => {
    const params = new URLSearchParams(routeQueryString);
    params.delete("notice");
    params.delete("error");
    return params.toString();
  }, [routeQueryString]);
  const routeKey = `${pathname}?${routeQueryString}`;
  const isOpen = openRouteKey === routeKey;
  const orderedOrganizations = useMemo(() => {
    const currentOrganization = organizations.find(
      (organization) => organization.slug === currentOrganizationSlug,
    );
    const otherOrganizations = organizations.filter(
      (organization) => organization.slug !== currentOrganizationSlug,
    );

    return currentOrganization
      ? [currentOrganization, ...otherOrganizations]
      : organizations;
  }, [currentOrganizationSlug, organizations]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpenRouteKey(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenRouteKey(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function getOrganizationHref(organizationSlug: string) {
    const baseHref = trailingPath
      ? `/org/${organizationSlug}/${trailingPath}`
      : `/org/${organizationSlug}`;

    return persistedQueryString
      ? `${baseHref}?${persistedQueryString}`
      : baseHref;
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className={cn(
          "text-left transition",
          variant === "header"
            ? "inline-flex h-10 items-center gap-2.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-3.5 text-left shadow-[0_14px_30px_rgba(0,0,0,0.18)] backdrop-blur hover:border-white/[0.14] hover:bg-white/[0.06]"
            : "flex w-full items-center gap-3.5 rounded-[1.35rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_18px_40px_rgba(0,0,0,0.22)] backdrop-blur hover:border-white/[0.14] hover:bg-white/[0.05]",
        )}
        onClick={() =>
          setOpenRouteKey((current) => (current === routeKey ? null : routeKey))
        }
        type="button"
      >
        {variant === "header" ? (
          <>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[linear-gradient(135deg,rgba(144,255,77,0.9),rgba(19,202,45,0.78))] text-[0.72rem] font-semibold text-black">
              {getInitials(currentOrganizationName)}
            </span>
            <span className="min-w-0">
              <span className="block text-[0.58rem] uppercase tracking-[0.22em] text-muted-foreground">
                Organization
              </span>
              <span className="block max-w-[11rem] truncate text-[0.82rem] font-medium text-foreground">
                {currentOrganizationName}
              </span>
            </span>
            <span className="hidden text-[0.58rem] uppercase tracking-[0.22em] text-muted-foreground xl:inline">
              {organizationCount} {workspaceLabel}
            </span>
          </>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3.5">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-[1rem] bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(144,255,77,0.8))] text-[0.82rem] font-semibold text-black shadow-[0_10px_24px_rgba(144,255,77,0.16)]">
              {getInitials(currentOrganizationName)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.58rem] uppercase tracking-[0.28em] text-muted-foreground/90">
                Organization
              </p>
              <p className="mt-1 truncate text-[1rem] font-medium leading-none tracking-[-0.03em] text-foreground">
                {currentOrganizationName}
              </p>
            </div>
          </div>
        )}

        <DashboardIcon
          className={cn(
            "h-4 w-4 text-muted-foreground transition",
            isOpen ? "rotate-180" : "",
            variant === "sidebar" ? "shrink-0 text-foreground/70" : "",
          )}
          name="chevronDown"
        />
      </button>

      {isOpen ? (
        <div
          className={cn(
            "absolute z-30 mt-2 rounded-[1.15rem] border border-white/[0.08] bg-[#0b0b0d] p-1.5 shadow-[0_28px_80px_rgba(0,0,0,0.48)]",
            variant === "header"
              ? "right-0 w-[20rem]"
              : "left-0 w-full min-w-[18rem]",
          )}
          id={menuId}
          role="menu"
        >
          <div className="rounded-[0.95rem] border border-white/[0.06] bg-black/[0.18] px-3 py-3">
            <p className="text-[0.58rem] uppercase tracking-[0.22em] text-muted-foreground">
              Switch workspace
            </p>
            <p className="mt-1 text-sm text-foreground">
              {organizationCount} {workspaceLabel} available
            </p>
          </div>

          <div className="mt-1.5 max-h-[18rem] space-y-1 overflow-y-auto">
            {orderedOrganizations.map((organization) => {
              const isCurrent =
                organization.slug === currentOrganizationSlug;

              return (
                <Link
                  key={organization.id}
                  aria-current={isCurrent ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-[0.95rem] px-3 py-2.5 text-left transition",
                    isCurrent
                      ? "bg-white/[0.08] text-foreground"
                      : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
                  )}
                  href={getOrganizationHref(organization.slug)}
                  onClick={() => setOpenRouteKey(null)}
                  prefetch={false}
                  role="menuitem"
                >
                  <span
                    className={cn(
                      "inline-flex h-9 w-9 items-center justify-center rounded-[0.82rem] text-[0.8rem] font-semibold",
                      isCurrent
                        ? "bg-[linear-gradient(135deg,rgba(144,255,77,0.96),rgba(19,202,45,0.82))] text-black"
                        : "bg-white/[0.08] text-foreground",
                    )}
                  >
                    {getInitials(organization.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {organization.name}
                    </span>
                    <span className="mt-1 block text-[0.58rem] uppercase tracking-[0.22em] text-muted-foreground">
                      {isCurrent
                        ? "Current workspace"
                        : formatRoleLabel(organization.role)}
                    </span>
                  </span>
                  {isCurrent ? (
                    <DashboardIcon className="h-4 w-4 text-[#90FF4D]" name="check" />
                  ) : null}
                </Link>
              );
            })}
          </div>

          <Link
            className="mt-1.5 flex items-center justify-between rounded-[0.95rem] border border-white/[0.08] bg-white/[0.03] px-3 py-3 text-left transition hover:border-white/[0.14] hover:bg-white/[0.05]"
            href={manageWorkspacesHref}
            onClick={() => setOpenRouteKey(null)}
            prefetch={false}
            role="menuitem"
          >
            <span>
              <span className="block text-sm text-foreground">
                {organizationCount > 1
                  ? "Manage workspaces"
                  : "Create another workspace"}
              </span>
              <span className="mt-1 block text-[0.58rem] uppercase tracking-[0.22em] text-muted-foreground">
                Open workspace hub
              </span>
            </span>
            <DashboardIcon className="h-4 w-4 text-muted-foreground" name="arrowUpRight" />
          </Link>
        </div>
      ) : null}
    </div>
  );
}
