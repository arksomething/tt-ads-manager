import { headers } from "next/headers";
import { redirect } from "next/navigation";

import type { DashboardSearchParams } from "@/server/dashboard/filters";
import {
  buildCreatorPortalLinkPath,
  createCreatorPortalAccessForOrganization,
  getCreatorPortalLinksWorkspace,
  revokeCreatorPortalAccessForOrganization,
  rotateCreatorPortalAccessForOrganization,
} from "@/server/creator-portal/access";

import { CopyLinkButton } from "./copy-link-button";

export const dynamic = "force-dynamic";

type OrganizationLinksPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<DashboardSearchParams>;
};

type CreatorPortalAccessRow = {
  id: string;
  linkPath: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type CampaignCreatorLinkRow = {
  id: string;
  createdAt: Date;
  creatorId: string;
  campaign: {
    id: string;
    name: string;
  };
  creator: {
    id: string;
    displayName: string;
    platformAccounts: Array<{
      handle: string;
    }>;
  };
  portalAccesses: CreatorPortalAccessRow[];
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function getSearchParamValue(searchParams: DashboardSearchParams, key: string) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function getRequestOrigin(headerStore: Headers) {
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const proto =
    headerStore.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "development" ? "http" : "https");

  return host ? `${proto}://${host}` : "";
}

function formatDate(value: Date) {
  return dateFormatter.format(value);
}

function buildLinksHref(
  organizationSlug: string,
  params: Record<string, string | null | undefined>,
) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      searchParams.set(key, value);
    }
  }

  const query = searchParams.toString();
  return query
    ? `/org/${organizationSlug}/links?${query}`
    : `/org/${organizationSlug}/links`;
}

function getNoticeLabel(value: string | undefined) {
  switch (value) {
    case "link-created":
      return "Creator link generated.";
    case "link-rotated":
      return "Creator link rotated.";
    case "link-revoked":
      return "Creator link revoked.";
    default:
      return null;
  }
}

function getHandleLabel(platformAccounts: Array<{ handle: string }>) {
  return platformAccounts.length > 0
    ? platformAccounts.map((account) => `@${account.handle.replace(/^@/, "")}`).join(", ")
    : "No tracked handle";
}

function getActionErrorMessage(error: unknown) {
  const digest =
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string"
      ? (error as { digest: string }).digest
      : null;

  if (digest?.startsWith("NEXT_REDIRECT")) {
    throw error;
  }

  return error instanceof Error ? error.message : "Something went wrong.";
}

export default async function OrganizationLinksPage({
  params,
  searchParams,
}: OrganizationLinksPageProps) {
  const { organizationSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const workspace = await getCreatorPortalLinksWorkspace(organizationSlug);
  const headerStore = await headers();
  const origin = getRequestOrigin(headerStore);
  const generatedToken = getSearchParamValue(resolvedSearchParams, "token");
  const notice = getNoticeLabel(getSearchParamValue(resolvedSearchParams, "notice"));
  const error = getSearchParamValue(resolvedSearchParams, "error");
  const generatedLink = generatedToken
    ? `${origin}${buildCreatorPortalLinkPath(generatedToken)}`
    : null;
  const campaignCreators =
    workspace.campaignCreators as CampaignCreatorLinkRow[];
  const accessRows = campaignCreators.flatMap((campaignCreator) =>
    campaignCreator.portalAccesses.map((access) => ({
      ...access,
      campaignCreator,
    })),
  );

  async function createLink(formData: FormData) {
    "use server";

    const campaignCreatorId = formData.get("campaignCreatorId");

    try {
      if (typeof campaignCreatorId !== "string" || !campaignCreatorId) {
        throw new Error("Choose a creator.");
      }

      const result = await createCreatorPortalAccessForOrganization({
        organizationSlug,
        campaignCreatorId,
      });

      redirect(
        buildLinksHref(organizationSlug, {
          notice: "link-created",
          token: result.linkToken,
        }),
      );
    } catch (createError) {
      redirect(
        buildLinksHref(organizationSlug, {
          error: getActionErrorMessage(createError),
        }),
      );
    }
  }

  async function rotateLink(formData: FormData) {
    "use server";

    const accessId = formData.get("accessId");

    try {
      if (typeof accessId !== "string" || !accessId) {
        throw new Error("Choose a creator link.");
      }

      const result = await rotateCreatorPortalAccessForOrganization({
        organizationSlug,
        accessId,
      });

      redirect(
        buildLinksHref(organizationSlug, {
          notice: "link-rotated",
          token: result.linkToken,
        }),
      );
    } catch (rotateError) {
      redirect(
        buildLinksHref(organizationSlug, {
          error: getActionErrorMessage(rotateError),
        }),
      );
    }
  }

  async function revokeLink(formData: FormData) {
    "use server";

    const accessId = formData.get("accessId");

    try {
      if (typeof accessId !== "string" || !accessId) {
        throw new Error("Choose a creator link.");
      }

      await revokeCreatorPortalAccessForOrganization({
        organizationSlug,
        accessId,
      });

      redirect(
        buildLinksHref(organizationSlug, {
          notice: "link-revoked",
        }),
      );
    } catch (revokeError) {
      redirect(
        buildLinksHref(organizationSlug, {
          error: getActionErrorMessage(revokeError),
        }),
      );
    }
  }

  return (
    <div className="space-y-5">
      {notice ? (
        <section className="rounded-[1.1rem] border border-[#90FF4D]/20 bg-[#90FF4D]/[0.08] px-4 py-3 text-sm text-[#D7FFBC]">
          {notice}
        </section>
      ) : null}

      {error ? (
        <section className="rounded-[1.1rem] border border-[#FF7E54]/20 bg-[#FF7E54]/[0.08] px-4 py-3 text-sm text-[#FFD3C5]">
          {error}
        </section>
      ) : null}

      {generatedLink ? (
        <section className="rounded-[1.35rem] border border-[#90FF4D]/20 bg-[#90FF4D]/[0.07] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)]">
          <p className="text-xs uppercase tracking-[0.18em] text-[#B8FF86]">
            New creator access
          </p>
          <label className="mt-4 block">
            <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              Private link
            </span>
            <input
              className="mt-2 w-full rounded-[0.9rem] border border-white/[0.1] bg-black/30 px-3 py-2 font-mono text-sm text-foreground"
              readOnly
              value={generatedLink}
            />
            <CopyLinkButton
              className="mt-3 rounded-[0.85rem] border border-[#90FF4D]/24 bg-[#90FF4D]/12 px-3 py-2 text-sm font-medium text-[#D9FFC7] transition hover:border-[#90FF4D]/36 hover:bg-[#90FF4D]/16"
              link={generatedLink}
            />
          </label>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="rounded-[1.45rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)]">
          <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
            Creator Portal
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-foreground">
            Creator links
          </h1>
          <form action={createLink} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Creator
              </span>
              <select
                className="mt-2 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/25 px-3 py-3 text-sm text-foreground"
                name="campaignCreatorId"
                required
              >
                <option value="">Select creator</option>
                {campaignCreators.map((campaignCreator) => (
                  <option key={campaignCreator.id} value={campaignCreator.id}>
                    {campaignCreator.creator.displayName} - {campaignCreator.campaign.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="rounded-[0.95rem] bg-[#90FF4D] px-4 py-3 text-sm font-semibold text-black transition hover:bg-[#B8FF86]"
              type="submit"
            >
              Generate link
            </button>
          </form>
        </div>

        <div className="rounded-[1.45rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)]">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Creator entry
          </p>
          <p className="mt-2 rounded-[0.95rem] border border-white/[0.08] bg-black/25 px-3 py-3 font-mono text-sm text-foreground">
            {origin}/creator/link/...
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[1rem] border border-white/[0.08] bg-black/20 p-4">
              <p className="text-2xl font-semibold">{campaignCreators.length}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Creator slots
              </p>
            </div>
            <div className="rounded-[1rem] border border-white/[0.08] bg-black/20 p-4">
              <p className="text-2xl font-semibold">
                {accessRows.filter((row) => !row.revokedAt).length}
              </p>
              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Active
              </p>
            </div>
            <div className="rounded-[1rem] border border-white/[0.08] bg-black/20 p-4">
              <p className="text-2xl font-semibold">{accessRows.length}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                Total
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[1.45rem] border border-white/[0.08] bg-[#0D0E11] shadow-[0_24px_70px_rgba(0,0,0,0.24)]">
        <div className="border-b border-white/[0.08] px-5 py-4">
          <h2 className="text-lg font-semibold tracking-[-0.03em]">
            Access list
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-white/[0.08] text-left text-sm">
            <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Creator</th>
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Access</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {accessRows.map((access) => (
                <tr key={access.id}>
                  {(() => {
                    const portalLink =
                      access.linkPath && !access.revokedAt
                        ? `${origin}${access.linkPath}`
                        : null;

                    return (
                      <>
                  <td className="px-4 py-4">
                    <p className="font-medium text-foreground">
                      {access.campaignCreator.creator.displayName}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {getHandleLabel(access.campaignCreator.creator.platformAccounts)}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-muted-foreground">
                    {access.campaignCreator.campaign.name}
                  </td>
                  <td className="px-4 py-4 text-muted-foreground">
                    {portalLink ? (
                      <p className="max-w-[18rem] truncate font-mono text-xs text-foreground">
                        {portalLink}
                      </p>
                    ) : access.revokedAt ? (
                      "Revoked"
                    ) : (
                      "Rotate to make copyable"
                    )}
                  </td>
                  <td className="px-4 py-4 text-muted-foreground">
                    {formatDate(access.createdAt)}
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs ${
                        access.revokedAt
                          ? "border-white/[0.08] bg-white/[0.03] text-muted-foreground"
                          : "border-[#90FF4D]/25 bg-[#90FF4D]/10 text-[#B8FF86]"
                      }`}
                    >
                      {access.revokedAt ? "Revoked" : "Active"}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex justify-end gap-2">
                      {portalLink ? <CopyLinkButton link={portalLink} /> : null}
                      <form action={rotateLink}>
                        <input name="accessId" type="hidden" value={access.id} />
                        <button
                          className="rounded-[0.8rem] border border-white/[0.1] px-3 py-2 text-xs text-foreground transition hover:border-white/[0.18] hover:bg-white/[0.05]"
                          type="submit"
                        >
                          Rotate
                        </button>
                      </form>
                      {!access.revokedAt ? (
                        <form action={revokeLink}>
                          <input name="accessId" type="hidden" value={access.id} />
                          <button
                            className="rounded-[0.8rem] border border-[#FF7E54]/20 px-3 py-2 text-xs text-[#FFD3C5] transition hover:bg-[#FF7E54]/[0.08]"
                            type="submit"
                          >
                            Revoke
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                      </>
                    );
                  })()}
                </tr>
              ))}
              {accessRows.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-10 text-center text-sm text-muted-foreground"
                    colSpan={6}
                  >
                    No creator links have been generated yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
