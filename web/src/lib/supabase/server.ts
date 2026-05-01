import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

import { getSupabaseAuthEnv } from "@/lib/server-env";

type CookieRecord = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

type CookieStore = Awaited<ReturnType<typeof cookies>>;

function createSupabaseClient(args: {
  getAll: () => Array<{ name: string; value: string }>;
  setAll: (cookiesToSet: CookieRecord[]) => void;
}) {
  const env = getSupabaseAuthEnv();

  return createServerClient(env.SUPABASE_URL, env.SUPABASE_AUTH_KEY, {
    cookies: {
      getAll: args.getAll,
      setAll: args.setAll,
    },
  });
}

function setCookie(
  cookieStore: CookieStore | NextResponse["cookies"],
  cookie: CookieRecord,
) {
  cookieStore.set(cookie.name, cookie.value, cookie.options);
}

export async function createClient() {
  const cookieStore = await cookies();

  return createSupabaseClient({
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet) {
      try {
        for (const cookie of cookiesToSet) {
          setCookie(cookieStore, cookie);
        }
      } catch {
        // Server Components cannot always write cookies. Proxy refresh handles it.
      }
    },
  });
}

export function createRouteHandlerClient(
  request: NextRequest,
  response: NextResponse,
) {
  return createSupabaseClient({
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet) {
      for (const { name, value } of cookiesToSet) {
        request.cookies.set(name, value);
      }

      for (const cookie of cookiesToSet) {
        setCookie(response.cookies, cookie);
      }
    },
  });
}
