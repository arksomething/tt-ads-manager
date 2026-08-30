import type { NextResponse } from "next/server";

export const passwordRecoveryCookieName = "gotall-password-recovery";

const maximumCredentialLength = 2_048;
const passwordRecoveryLifetimeSeconds = 10 * 60;
const flowIdPattern = /^[a-zA-Z0-9_-]{8,64}$/u;

export type PasswordRecoveryProof =
  | {
      method: "pkce";
      credential: string;
      flowId: string | null;
    }
  | {
      method: "otp";
      credential: string;
    };

function validCredential(value: unknown) {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= maximumCredentialLength &&
    !/\s/u.test(value)
  );
}

export function serializePasswordRecoveryProof(proof: PasswordRecoveryProof) {
  return Buffer.from(JSON.stringify({ version: 1, ...proof }), "utf8").toString(
    "base64url",
  );
}

export function parsePasswordRecoveryProof(
  value: string | null | undefined,
): PasswordRecoveryProof | null {
  if (!value || value.length > 4_096) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Record<string, unknown>;

    if (parsed.version !== 1 || !validCredential(parsed.credential)) return null;

    if (parsed.method === "otp") {
      return { method: "otp", credential: parsed.credential as string };
    }

    if (
      parsed.method === "pkce" &&
      (parsed.flowId === null ||
        (typeof parsed.flowId === "string" && flowIdPattern.test(parsed.flowId)))
    ) {
      return {
        method: "pkce",
        credential: parsed.credential as string,
        flowId: parsed.flowId as string | null,
      };
    }
  } catch {
    // Invalid or attacker-controlled cookies are handled as missing proof.
  }

  return null;
}

function passwordRecoveryCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}

export function setPasswordRecoveryProof(
  response: NextResponse,
  proof: PasswordRecoveryProof,
) {
  const serializedProof = serializePasswordRecoveryProof(proof);
  if (!parsePasswordRecoveryProof(serializedProof)) return false;

  response.cookies.set(
    passwordRecoveryCookieName,
    serializedProof,
    passwordRecoveryCookieOptions(passwordRecoveryLifetimeSeconds),
  );
  return true;
}

export function clearPasswordRecoveryProof(response: NextResponse) {
  response.cookies.set(
    passwordRecoveryCookieName,
    "",
    passwordRecoveryCookieOptions(0),
  );
}
