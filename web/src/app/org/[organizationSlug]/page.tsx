import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  getOrganizationMembership,
  getViewerOrganizations,
} from "@/server/auth/organizations";
import { getOrganizationDashboardSummary } from "@/server/dashboard/queries";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type OrganizationPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
};

export const dynamic = "force-dynamic";

export default async function OrganizationPage({
  params,
}: OrganizationPageProps) {
  const { auth } = await import("@/auth");
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const { organizationSlug } = await params;
  const membership = await getOrganizationMembership(organizationSlug);

  if (!membership) {
    notFound();
  }

  const [summary, organizations] = await Promise.all([
    getOrganizationDashboardSummary(membership.organizationId),
    getViewerOrganizations(),
  ]);

  const stats = [
    { label: "Campaigns", value: summary.campaignCount.toString() },
    { label: "Active campaigns", value: summary.activeCampaignCount.toString() },
    { label: "Creators", value: summary.creatorCount.toString() },
    { label: "Videos", value: summary.videoCount.toString() },
    {
      label: "Paid payouts",
      value: currencyFormatter.format(Number(summary.paidPayoutTotal)),
    },
  ];

  return (
    <main className="min-h-screen bg-background px-6 py-10 lg:px-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="rounded-[2rem] border border-white/[0.08] bg-white/[0.03] p-6 backdrop-blur md:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
                Organization workspace
              </p>
              <h1 className="mt-4 text-4xl font-medium tracking-[-0.05em] text-foreground">
                {membership.organization.name}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
                You&apos;re signed in as{" "}
                {session.user.email ?? session.user.name ?? "your account"}.
                This is the organization-scoped home for campaigns, creators,
                and payout operations.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                className="inline-flex items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.03] px-4 py-2 text-sm text-foreground transition hover:border-white/[0.18] hover:bg-white/[0.06]"
                href="/app"
              >
                Switch organization
              </Link>
              <form
                action={async () => {
                  "use server";
                  const { signOut } = await import("@/auth");
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button
                  className="inline-flex items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.03] px-4 py-2 text-sm text-foreground transition hover:border-white/[0.18] hover:bg-white/[0.06]"
                  type="submit"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {stats.map((stat) => (
            <article
              key={stat.label}
              className="rounded-[1.6rem] border border-white/[0.08] bg-white/[0.03] p-5"
            >
              <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">
                {stat.label}
              </p>
              <p className="mt-4 text-3xl font-medium tracking-[-0.04em] text-foreground">
                {stat.value}
              </p>
            </article>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <article className="rounded-[2rem] border border-white/[0.08] bg-white/[0.03] p-6 backdrop-blur md:p-8">
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Setup progress
            </p>
            <h2 className="mt-4 text-2xl font-medium tracking-[-0.035em] text-foreground">
              Google auth is live and the organization shell is ready.
            </h2>
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              Next, we can plug this organization into campaign CRUD, creator
              imports, and synced data flows. This page already uses your real
              membership and organization-scoped summary queries.
            </p>
          </article>

          <aside className="rounded-[2rem] border border-white/[0.08] bg-white/[0.03] p-6 backdrop-blur md:p-8">
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Your access
            </p>
            <div className="mt-4 space-y-3">
              {organizations.map(({ organization, role }) => (
                <Link
                  key={organization.id}
                  className={`block rounded-[1.25rem] border px-4 py-4 transition ${
                    organization.id === membership.organization.id
                      ? "border-[#90FF4D]/40 bg-[#90FF4D]/[0.08]"
                      : "border-white/[0.08] bg-black/[0.18] hover:border-white/[0.16]"
                  }`}
                  href={`/org/${organization.slug}`}
                >
                  <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                    {role}
                  </p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {organization.name}
                  </p>
                </Link>
              ))}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
