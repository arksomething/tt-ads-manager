import { redirect } from "next/navigation";

import { auth, isAuthConfigured } from "@/auth";
import { AuthInfoRow, AuthShell } from "@/components/auth/auth-shell";
import { isAuthDisabled } from "@/lib/server-env";

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
  const authDisabled = isAuthDisabled();
  const errorMessage = getSearchParamValue(resolvedSearchParams, "error");
  const noticeMessage = getSearchParamValue(resolvedSearchParams, "notice");

  if (authDisabled) {
    redirect("/app");
  }

  if (isAuthConfigured) {
    try {
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
      cardClassName="max-w-[32rem]"
      description={
        isAuthConfigured
          ? isSwitchAccountFlow
            ? "Sign in with another email and password combination to continue into your workspace."
            : "Use Supabase Auth email and password sign-in to enter your workspace. New users can create an account directly from this screen."
          : "The auth surface is ready. Add the required Supabase Auth environment variables to enable sign-in."
      }
      footer={
        isAuthConfigured
          ? isSwitchAccountFlow
            ? "After signing in, the app will return you to the workspace hub."
            : "If email confirmation is enabled in Supabase, account creation will pause until the email link is confirmed."
          : "Supabase Auth is currently disabled in this environment, so the page stays visible while setup is incomplete."
      }
      title="Welcome to Billion Views"
    >
      <div className="space-y-3">
        <AuthInfoRow
          adornment={
            <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[0.62rem] font-medium uppercase tracking-[0.18em] text-foreground/72">
              Supabase
            </span>
          }
          label="Access method"
          value="Supabase Auth email and password"
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
              ? "Enter the credentials for the account you want to use"
              : "Sign in or create an account, then open your workspace"
          }
        />
      </div>

      {errorMessage ? (
        <div className="mt-8 rounded-[1.2rem] border border-[#ff8f7c]/30 bg-[#ff8f7c]/10 px-4 py-3 text-sm text-[#ffd3cb]">
          {errorMessage}
        </div>
      ) : null}

      {noticeMessage ? (
        <div className="mt-8 rounded-[1.2rem] border border-[#90FF4D]/20 bg-[#90FF4D]/8 px-4 py-3 text-sm text-[#dff8c4]">
          {noticeMessage}
        </div>
      ) : null}

      <form
        action="/api/auth/password/sign-in"
        className="mt-8 space-y-4"
        method="post"
      >
        {isSwitchAccountFlow ? (
          <input name="mode" type="hidden" value="switch-account" />
        ) : null}

        <label className="block space-y-2">
          <span className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
            Email
          </span>
          <input
            autoCapitalize="none"
            autoComplete="email"
            className="w-full rounded-[1.15rem] border border-white/[0.08] bg-black/[0.28] px-4 py-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/68 focus:border-[#90FF4D]/28 focus:bg-black/[0.36]"
            defaultValue=""
            name="email"
            placeholder="you@company.com"
            required
            type="email"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-[0.62rem] uppercase tracking-[0.24em] text-muted-foreground">
            Password
          </span>
          <input
            autoComplete="current-password"
            className="w-full rounded-[1.15rem] border border-white/[0.08] bg-black/[0.28] px-4 py-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/68 focus:border-[#90FF4D]/28 focus:bg-black/[0.36]"
            minLength={6}
            name="password"
            placeholder="At least 6 characters"
            required
            type="password"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            className="inline-flex w-full items-center justify-center rounded-full border border-[#90FF4D]/24 bg-[#90FF4D]/90 px-6 py-4 text-sm font-semibold text-black transition hover:bg-[#A4FF68] disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/16 disabled:text-white/55"
            disabled={!isAuthConfigured}
            formAction="/api/auth/password/sign-in"
            formMethod="post"
            type="submit"
          >
            {isSwitchAccountFlow ? "Sign in to switch" : "Sign in"}
          </button>

          <button
            className="inline-flex w-full items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.04] px-6 py-4 text-sm font-semibold text-foreground transition hover:border-white/[0.18] hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:border-white/[0.08] disabled:bg-white/6 disabled:text-white/45"
            disabled={!isAuthConfigured}
            formAction="/api/auth/password/sign-up"
            formMethod="post"
            type="submit"
          >
            Create account
          </button>
        </div>
      </form>
    </AuthShell>
  );
}
