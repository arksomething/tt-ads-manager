import { redirect } from "next/navigation";

import { type DashboardSearchParams } from "@/server/dashboard/filters";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { canManageOrganization } from "@/server/auth/roles";
import {
  getManagedSecretRuntimeStatuses,
  upsertOrganizationManagedCredential,
} from "@/server/settings/managed-secrets";
import { getManagedCredentialHealthChecks } from "@/server/settings/credential-health";

export const dynamic = "force-dynamic";

type SettingsPageProps = {
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

function buildSettingsHref(args: {
  organizationSlug: string;
  notice?: string | null;
  secret?: string | null;
  error?: string | null;
}) {
  const nextSearchParams = new URLSearchParams();

  if (args.notice) {
    nextSearchParams.set("notice", args.notice);
  }

  if (args.secret) {
    nextSearchParams.set("secret", args.secret);
  }

  if (args.error) {
    nextSearchParams.set("error", args.error);
  }

  const query = nextSearchParams.toString();
  const baseHref = `/org/${args.organizationSlug}/settings`;
  return query ? `${baseHref}?${query}` : baseHref;
}

function getNoticeLabel(value: string | undefined, secret: string | undefined) {
  switch (value) {
    case "secret-saved":
      return secret
        ? `${secret} saved to the organization credential store. New requests will use it immediately.`
        : "Credential saved to the organization credential store. New requests will use it immediately.";
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

export default async function OrganizationSettingsPage({
  params,
  searchParams,
}: SettingsPageProps) {
  const { organizationSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const membership = await requireOrganizationMembership(organizationSlug);
  const canManageSettings = canManageOrganization(membership.role);
  const [secretStatuses, healthChecks] = await Promise.all([
    getManagedSecretRuntimeStatuses(organizationSlug),
    getManagedCredentialHealthChecks(organizationSlug),
  ]);
  const healthByKey = new Map(
    healthChecks.map((healthCheck) => [healthCheck.key, healthCheck]),
  );
  const notice = getNoticeLabel(
    getSearchParamValue(resolvedSearchParams, "notice"),
    getSearchParamValue(resolvedSearchParams, "secret"),
  );
  const error = getErrorLabel(getSearchParamValue(resolvedSearchParams, "error"));
  const controlsEnabled = canManageSettings;

  async function resetManagedSecretAction(formData: FormData) {
    "use server";

    try {
      const result = await upsertOrganizationManagedCredential({
        organizationSlug,
        key: getTrimmedFormValue(formData, "key"),
        value: getTrimmedFormValue(formData, "value"),
      });

      redirect(
        buildSettingsHref({
          organizationSlug,
          notice: "secret-saved",
          secret: result.label,
          error: null,
        }),
      );
    } catch (saveError) {
      redirect(
        buildSettingsHref({
          organizationSlug,
          notice: null,
          error: getActionErrorMessage(saveError),
        }),
      );
    }
  }

  return (
    <div className="space-y-5">
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

      <section className="rounded-[1.55rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.2)] backdrop-blur sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              Settings
            </p>
            <h1 className="mt-2 text-2xl font-medium tracking-[-0.045em] text-foreground sm:text-3xl">
              Reset production integration tokens.
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              These controls update encrypted organization credentials in the
              database for ViewsBase and Adapty. Saved values are never shown
              back in the dashboard.
            </p>
          </div>
          <div className="rounded-[1rem] border border-white/[0.08] bg-black/[0.18] px-4 py-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Live checks run on load</p>
            <p className="mt-1 leading-5">
              Opening this page tests each configured token against its upstream
              service and reports whether it is alive.
            </p>
          </div>
        </div>
      </section>

      {!canManageSettings ? (
        <section className="rounded-[1.25rem] border border-[#FF7E54]/20 bg-[#FF7E54]/[0.08] px-4 py-3 text-sm text-[#FFD3C5]">
          Only organization owners and admins can reset production tokens.
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-3">
        {secretStatuses.map((secret) => {
          const health = healthByKey.get(secret.key);
          const healthClass =
            health?.status === "ok"
              ? "border-[#90FF4D]/25 bg-[#90FF4D]/10 text-[#B8FF86]"
              : health?.status === "failed"
                ? "border-[#FF7E54]/25 bg-[#FF7E54]/10 text-[#FFD3C5]"
                : "border-[#FFD36E]/25 bg-[#FFD36E]/10 text-[#FFE5A3]";

          return (
            <article
              key={secret.key}
              className="rounded-[1.35rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_18px_55px_rgba(0,0,0,0.18)]"
            >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                  {secret.shortLabel}
                </p>
                <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-foreground">
                  {secret.label}
                </h2>
              </div>
              <span
                className={`shrink-0 rounded-full border px-3 py-1 text-[0.58rem] uppercase tracking-[0.18em] ${
                  secret.configured
                    ? "border-[#90FF4D]/25 bg-[#90FF4D]/10 text-[#B8FF86]"
                    : "border-[#FFD36E]/25 bg-[#FFD36E]/10 text-[#FFE5A3]"
                }`}
              >
                {secret.configured ? "Configured" : "Missing"}
              </span>
            </div>

            <p className="mt-3 min-h-12 text-sm leading-6 text-muted-foreground">
              {secret.description}
            </p>

            <div className="mt-4 rounded-[1rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-xs leading-5 text-muted-foreground">
              Stored value:{" "}
              <span className="text-foreground">
                {secret.configured
                  ? `${secret.source === "database" ? "database" : "env fallback"}${secret.preview ? ` (${secret.preview})` : ""}`
                  : "not configured"}
              </span>
            </div>

            <div
              className={`mt-3 rounded-[1rem] border px-3 py-2.5 text-xs leading-5 ${healthClass}`}
            >
              <p className="font-medium">
                Live check:{" "}
                {health?.status === "ok"
                  ? "Alive"
                  : health?.status === "failed"
                    ? "Failed"
                    : "Missing"}
              </p>
              <p className="mt-1 opacity-90">
                {health?.message ?? "No check result."}
              </p>
            </div>

            <div className="mt-3 rounded-[1rem] border border-white/[0.08] bg-black/[0.18] px-3 py-2.5 text-xs leading-5 text-muted-foreground">
              <p className="font-medium text-foreground">How to regenerate</p>
              <p className="mt-1">{secret.regenerateInstructions}</p>
            </div>

            <form action={resetManagedSecretAction} className="mt-4 space-y-3">
              <input name="key" type="hidden" value={secret.key} />
              <label className="block text-sm font-medium text-foreground">
                New value
                <input
                  autoComplete="off"
                  className="mt-2 w-full rounded-[0.95rem] border border-white/[0.08] bg-black/[0.24] px-3 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-[#90FF4D]/40"
                  disabled={!controlsEnabled}
                  name="value"
                  placeholder={secret.placeholder}
                  required
                  type="password"
                />
              </label>
              <button
                className="inline-flex w-full items-center justify-center rounded-[0.95rem] border border-[#90FF4D]/25 bg-[#90FF4D]/12 px-4 py-3 text-sm font-medium text-[#D7FFBC] transition hover:bg-[#90FF4D]/18 disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/[0.04] disabled:text-muted-foreground"
                disabled={!controlsEnabled}
                type="submit"
              >
                Reset {secret.shortLabel}
              </button>
            </form>
            </article>
          );
        })}
      </section>
    </div>
  );
}
