import Link from "next/link";
import { Cormorant_Garamond } from "next/font/google";
import { redirect } from "next/navigation";

import { AppAccountMenu } from "@/components/app-account-menu";
import { isWorkspaceSchemaAvailable } from "@/lib/db";
import { publicEnv } from "@/lib/env";
import { isGoogleAuthDisabled } from "@/lib/server-env";
import { getViewerOrganizations } from "@/server/auth/organizations";
import { getCurrentUser } from "@/server/auth/session";
import {
  createOrganizationForCurrentUser,
  ensureOrganizationForCurrentUser,
} from "@/server/organizations/mutations";

export const dynamic = "force-dynamic";

const appSerif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

function getSearchParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AppHomePage({
  searchParams,
}: PageProps<"/app">) {
  const publicAccessEnabled = isGoogleAuthDisabled();
  const resolvedSearchParams = await searchParams;
  const manageMode =
    getSearchParamValue(resolvedSearchParams.manage) === "workspaces";
  const currentWorkspaceSlug = getSearchParamValue(resolvedSearchParams.from);
  const user = await getCurrentUser();

  if (!user?.id && !publicAccessEnabled) {
    redirect("/login");
  }

  let organizations: Awaited<ReturnType<typeof getViewerOrganizations>>;

  try {
    organizations = await getViewerOrganizations();
  } catch (error) {
    if (publicAccessEnabled) {
      redirect("/tiktok-paid-views?notice=workspace-backend-unavailable");
    }

    throw error;
  }

  if (organizations.length === 0) {
    const workspaceSchemaAvailable = await isWorkspaceSchemaAvailable();

    if (!workspaceSchemaAvailable) {
      redirect("/tiktok-paid-views?notice=workspace-backend-unavailable");
    }

    if (publicAccessEnabled) {
      redirect("/tiktok-paid-views");
    }

    const organization = await ensureOrganizationForCurrentUser();
    redirect(`/org/${organization.slug}`);
  }

  if (organizations.length === 1 && !manageMode) {
    redirect(`/org/${organizations[0].organization.slug}`);
  }

  const canCreateWorkspaces = Boolean(user?.id) && !publicAccessEnabled;
  const signedInAs = user?.email ?? user?.name ?? "Public access";
  const currentWorkspace = currentWorkspaceSlug
    ? organizations.find(
        ({ organization }) => organization.slug === currentWorkspaceSlug,
      )?.organization ?? null
    : null;
  const orderedOrganizations =
    currentWorkspaceSlug == null
      ? organizations
      : [
          ...organizations.filter(
            ({ organization }) => organization.slug === currentWorkspaceSlug,
          ),
          ...organizations.filter(
            ({ organization }) => organization.slug !== currentWorkspaceSlug,
          ),
        ];
  const pageEyebrow = manageMode
    ? "Workspace hub"
    : canCreateWorkspaces
      ? "New workspace"
      : "Workspace hub";
  const pageTitle = manageMode
    ? publicAccessEnabled
      ? "Open a workspace."
      : "Manage your workspaces."
    : canCreateWorkspaces
      ? "Name the next workspace."
      : "Open a workspace.";
  const pageDescription = manageMode
    ? publicAccessEnabled
      ? "Public access is enabled in this deployment. Open one of the configured workspaces directly."
      : currentWorkspace
        ? `Open ${currentWorkspace.name}, jump into workspace settings, or create another top-level workspace without losing your place.`
        : "Open any workspace you already have access to, jump into workspace settings, or create another top-level workspace."
    : canCreateWorkspaces
      ? "Create another top-level workspace without losing the calm structure of the current one."
      : "Public access is enabled in this deployment. Choose one of the configured workspaces below.";

  async function handleSignOut() {
    "use server";

    const { signOut } = await import("@/auth");
    await signOut({ redirectTo: "/" });
  }

  async function handleChangeAccount() {
    "use server";

    const { signOut } = await import("@/auth");
    await signOut({ redirectTo: "/login?mode=switch-account" });
  }

  async function handleCreateOrganization(formData: FormData) {
    "use server";

    if (!(await isWorkspaceSchemaAvailable())) {
      redirect("/tiktok-paid-views?notice=workspace-backend-unavailable");
    }

    const organization = await createOrganizationForCurrentUser({
      name: formData.get("name"),
    });

    redirect(`/org/${organization.slug}`);
  }

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-[#060607] text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_24%),radial-gradient(circle_at_16%_22%,rgba(255,255,255,0.05),transparent_18%),radial-gradient(circle_at_86%_28%,rgba(255,255,255,0.04),transparent_18%),linear-gradient(180deg,#09090b_0%,#040405_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[-7rem] top-[-4rem] h-[42rem] w-[18rem] rounded-full bg-white/[0.14] blur-[115px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[12%] top-[18%] h-[28rem] w-[11rem] rounded-full bg-white/[0.08] blur-[84px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[10%] top-[52%] h-[11rem] w-[11rem] rounded-full bg-white/[0.1] blur-[76px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 w-full bg-[radial-gradient(circle_at_18%_46%,rgba(255,255,255,0.08),transparent_18%),radial-gradient(circle_at_82%_52%,rgba(255,255,255,0.06),transparent_12%)]"
      />

      <header className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between px-6 py-8 sm:px-8 sm:py-10">
        <Link
          className="text-xs font-medium uppercase tracking-[0.22em] text-foreground/88 transition hover:text-foreground"
          href="/"
        >
          {publicEnv.NEXT_PUBLIC_APP_NAME}
        </Link>

        {user?.id ? (
          <AppAccountMenu
            changeAccountAction={handleChangeAccount}
            signOutAction={handleSignOut}
            signedInAs={signedInAs}
          />
        ) : null}
      </header>

      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-24 sm:px-8">
        <div className={`w-full ${manageMode ? "max-w-5xl" : "max-w-4xl"}`}>
          <section
            className={`mx-auto w-full rounded-[2.1rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(18,18,21,0.78),rgba(9,9,11,0.93))] p-8 shadow-[0_40px_120px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:p-10 ${
              manageMode ? "max-w-5xl" : "max-w-[26rem]"
            }`}
          >
            <div className="space-y-5">
              <p className="text-[0.62rem] uppercase tracking-[0.3em] text-muted-foreground/88">
                {pageEyebrow}
              </p>
              <h1
                className={`${appSerif.className} text-[2.2rem] leading-none tracking-[-0.04em] text-foreground sm:text-[2.55rem]`}
              >
                {pageTitle}
              </h1>
              <p
                className={`text-sm leading-6 text-muted-foreground ${
                  manageMode ? "max-w-2xl" : "max-w-sm"
                }`}
              >
                {pageDescription}
              </p>
            </div>

            {manageMode ? (
              <>
                {orderedOrganizations.length > 0 ? (
                  <section className="mt-10" id="workspaces">
                    <div className="flex flex-col gap-2">
                      <p className="text-[0.62rem] uppercase tracking-[0.28em] text-muted-foreground">
                        Your workspaces
                      </p>
                      <p className="text-sm leading-6 text-muted-foreground">
                        Open an existing workspace directly or jump into its
                        settings for billing, integrations, and account details.
                      </p>
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      {orderedOrganizations.map(({ organization, role }) => {
                        const isCurrentWorkspace =
                          organization.slug === currentWorkspaceSlug;

                        return (
                          <div
                            key={organization.id}
                            className="rounded-[1.4rem] border border-white/[0.08] bg-black/[0.18] p-5"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
                                  {isCurrentWorkspace
                                    ? "Current workspace"
                                    : role}
                                </p>
                                <h2 className="mt-3 text-xl font-medium tracking-[-0.03em] text-foreground">
                                  {organization.name}
                                </h2>
                              </div>

                              {isCurrentWorkspace ? (
                                <span className="rounded-full border border-[#90FF4D]/25 bg-[#90FF4D]/10 px-2.5 py-1 text-[0.58rem] uppercase tracking-[0.2em] text-[#B8FF86]">
                                  Active
                                </span>
                              ) : null}
                            </div>

                            <div className="mt-5 flex flex-wrap gap-2">
                              <Link
                                className="inline-flex items-center rounded-full border border-white/[0.1] bg-white/[0.04] px-3.5 py-2 text-sm text-foreground transition hover:border-white/[0.16] hover:bg-white/[0.08]"
                                href={`/org/${organization.slug}`}
                              >
                                {isCurrentWorkspace
                                  ? "Return to workspace"
                                  : "Open workspace"}
                              </Link>
                              <Link
                                className="inline-flex items-center rounded-full border border-white/[0.08] px-3.5 py-2 text-sm text-muted-foreground transition hover:border-white/[0.14] hover:text-foreground"
                                href={`/org/${organization.slug}/settings`}
                              >
                                Workspace settings
                              </Link>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                {canCreateWorkspaces ? (
                  <section className="mt-8 rounded-[1.8rem] border border-white/[0.08] bg-white/[0.03] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.28)] backdrop-blur sm:p-7">
                    <div className="space-y-3">
                      <p className="text-[0.62rem] uppercase tracking-[0.28em] text-muted-foreground">
                        New workspace
                      </p>
                      <h2
                        className={`${appSerif.className} text-[1.8rem] leading-none tracking-[-0.04em] text-foreground sm:text-[2rem]`}
                      >
                        Create another workspace.
                      </h2>
                      <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                        Separate brands, clients, or teams into their own
                        top-level workspace without leaving this account.
                      </p>
                    </div>

                    <form action={handleCreateOrganization} className="mt-8">
                      <label className="block">
                        <span className="sr-only">Organization name</span>
                        <input
                          className="w-full rounded-full border border-white/[0.08] bg-black/[0.22] px-5 py-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/62 focus:border-white/[0.18] focus:bg-black/[0.3]"
                          name="name"
                          placeholder="North Star Labs"
                          required
                          type="text"
                        />
                      </label>

                      <div className="mt-8 flex flex-col items-center gap-3">
                        <button
                          aria-label="Create organization"
                          className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-[#90FF4D]/24 bg-[#90FF4D]/90 text-black shadow-[0_24px_60px_rgba(144,255,77,0.24)] transition hover:scale-[1.02] hover:bg-[#A4FF68]"
                          type="submit"
                        >
                          <svg
                            aria-hidden="true"
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 16 16"
                          >
                            <path
                              d="M5 3.5L9.5 8L5 12.5"
                              stroke="currentColor"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="1.6"
                            />
                          </svg>
                        </button>
                        <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground/72">
                          Press Enter
                        </p>
                      </div>
                    </form>
                  </section>
                ) : null}
              </>
            ) : (
              <>
                {canCreateWorkspaces ? (
                  <form action={handleCreateOrganization} className="mt-10">
                    <label className="block">
                      <span className="sr-only">Organization name</span>
                      <input
                        className="w-full rounded-full border border-white/[0.08] bg-black/[0.22] px-5 py-4 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/62 focus:border-white/[0.18] focus:bg-black/[0.3]"
                        name="name"
                        placeholder="North Star Labs"
                        required
                        type="text"
                      />
                    </label>

                    <div className="mt-8 flex flex-col items-center gap-3">
                      <button
                        aria-label="Create organization"
                        className="inline-flex h-14 w-14 items-center justify-center rounded-full border border-[#90FF4D]/24 bg-[#90FF4D]/90 text-black shadow-[0_24px_60px_rgba(144,255,77,0.24)] transition hover:scale-[1.02] hover:bg-[#A4FF68]"
                        type="submit"
                      >
                        <svg
                          aria-hidden="true"
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 16 16"
                        >
                          <path
                            d="M5 3.5L9.5 8L5 12.5"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.6"
                          />
                        </svg>
                      </button>
                      <p className="text-[0.62rem] uppercase tracking-[0.22em] text-muted-foreground/72">
                        Press Enter
                      </p>
                    </div>
                  </form>
                ) : (
                  <div className="mt-10 rounded-[1.4rem] border border-white/[0.08] bg-black/[0.18] p-5 text-sm leading-6 text-muted-foreground">
                    Public access is enabled here, so `/app` acts as a workspace
                    chooser. Open one of the workspaces below.
                  </div>
                )}
              </>
            )}
          </section>

          {!manageMode && organizations.length > 1 ? (
            <section
              className="mx-auto mt-8 max-w-3xl rounded-[2rem] border border-white/[0.08] bg-white/[0.03] p-5 shadow-[0_30px_90px_rgba(0,0,0,0.28)] backdrop-blur md:p-6"
              id="workspaces"
            >
              <div className="flex flex-col gap-2 text-center">
                <p className="text-[0.62rem] uppercase tracking-[0.28em] text-muted-foreground">
                  Existing workspaces
                </p>
                <p className="text-sm leading-6 text-muted-foreground">
                  Or continue in one of the organizations you already have access
                  to.
                </p>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {organizations.map(({ organization, role }) => (
                  <Link
                    key={organization.id}
                    className="rounded-[1.4rem] border border-white/[0.08] bg-black/[0.18] p-5 text-left transition hover:border-white/[0.14] hover:bg-white/[0.04]"
                    href={`/org/${organization.slug}`}
                  >
                    <p className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
                      {role}
                    </p>
                    <h2 className="mt-3 text-xl font-medium tracking-[-0.03em] text-foreground">
                      {organization.name}
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Open workspace
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-5 left-1/2 h-1.5 w-11 -translate-x-1/2 rounded-full bg-white/[0.14]"
      />
    </main>
  );
}
