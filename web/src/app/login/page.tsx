import { redirect } from "next/navigation";

import { AuthInfoRow, AuthShell } from "@/components/auth/auth-shell";
import { isGoogleAuthDisabled } from "@/lib/server-env";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getSearchParamValue(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const resolvedSearchParams = await searchParams;
  const isSwitchAccountFlow =
    getSearchParamValue(resolvedSearchParams, "mode") === "switch-account";
  const googleAuthDisabled = isGoogleAuthDisabled();
  const googleAuthConfigured = Boolean(
    !googleAuthDisabled &&
      process.env.AUTH_SECRET &&
      process.env.AUTH_SECRET.length >= 32 &&
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET,
  );

  if (googleAuthDisabled) {
    redirect("/app");
  }

  if (googleAuthConfigured) {
    try {
      const { auth } = await import("@/auth");
      const session = await auth();

      if (session?.user?.id && !isSwitchAccountFlow) {
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
          ? isSwitchAccountFlow
            ? "Choose a different Google account to continue into your workspace."
            : "Continue with Google to enter your workspace. If you do not have one yet, the app will create it automatically."
          : "The auth surface is ready. Add the required environment variables to enable Google sign-in."
      }
      footer={
        googleAuthConfigured
          ? isSwitchAccountFlow
            ? "You will be prompted to pick another Google account before returning to the app."
            : "By continuing, you agree to the product terms and privacy expectations for your workspace."
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
          value={
            isSwitchAccountFlow
              ? "Pick the Google account you want to use"
              : "Open your workspace or have one created for you"
          }
        />
      </div>

      <form
        action={async () => {
          "use server";

          if (!googleAuthConfigured) {
            return;
          }

          const { signIn } = await import("@/auth");
          if (isSwitchAccountFlow) {
            await signIn("google", { redirectTo: "/app" }, { prompt: "select_account" });
            return;
          }

          await signIn("google", { redirectTo: "/app" });
        }}
        className="mt-10"
      >
        <button
          className="inline-flex w-full items-center justify-center rounded-full border border-[#90FF4D]/24 bg-[#90FF4D]/90 px-6 py-4 text-sm font-semibold text-black transition hover:bg-[#A4FF68] disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/16 disabled:text-white/55"
          disabled={!googleAuthConfigured}
          type="submit"
        >
          {isSwitchAccountFlow
            ? "Choose a different Google account"
            : "Continue with Google"}
        </button>
      </form>
    </AuthShell>
  );
}
