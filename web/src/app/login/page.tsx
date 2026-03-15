import { redirect } from "next/navigation";

import { AuthInfoRow, AuthShell } from "@/components/auth/auth-shell";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const googleAuthConfigured = Boolean(
    process.env.DATABASE_URL &&
      process.env.AUTH_SECRET &&
      process.env.AUTH_SECRET.length >= 32 &&
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET,
  );

  if (googleAuthConfigured) {
    try {
      const { auth } = await import("@/auth");
      const session = await auth();

      if (session?.user?.id) {
        redirect("/app");
      }
    } catch {
      // Render the auth UI even when local env setup is incomplete.
    }
  }

  return (
    <AuthShell
      description={
        googleAuthConfigured
          ? "Begin with one calm step. Continue with Google to enter your workspace."
          : "The auth surface is ready. Add the required environment variables to enable Google sign-in."
      }
      footer={
        googleAuthConfigured
          ? "By continuing, you agree to the product terms and privacy expectations for your organization workspace."
          : "Google auth is currently disabled in this environment, so the page stays visible while setup is incomplete."
      }
      title="Welcome to Billion Views"
    >
      <div className="space-y-3">
        <AuthInfoRow
          adornment={
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[0.62rem] font-medium uppercase tracking-[0.18em] text-foreground/72">
              Google
            </span>
          }
          label="Access method"
          value="Google-authenticated sign in"
        />
        <AuthInfoRow
          adornment={
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-foreground/68">
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
                  strokeWidth="1.4"
                />
              </svg>
            </span>
          }
          label="Next step"
          value="Create or join your organization"
        />
      </div>

      <form
        action={async () => {
          "use server";

          if (!googleAuthConfigured) {
            return;
          }

          const { signIn } = await import("@/auth");
          await signIn("google", { redirectTo: "/app" });
        }}
        className="mt-10"
      >
        <button
          className="inline-flex w-full items-center justify-center rounded-full bg-white px-6 py-4 text-sm font-semibold text-black transition hover:bg-white/92 disabled:cursor-not-allowed disabled:bg-white/16 disabled:text-white/55"
          disabled={!googleAuthConfigured}
          type="submit"
        >
          Continue with Google
        </button>
      </form>
    </AuthShell>
  );
}
