import type { User as SupabaseUser } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SchemaUnavailableError, db } from "@/lib/db";
import {
  getAuthEnv,
  hasSupabaseAuthEnv,
  isAuthDisabled,
} from "@/lib/server-env";
import { createClient } from "@/lib/supabase/server";

type SyncedUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
};

type AuthenticatedUser = SyncedUser & {
  supabaseUserId: string;
};

type AuthSession = {
  user: AuthenticatedUser;
};

function normalizeEmail(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().toLowerCase()
    : null;
}

function getMetadataString(
  metadata: Record<string, unknown> | undefined,
  keys: string[],
) {
  if (!metadata) {
    return null;
  }

  for (const key of keys) {
    const value = metadata[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function getSupabaseProfile(supabaseUser: SupabaseUser) {
  const metadata =
    supabaseUser.user_metadata &&
    typeof supabaseUser.user_metadata === "object" &&
    !Array.isArray(supabaseUser.user_metadata)
      ? (supabaseUser.user_metadata as Record<string, unknown>)
      : undefined;

  return {
    name: getMetadataString(metadata, [
      "name",
      "full_name",
      "display_name",
      "user_name",
      "username",
    ]),
    image: getMetadataString(metadata, [
      "avatar_url",
      "picture",
      "image",
      "photo_url",
    ]),
  };
}

async function getRequestOrigin() {
  const headerStore = await headers();
  const directOrigin = headerStore.get("origin");

  if (directOrigin) {
    return directOrigin;
  }

  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const proto =
    headerStore.get("x-forwarded-proto") ??
    (process.env.NODE_ENV === "development" ? "http" : "https");

  if (host) {
    return `${proto}://${host}`;
  }

  try {
    return getAuthEnv().AUTH_URL ?? null;
  } catch {
    return process.env.AUTH_URL ?? null;
  }
}

async function buildEmailRedirectTo(nextPath = "/app") {
  const origin = await getRequestOrigin();

  if (!origin) {
    return undefined;
  }

  const url = new URL("/auth/confirm", origin);
  url.searchParams.set("next", nextPath);
  return url.toString();
}

export async function syncAuthUserRecord(args: { supabaseUser: SupabaseUser }) {
  const email = normalizeEmail(args.supabaseUser.email);

  if (!email) {
    return null;
  }

  const profile = getSupabaseProfile(args.supabaseUser);
  const nextEmailVerified = args.supabaseUser.email_confirmed_at
    ? new Date(args.supabaseUser.email_confirmed_at)
    : null;

  try {
    const existingUser =
      (await db.user.findFirst({
        where: {
          id: args.supabaseUser.id,
        },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          emailVerified: true,
        },
      })) ??
      (await db.user.findFirst({
        where: {
          email: {
            equals: email,
            mode: "insensitive",
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          emailVerified: true,
        },
      }));

    if (existingUser) {
      const needsUpdate =
        existingUser.name !== profile.name ||
        existingUser.image !== profile.image ||
        normalizeEmail(existingUser.email) !== email ||
        (nextEmailVerified != null &&
          existingUser.emailVerified?.toISOString() !==
            nextEmailVerified.toISOString());

      if (needsUpdate) {
        return db.user.update({
          where: {
            id: existingUser.id,
          },
          data: {
            email,
            name: profile.name,
            image: profile.image,
            emailVerified:
              nextEmailVerified ?? existingUser.emailVerified ?? undefined,
          },
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
          },
        });
      }

      return {
        id: existingUser.id,
        name: existingUser.name,
        email: existingUser.email,
        image: existingUser.image,
      } satisfies SyncedUser;
    }

    return db.user.create({
      data: {
        id: args.supabaseUser.id,
        email,
        name: profile.name,
        image: profile.image,
        emailVerified: nextEmailVerified,
      },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
      },
    });
  } catch (error) {
    if (error instanceof SchemaUnavailableError) {
      return {
        id: args.supabaseUser.id,
        email,
        name: profile.name,
        image: profile.image,
      } satisfies SyncedUser;
    }

    throw error;
  }
}

export const isAuthConfigured = Boolean(
  !isAuthDisabled() && hasSupabaseAuthEnv(),
);

async function getSupabaseUser() {
  if (!isAuthConfigured) {
    return null;
  }

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError || !claimsData?.claims?.sub) {
    return null;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    return null;
  }

  return userData.user;
}

export async function auth(): Promise<AuthSession | null> {
  const supabaseUser = await getSupabaseUser();

  if (!supabaseUser) {
    return null;
  }

  const syncedUser = await syncAuthUserRecord({
    supabaseUser,
  });

  if (!syncedUser) {
    return null;
  }

  return {
    user: {
      id: syncedUser.id,
      name: syncedUser.name,
      email: syncedUser.email,
      image: syncedUser.image,
      supabaseUserId: supabaseUser.id,
    },
  };
}

export async function signInWithPassword(args: {
  email: string;
  password: string;
}) {
  if (!isAuthConfigured) {
    return {
      error: "Supabase Auth is not configured for this environment yet.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: args.email.trim().toLowerCase(),
    password: args.password,
  });

  if (error) {
    return {
      error: error.message,
    };
  }

  if (data.user) {
    await syncAuthUserRecord({
      supabaseUser: data.user,
    });
  }

  revalidatePath("/", "layout");

  return {
    error: null,
  };
}

export async function signUpWithPassword(args: {
  email: string;
  password: string;
  nextPath?: string;
}) {
  if (!isAuthConfigured) {
    return {
      error: "Supabase Auth is not configured for this environment yet.",
      requiresEmailConfirmation: false,
    };
  }

  const supabase = await createClient();
  const emailRedirectTo = await buildEmailRedirectTo(args.nextPath ?? "/app");
  const { data, error } = await supabase.auth.signUp({
    email: args.email.trim().toLowerCase(),
    password: args.password,
    options: emailRedirectTo
      ? {
          emailRedirectTo,
        }
      : undefined,
  });

  if (error) {
    return {
      error: error.message,
      requiresEmailConfirmation: false,
    };
  }

  if (data.session && data.user) {
    await syncAuthUserRecord({
      supabaseUser: data.user,
    });
  }

  revalidatePath("/", "layout");

  return {
    error: null,
    requiresEmailConfirmation: data.session == null,
  };
}

export async function signOut(options?: { redirectTo?: string }) {
  if (isAuthConfigured) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    revalidatePath("/", "layout");
  }

  redirect(options?.redirectTo ?? "/");
}
