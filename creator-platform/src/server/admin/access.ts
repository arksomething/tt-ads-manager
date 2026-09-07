import { redirect } from "next/navigation";

import { hasSupabaseAuthEnv } from "@/lib/server-env";
import { getCurrentDiscordStaffMembership } from "@/server/admin/discord";
import { getCurrentAccount } from "@/server/auth/session";

export async function requireCreatorStaff(nextPath: string) {
  if (!hasSupabaseAuthEnv()) redirect("/auth/sign-in");
  const account = await getCurrentAccount();
  if (!account) redirect(`/auth/sign-in?next=${encodeURIComponent(nextPath)}`);
  const staff = await getCurrentDiscordStaffMembership();
  if (!staff) redirect("/account");
  return { account, staff };
}

export async function requireCreatorAdmin(nextPath: string) {
  const context = await requireCreatorStaff(nextPath);
  if (context.staff.role !== "admin") redirect("/admin");
  return {
    account: context.account,
    staff: { role: "admin" as const },
  };
}
