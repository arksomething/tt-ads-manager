import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthFormShell } from "@/components/auth-form-shell";
import { PasswordField } from "@/components/password-field";
import { getSearchParamValue } from "@/lib/auth-navigation";
import { hasSupabaseAuthEnv } from "@/lib/server-env";
import {
  parsePasswordRecoveryProof,
  passwordRecoveryCookieName,
} from "@/server/auth/recovery";

export const metadata: Metadata = {
  title: "Choose a new password",
};

export const dynamic = "force-dynamic";

type ResetPasswordPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const configured = hasSupabaseAuthEnv();
  const cookieStore = await cookies();
  const recoveryProof = parsePasswordRecoveryProof(
    cookieStore.get(passwordRecoveryCookieName)?.value,
  );

  if (!configured || !recoveryProof) {
    redirect(
      "/auth/forgot-password?error=" +
        encodeURIComponent("Request a fresh password-reset link to continue."),
    );
  }

  return (
    <AuthFormShell
      eyebrow="Account recovery"
      title="Choose a new password."
      description="Choose a password you do not use on another service. Your reset link will be verified when you save it."
      error={getSearchParamValue(params, "error")}
      footer={<Link href="/auth/sign-in">Cancel reset and return to sign in</Link>}
    >
      <form className="auth-form" action="/api/auth/reset-password" method="post">
        <PasswordField
          autoComplete="new-password"
          label="New password"
          minLength={10}
          name="password"
          placeholder="At least 10 characters"
          required
        />
        <PasswordField
          autoComplete="new-password"
          label="Confirm new password"
          minLength={10}
          name="passwordConfirm"
          placeholder="Enter it again"
          required
        />
        <button className="button button--ink button--large" type="submit">
          Save new password
        </button>
      </form>
    </AuthFormShell>
  );
}
