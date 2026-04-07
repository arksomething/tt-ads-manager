import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { getAuthEnv, isGoogleAuthDisabled } from "@/lib/server-env";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_FLOW_COOKIE_MAX_AGE_SECONDS = 60 * 15;
const AUTH_COOKIE_NAMESPACE = "billionviews";

function hasMinLength(value: string | undefined, minLength: number) {
  return typeof value === "string" && value.length >= minLength;
}

function getAuthCookieConfig(authUrl: string | undefined) {
  const useSecureCookies = authUrl
    ? authUrl.startsWith("https://")
    : process.env.NODE_ENV === "production";
  const cookiePrefix = useSecureCookies
    ? `__Secure-${AUTH_COOKIE_NAMESPACE}`
    : AUTH_COOKIE_NAMESPACE;
  const sharedCookieOptions = {
    httpOnly: true,
    path: "/" as const,
    sameSite: "lax" as const,
    secure: useSecureCookies,
  };

  return {
    sessionToken: {
      name: `${cookiePrefix}.session-token`,
      options: sharedCookieOptions,
    },
    callbackUrl: {
      name: `${cookiePrefix}.callback-url`,
      options: sharedCookieOptions,
    },
    csrfToken: {
      name: useSecureCookies
        ? `__Host-${AUTH_COOKIE_NAMESPACE}.csrf-token`
        : `${AUTH_COOKIE_NAMESPACE}.csrf-token`,
      options: sharedCookieOptions,
    },
    pkceCodeVerifier: {
      name: `${cookiePrefix}.pkce.code_verifier`,
      options: {
        ...sharedCookieOptions,
        maxAge: OAUTH_FLOW_COOKIE_MAX_AGE_SECONDS,
      },
    },
    state: {
      name: `${cookiePrefix}.state`,
      options: {
        ...sharedCookieOptions,
        maxAge: OAUTH_FLOW_COOKIE_MAX_AGE_SECONDS,
      },
    },
    nonce: {
      name: `${cookiePrefix}.nonce`,
      options: sharedCookieOptions,
    },
    webauthnChallenge: {
      name: `${cookiePrefix}.challenge`,
      options: {
        ...sharedCookieOptions,
        maxAge: OAUTH_FLOW_COOKIE_MAX_AGE_SECONDS,
      },
    },
  };
}

export const isAuthConfigured = Boolean(
  !isGoogleAuthDisabled() &&
    process.env.DATABASE_URL &&
    hasMinLength(process.env.AUTH_SECRET, 32) &&
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET,
);

function createDisabledAuth() {
  return {
    handlers: {
      GET() {
        return NextResponse.json(
          { error: "Authentication is not configured for this environment." },
          { status: 503 },
        );
      },
      POST() {
        return NextResponse.json(
          { error: "Authentication is not configured for this environment." },
          { status: 503 },
        );
      },
    },
    auth: async () => null,
    async signIn() {
      redirect("/login");
    },
    async signOut(options?: { redirectTo?: string }) {
      redirect(options?.redirectTo ?? "/");
    },
  };
}

const authModule = isAuthConfigured
  ? await (async () => {
      const authEnv = getAuthEnv();
      // Keep Billion Views sessions separate from other Auth.js apps on localhost.
      const authCookies = getAuthCookieConfig(authEnv.AUTH_URL);
      const [{ PrismaAdapter }, { prisma }] = await Promise.all([
        import("@auth/prisma-adapter"),
        import("@/lib/db"),
      ]);

      return NextAuth({
        adapter: PrismaAdapter(prisma),
        providers: [
          Google({
            clientId: authEnv.GOOGLE_CLIENT_ID,
            clientSecret: authEnv.GOOGLE_CLIENT_SECRET,
          }),
        ],
        secret: authEnv.AUTH_SECRET,
        pages: {
          signIn: "/login",
        },
        session: {
          strategy: "database",
          maxAge: SESSION_MAX_AGE_SECONDS,
          updateAge: 60 * 60 * 24,
        },
        cookies: authCookies,
        callbacks: {
          session({ session, user }) {
            if (session.user) {
              session.user.id = user.id;
            }

            return session;
          },
        },
      });
    })()
  : createDisabledAuth();

export const { handlers, auth, signIn, signOut } = authModule;
