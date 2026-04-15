import Link from "next/link";
import { MessagingChannel } from "@prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { type DashboardSearchParams } from "@/server/dashboard/filters";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { canManageOrganization } from "@/server/auth/roles";
import {
  sendTwilioTestMessageForOrganization,
  upsertOrganizationTikTokAccountForOrganization,
  upsertOrganizationTwilioConfigForOrganization,
} from "@/server/messaging/mutations";
import { getOrganizationMessagingWorkspace } from "@/server/messaging/queries";
import {
  getTikTokOauthCookieOptions,
  getTikTokOauthPendingSelectionCookieName,
  readPendingAdvertiserSelectionCookieValue,
  saveTikTokOauthPendingAdvertiserSelection,
} from "@/server/tiktok-business/oauth";

export const dynamic = "force-dynamic";

type IntegrationsPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<DashboardSearchParams>;
};

function getSearchParamValue(
  searchParams: DashboardSearchParams,
  key: string,
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function getTrimmedFormValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getScopeInputValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean)
      .join(",");
  }

  return "";
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

function buildIntegrationsHref(args: {
  organizationSlug: string;
  notice?: string | null;
  error?: string | null;
}) {
  const nextSearchParams = new URLSearchParams();

  if (args.notice) {
    nextSearchParams.set("notice", args.notice);
  }

  if (args.error) {
    nextSearchParams.set("error", args.error);
  }

  const query = nextSearchParams.toString();
  const baseHref = `/org/${args.organizationSlug}/integrations`;
  return query ? `${baseHref}?${query}` : baseHref;
}

function getNoticeLabel(value: string | undefined) {
  switch (value) {
    case "twilio-saved":
      return "Twilio settings saved.";
    case "tiktok-saved":
      return "TikTok advertiser settings saved.";
    case "tiktok-oauth-connected":
      return "TikTok advertiser account connected.";
    case "tiktok-select-advertiser":
      return "Choose which TikTok advertiser account to save for this organization.";
    case "test-sent":
      return "Test message sent.";
    default:
      return undefined;
  }
}

function getErrorLabel(value: string | undefined) {
  if (!value) {
    return value;
  }

  return value.startsWith("NEXT_REDIRECT") ? undefined : value;
}

export default async function IntegrationsPage({
  params,
  searchParams,
}: IntegrationsPageProps) {
  const { organizationSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const workspace = await getOrganizationMessagingWorkspace(organizationSlug);
  const cookieStore = await cookies();
  const pendingSelection = readPendingAdvertiserSelectionCookieValue(
    cookieStore.get(getTikTokOauthPendingSelectionCookieName())?.value,
  );
  const notice = getNoticeLabel(getSearchParamValue(resolvedSearchParams, "notice"));
  const error = getErrorLabel(getSearchParamValue(resolvedSearchParams, "error"));
  const primaryTikTokAccount = workspace.tiktokAccounts[0] ?? null;
  const connectTikTokHref = `/api/org/${organizationSlug}/integrations/tiktok/oauth/start`;
  const paidViewsHref = `/org/${organizationSlug}/tiktok-paid-views`;

  async function saveTwilioConfigAction(formData: FormData) {
    "use server";

    try {
      await upsertOrganizationTwilioConfigForOrganization({
        organizationSlug,
        input: {
          enabled:
            getTrimmedFormValue(formData, "enabled") === "on" ||
            getTrimmedFormValue(formData, "enabled") === "true",
          messagingServiceSid: getTrimmedFormValue(formData, "messagingServiceSid"),
          smsFrom: getTrimmedFormValue(formData, "smsFrom"),
          whatsappFrom: getTrimmedFormValue(formData, "whatsappFrom"),
        },
      });

      redirect(
        buildIntegrationsHref({
          organizationSlug,
          notice: "twilio-saved",
          error: null,
        }),
      );
    } catch (saveError) {
      redirect(
        buildIntegrationsHref({
          organizationSlug,
          notice: null,
          error: getActionErrorMessage(saveError),
        }),
      );
    }
  }

  async function saveTikTokConfigAction(formData: FormData) {
    "use server";

    try {
      await upsertOrganizationTikTokAccountForOrganization({
        organizationSlug,
        input: {
          advertiserId: getTrimmedFormValue(formData, "advertiserId"),
          accessToken: getTrimmedFormValue(formData, "accessToken"),
          scope: getTrimmedFormValue(formData, "scope"),
          status: getTrimmedFormValue(formData, "status"),
        },
      });

      redirect(
        buildIntegrationsHref({
          organizationSlug,
          notice: "tiktok-saved",
          error: null,
        }),
      );
    } catch (saveError) {
      redirect(
        buildIntegrationsHref({
          organizationSlug,
          notice: null,
          error: getActionErrorMessage(saveError),
        }),
      );
    }
  }

  async function sendTestMessageAction(formData: FormData) {
    "use server";

    try {
      await sendTwilioTestMessageForOrganization({
        organizationSlug,
        input: {
          toE164: getTrimmedFormValue(formData, "toE164"),
          channel: getTrimmedFormValue(formData, "channel"),
          body: getTrimmedFormValue(formData, "body"),
        },
      });

      redirect(
        buildIntegrationsHref({
          organizationSlug,
          notice: "test-sent",
          error: null,
        }),
      );
    } catch (testError) {
      redirect(
        buildIntegrationsHref({
          organizationSlug,
          notice: null,
          error: getActionErrorMessage(testError),
        }),
      );
    }
  }

  async function completeTikTokAdvertiserSelectionAction(formData: FormData) {
    "use server";

    try {
      const membership = await requireOrganizationMembership(organizationSlug);

      if (!canManageOrganization(membership.role)) {
        throw new Error("Integration access denied.");
      }

      const advertiserId = getTrimmedFormValue(formData, "advertiserId");
      const serverCookieStore = await cookies();
      const pendingAdvertiserSelection = readPendingAdvertiserSelectionCookieValue(
        serverCookieStore.get(getTikTokOauthPendingSelectionCookieName())?.value,
      );

      await saveTikTokOauthPendingAdvertiserSelection({
        organizationId: membership.organizationId,
        advertiserId,
        pendingSelection: pendingAdvertiserSelection,
      });
      serverCookieStore.set(
        getTikTokOauthPendingSelectionCookieName(),
        "",
        getTikTokOauthCookieOptions(0),
      );

      redirect(
        buildIntegrationsHref({
          organizationSlug,
          notice: "tiktok-oauth-connected",
          error: null,
        }),
      );
    } catch (selectionError) {
      redirect(
        buildIntegrationsHref({
          organizationSlug,
          notice: null,
          error: getActionErrorMessage(selectionError),
        }),
      );
    }
  }

  return (
    <div className="space-y-4">
      {notice ? (
        <section className="rounded-[1.25rem] border border-[#90FF4D]/20 bg-[#90FF4D]/[0.08] px-4 py-3 text-sm text-[#D7FFBC]">
          {notice}
        </section>
      ) : null}
      {error ? (
        <section className="rounded-[1.25rem] border border-[#FF7E54]/20 bg-[#FF7E54]/[0.08] px-4 py-3 text-sm text-[#FFD3C5]">
          {error}
        </section>
      ) : null}

      {workspace.canManageIntegrations ? (
        <>
          <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  Twilio
                </p>
                <h1 className="mt-2 text-2xl font-medium tracking-[-0.045em] text-foreground">
                  Configure outbound and inbound messaging.
                </h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Save account-level sender configuration used by Spark code
                  requests and webhook replies.
                </p>
              </div>
            </div>

            <form action={saveTwilioConfigAction} className="mt-5 space-y-4">
              <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  className="h-4 w-4 rounded border border-white/[0.2] bg-black/[0.24]"
                  defaultChecked={workspace.twilioConfig?.enabled ?? false}
                  name="enabled"
                  type="checkbox"
                  value="true"
                />
                Enable Twilio for this organization
              </label>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Messaging service SID (optional)
                  </span>
                  <input
                    className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                    defaultValue={workspace.twilioConfig?.messagingServiceSid ?? ""}
                    name="messagingServiceSid"
                    placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    type="text"
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Leave blank to send from the channel-specific sender fields below.
                  </p>
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    SMS from
                  </span>
                  <input
                    className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                    defaultValue={workspace.twilioConfig?.smsFrom ?? ""}
                    name="smsFrom"
                    placeholder="+15551234567"
                    type="text"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    WhatsApp from
                  </span>
                  <input
                    className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                    defaultValue={workspace.twilioConfig?.whatsappFrom ?? ""}
                    name="whatsappFrom"
                    placeholder="+15557654321"
                    type="text"
                  />
                </label>
              </div>

              <button
                className="inline-flex min-h-11 items-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                type="submit"
              >
                Save Twilio settings
              </button>
            </form>
          </section>

          <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  TikTok Business
                </p>
                <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
                  Connect advertiser access and launch paid-view lookups.
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  OAuth is the fastest path. Manual advertiser credentials remain
                  available below as a fallback.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  className="inline-flex min-h-11 items-center rounded-[0.95rem] border border-white/[0.08] bg-white/[0.04] px-4 text-sm font-medium text-foreground transition hover:border-white/[0.14] hover:bg-white/[0.07]"
                  href={paidViewsHref}
                >
                  View top ads
                </Link>
                <Link
                  className="inline-flex min-h-11 items-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                  href={connectTikTokHref}
                >
                  Connect TikTok
                </Link>
              </div>
            </div>

            {pendingSelection ? (
              <div className="mt-5 rounded-[1.1rem] border border-[#90FF4D]/20 bg-[#90FF4D]/[0.08] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-[#D7FFBC]">
                  OAuth selection
                </p>
                <h3 className="mt-2 text-lg font-medium tracking-[-0.03em] text-[#F3FFE8]">
                  Choose the TikTok advertiser to save
                </h3>
                <p className="mt-2 text-sm leading-6 text-[#D7FFBC]">
                  TikTok returned {pendingSelection.advertisers.length} advertiser
                  accounts for this authorization. Pick the one this organization
                  should use by default.
                </p>
                <form
                  action={completeTikTokAdvertiserSelectionAction}
                  className="mt-4 space-y-4"
                >
                  <label className="block">
                    <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-[#D7FFBC]">
                      Advertiser account
                    </span>
                    <select
                      className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                      defaultValue={pendingSelection.advertisers[0]?.advertiserId ?? ""}
                      name="advertiserId"
                    >
                      {pendingSelection.advertisers.map((advertiser) => (
                        <option
                          key={advertiser.advertiserId}
                          value={advertiser.advertiserId}
                        >
                          {advertiser.advertiserName
                            ? `${advertiser.advertiserName} (${advertiser.advertiserId})`
                            : advertiser.advertiserId}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="inline-flex min-h-11 items-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                    type="submit"
                  >
                    Save advertiser
                  </button>
                </form>
              </div>
            ) : null}

            {workspace.tiktokAccounts.length > 0 ? (
              <div className="mt-5 grid gap-3 lg:grid-cols-3">
                {workspace.tiktokAccounts.map((account) => (
                  <article
                    key={account.id}
                    className="rounded-[1.05rem] border border-white/[0.08] bg-black/[0.22] p-4"
                  >
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      Saved advertiser
                    </p>
                    <p className="mt-2 text-sm font-medium text-foreground">
                      {account.advertiserName
                        ? `${account.advertiserName}`
                        : account.advertiserId}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {account.advertiserName ? account.advertiserId : account.status}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {account.lastValidatedAt
                        ? `Last updated ${account.lastValidatedAt.toISOString()}`
                        : "Not validated yet"}
                    </p>
                    {account.accessTokenExpiresAt ? (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Access token expiry {account.accessTokenExpiresAt.toISOString()}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-[1rem] border border-dashed border-white/[0.08] bg-black/[0.2] px-4 py-6 text-sm text-muted-foreground">
                No TikTok advertiser accounts are saved yet. Connect TikTok with OAuth
                or enter manual credentials below.
              </div>
            )}

            <form action={saveTikTokConfigAction} className="mt-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Advertiser ID
                  </span>
                  <input
                    className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                    defaultValue={primaryTikTokAccount?.advertiserId ?? ""}
                    name="advertiserId"
                    required
                    type="text"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Status
                  </span>
                  <select
                    className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                    defaultValue={primaryTikTokAccount?.status ?? "ACTIVE"}
                    name="status"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="ENABLED">ENABLED</option>
                    <option value="DISABLED">DISABLED</option>
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Access token
                </span>
                <input
                  className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                  defaultValue={primaryTikTokAccount?.accessToken ?? ""}
                  name="accessToken"
                  required
                  type="password"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Scope (optional)
                </span>
                <input
                  className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                  defaultValue={
                    getScopeInputValue(primaryTikTokAccount?.scope)
                  }
                  name="scope"
                  placeholder="spark_auth,ad_management"
                  type="text"
                />
              </label>
              <button
                className="inline-flex min-h-11 items-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                type="submit"
              >
                Save TikTok settings
              </button>
            </form>
          </section>

          <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Messaging smoke test
            </p>
            <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
              Send a test outbound message.
            </h2>

            <form action={sendTestMessageAction} className="mt-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Channel
                  </span>
                  <select
                    className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition focus:border-white/[0.16]"
                    defaultValue={MessagingChannel.SMS}
                    name="channel"
                  >
                    <option value={MessagingChannel.SMS}>SMS</option>
                    <option value={MessagingChannel.WHATSAPP}>WhatsApp</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    To phone
                  </span>
                  <input
                    className="h-11 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                    name="toE164"
                    placeholder="+15551234567"
                    required
                    type="text"
                  />
                </label>
              </div>
              <label className="block">
                <span className="mb-2 block text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Message body
                </span>
                <textarea
                  className="min-h-24 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3.5 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-white/[0.16]"
                  defaultValue="Billion Views Twilio integration test message."
                  name="body"
                />
              </label>
              <button
                className="inline-flex min-h-11 items-center rounded-[0.95rem] border border-[#90FF4D]/20 bg-[#90FF4D]/90 px-4 text-sm font-medium text-black transition hover:bg-[#A4FF68]"
                type="submit"
              >
                Send test message
              </button>
            </form>
          </section>

          <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  Conversation threads
                </p>
                <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
                  Last 10 creator conversations
                </h2>
              </div>
            </div>
            {workspace.recentThreads.length > 0 ? (
              <div className="mt-4 space-y-2">
                {workspace.recentThreads.map((thread) => (
                  <article
                    key={thread.id}
                    className="rounded-[0.95rem] border border-white/[0.08] bg-black/[0.2] px-3.5 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
                      <span>{thread.channel}</span>
                      <span>/</span>
                      <span>{thread.state}</span>
                    </div>
                    <p className="mt-2 text-sm text-foreground">
                      {thread.creator.displayName}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {thread.lastInboundAt
                        ? `Last inbound ${thread.lastInboundAt.toISOString()}`
                        : "No inbound yet"}
                      {" - "}
                      {thread.lastOutboundAt
                        ? `Last outbound ${thread.lastOutboundAt.toISOString()}`
                        : "No outbound yet"}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-[1rem] border border-dashed border-white/[0.08] bg-black/[0.2] px-4 py-8 text-sm text-muted-foreground">
                No creator conversation threads yet. Sending Spark requests will
                create them automatically.
              </div>
            )}
          </section>

          <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
                  Recent message events
                </p>
                <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
                  Last 10 message records
                </h2>
              </div>
              <Link
                className="inline-flex min-h-10 items-center rounded-[0.95rem] border border-white/[0.08] bg-white/[0.04] px-3.5 text-sm text-foreground transition hover:border-white/[0.14] hover:bg-white/[0.07]"
                href={buildIntegrationsHref({
                  organizationSlug,
                })}
              >
                Refresh
              </Link>
            </div>
            {workspace.recentEvents.length > 0 ? (
              <div className="mt-4 space-y-2">
                {workspace.recentEvents.map((event) => (
                  <article
                    key={event.id}
                    className="rounded-[0.95rem] border border-white/[0.08] bg-black/[0.2] px-3.5 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-[0.62rem] uppercase tracking-[0.2em] text-muted-foreground">
                      <span>{event.direction}</span>
                      <span>/</span>
                      <span>{event.channel}</span>
                      <span>/</span>
                      <span>{event.parseStatus}</span>
                      {event.deliveryStatus ? (
                        <>
                          <span>/</span>
                          <span>{event.deliveryStatus}</span>
                        </>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm text-foreground">
                      {event.body.length > 220
                        ? `${event.body.slice(0, 219)}...`
                        : event.body}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {event.creator?.displayName ?? "Unknown creator"}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-[1rem] border border-dashed border-white/[0.08] bg-black/[0.2] px-4 py-8 text-sm text-muted-foreground">
                No message events yet. Send a test message or request a Spark code
                to populate this feed.
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur">
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            Integrations access
          </p>
          <h1 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
            Organization admins and owners can manage integrations.
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your current organization role does not allow Twilio or TikTok
            integration updates.
          </p>
        </section>
      )}
    </div>
  );
}
