import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

import { getSupabasePublicEnv } from "@/lib/server-env";

type CookieRecord = {
  name: string;
  value: string;
  options: CookieOptions;
};

function makeClient(args: {
  getAll: () => Array<{ name: string; value: string }>;
  setAll: (
    cookiesToSet: CookieRecord[],
    headers: Record<string, string>,
  ) => void;
}) {
  const env = getSupabasePublicEnv();

  return createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll: args.getAll,
      setAll: args.setAll,
    },
  });
}

export async function createClient() {
  const cookieStore = await cookies();

  return makeClient({
    getAll: () => cookieStore.getAll(),
    setAll(cookiesToSet) {
      try {
        for (const cookie of cookiesToSet) {
          cookieStore.set(cookie.name, cookie.value, cookie.options);
        }
      } catch {
        // Server Components cannot always write cookies. The request proxy is
        // responsible for refreshing and persisting sessions in that case.
      }
    },
  });
}

export function createRouteHandlerClient(
  request: NextRequest,
  response: NextResponse,
) {
  return makeClient({
    getAll: () => request.cookies.getAll(),
    setAll(cookiesToSet, headers) {
      for (const { name, value } of cookiesToSet) {
        request.cookies.set(name, value);
      }

      for (const cookie of cookiesToSet) {
        response.cookies.set(cookie.name, cookie.value, cookie.options);
      }

      for (const [key, value] of Object.entries(headers)) {
        response.headers.set(key, value);
      }
    },
  });
}

export function copySupabaseResponseState(
  source: NextResponse,
  target: NextResponse,
) {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }

  for (const key of ["cache-control", "expires", "pragma"]) {
    const value = source.headers.get(key);
    if (value) target.headers.set(key, value);
  }

  return target;
}
