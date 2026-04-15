import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { SchemaUnavailableError, db } from "@/lib/db";
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

function getAuthFallbackUserId(token: { sub?: unknown; email?: unknown }) {
  if (typeof token.sub === "string" && token.sub.length > 0) {
    return token.sub;
  }

  if (typeof token.email === "string" && token.email.length > 0) {
    return token.email;
  }

  return null;
}

async function syncAuthUserRecord(args: {
  email?: unknown;
  image?: unknown;
  name?: unknown;
}) {
  const authDb = db as any;
  const email =
    typeof args.email === "string" && args.email.trim().length > 0
      ? args.email.trim().toLowerCase()
      : null;

  if (!email) {
    return null;
  }

  const nextName =
    typeof args.name === "string" && args.name.trim().length > 0
      ? args.name.trim()
      : null;
  const nextImage =
    typeof args.image === "string" && args.image.trim().length > 0
      ? args.image.trim()
      : null;

  try {
    const existingUser = await authDb.user.findFirst({
      where: {
        email,
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
      },
    });

    if (existingUser) {
      const needsUpdate =
        existingUser.name !== nextName || existingUser.image !== nextImage;

      if (needsUpdate) {
        const updatedUser = await authDb.user.update({
          where: {
            id: existingUser.id,
          },
          data: {
            name: nextName,
            image: nextImage,
          },
          select: {
            id: true,
          },
        });

        return updatedUser?.id ?? existingUser.id;
      }

      return existingUser.id;
    }

    const createdUser = await authDb.user.create({
      data: {
        email,
        name: nextName,
        image: nextImage,
        emailVerified: new Date(),
      },
      select: {
        id: true,
      },
    });

    return createdUser?.id ?? null;
  } catch (error) {
    if (error instanceof SchemaUnavailableError) {
      return null;
    }

    throw error;
  }
}

export const isAuthConfigured = Boolean(
  !isGoogleAuthDisabled() &&
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
      const authCookies = getAuthCookieConfig(authEnv.AUTH_URL);

      return NextAuth({
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
          strategy: "jwt",
          maxAge: SESSION_MAX_AGE_SECONDS,
          updateAge: 60 * 60 * 24,
        },
        cookies: authCookies,
        callbacks: {
          async jwt({ token, user }) {
            if (user || !token.userId) {
              const syncedUserId = await syncAuthUserRecord({
                email: user?.email ?? token.email,
                image: user?.image ?? token.picture,
                name: user?.name ?? token.name,
              });

              token.userId = syncedUserId ?? getAuthFallbackUserId(token);
            }

            return token;
          },
          session({ session, token }) {
            if (session.user) {
              session.user.id =
                typeof token.userId === "string" && token.userId.length > 0
                  ? token.userId
                  : getAuthFallbackUserId(token) ?? "";
            }

            return session;
          },
        },
      });
    })()
  : createDisabledAuth();

export const { handlers, auth, signIn, signOut } = authModule;
