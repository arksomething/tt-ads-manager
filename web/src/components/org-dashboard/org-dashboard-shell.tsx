import type { ReactNode } from "react";

import { OrgSidebar } from "./org-sidebar";

type OrgDashboardShellProps = {
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
  children: ReactNode;
};

export function OrgDashboardShell({
  organizationSlug,
  organizationName,
  organizations,
  userName,
  userEmail,
  children,
}: OrgDashboardShellProps) {
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

  return (
    <main className="relative isolate min-h-screen overflow-hidden bg-[#050607] text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_24%),radial-gradient(circle_at_16%_18%,rgba(255,255,255,0.05),transparent_16%),radial-gradient(circle_at_82%_22%,rgba(144,255,77,0.06),transparent_16%),linear-gradient(180deg,#09090b_0%,#040405_100%)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-[-8rem] top-[-6rem] h-[36rem] w-[18rem] rounded-full bg-white/[0.12] blur-[110px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[8%] top-[28%] h-[20rem] w-[20rem] rounded-full bg-[#90FF4D]/[0.08] blur-[120px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[-10rem] left-[18%] h-[22rem] w-[22rem] rounded-full bg-white/[0.06] blur-[130px]"
      />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1920px] flex-col gap-3 px-2.5 py-2.5 sm:px-3 sm:py-3 lg:flex-row lg:gap-4 lg:px-4 lg:py-4">
        <OrgSidebar
          changeAccountAction={handleChangeAccount}
          organizationName={organizationName}
          organizationSlug={organizationSlug}
          organizations={organizations}
          signOutAction={handleSignOut}
          userEmail={userEmail}
          userName={userName}
        />

        <section className="min-w-0 flex-1 rounded-[1.85rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,11,14,0.9),rgba(6,6,8,0.96))] shadow-[0_24px_96px_rgba(0,0,0,0.32)] backdrop-blur-xl">
          <div className="px-3 pb-3 pt-3 sm:px-4 sm:pb-4 lg:px-5 lg:pb-5 lg:pt-4">
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
