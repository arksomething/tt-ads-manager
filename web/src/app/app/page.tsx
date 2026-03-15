import Link from "next/link";
import { redirect } from "next/navigation";

import { getViewerOrganizations } from "@/server/auth/organizations";
import { createOrganizationForCurrentUser } from "@/server/organizations/mutations";

export const dynamic = "force-dynamic";

export default async function AppHomePage() {
  const { auth } = await import("@/auth");
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/login");
  }

  const organizations = await getViewerOrganizations();

  if (organizations.length === 1) {
    redirect(`/org/${organizations[0].organization.slug}`);
  }

  return (
    <main className="min-h-screen bg-background px-6 py-10 lg:px-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-4 rounded-[2rem] border border-white/[0.08] bg-white/[0.03] p-6 backdrop-blur md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              Organization access
            </p>
            <h1 className="mt-4 text-3xl font-medium tracking-[-0.045em] text-foreground">
              {organizations.length === 0
                ? "Create your first organization."
                : "Choose an organization."}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              Signed in as {session.user.email ?? session.user.name ?? "your account"}.
            </p>
          </div>

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
        </header>

        {organizations.length > 1 ? (
          <section className="grid gap-4 md:grid-cols-2">
            {organizations.map(({ organization, role }) => (
              <Link
                key={organization.id}
                className="rounded-[1.7rem] border border-white/[0.08] bg-white/[0.03] p-6 transition hover:border-white/[0.16] hover:bg-white/[0.05]"
                href={`/org/${organization.slug}`}
              >
                <p className="text-xs uppercase tracking-[0.26em] text-muted-foreground">
                  {role}
                </p>
                <h2 className="mt-4 text-2xl font-medium tracking-[-0.035em] text-foreground">
                  {organization.name}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Open workspace
                </p>
              </Link>
            ))}
          </section>
        ) : null}

        <section className="rounded-[2rem] border border-white/[0.08] bg-white/[0.03] p-6 backdrop-blur md:p-8">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
              First step
            </p>
            <h2 className="mt-4 text-2xl font-medium tracking-[-0.035em] text-foreground">
              {organizations.length === 0
                ? "Set up the top-level workspace."
                : "Create another organization."}
            </h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              Start with the company, brand, or client account that will own
              campaigns, creators, notes, and payouts.
            </p>
          </div>

          <form
            action={async (formData) => {
              "use server";

              const organization = await createOrganizationForCurrentUser({
                name: formData.get("name"),
              });

              redirect(`/org/${organization.slug}`);
            }}
            className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-end"
          >
            <label className="block flex-1">
              <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-muted-foreground">
                Organization name
              </span>
              <input
                className="w-full rounded-2xl border border-white/[0.1] bg-black/[0.22] px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-[#90FF4D]/50"
                name="name"
                placeholder="North Star Labs"
                required
                type="text"
              />
            </label>

            <button
              className="inline-flex items-center justify-center rounded-full border border-white/[0.14] bg-black/[0.52] px-6 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(0,0,0,0.35)] backdrop-blur transition hover:border-[#90FF4D]/40 hover:bg-black/[0.68]"
              type="submit"
            >
              Create organization
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
