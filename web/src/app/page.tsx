import { redirect } from "next/navigation";

import { auth, isAuthConfigured } from "@/auth";
import { isAuthDisabled } from "@/lib/server-env";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (isAuthDisabled()) {
    redirect("/app");
  }

  if (isAuthConfigured) {
    try {
      const session = await auth();

      if (session?.user?.id) {
        redirect("/app");
      }
    } catch {
      // Fall back to the login screen when auth env is incomplete.
    }
  }

  redirect("/login");
}
