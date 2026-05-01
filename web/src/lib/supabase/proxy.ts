import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseAuthEnv } from "@/lib/server-env";

type CookieRecord = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

function setResponseCookie(
  response: NextResponse,
  cookie: CookieRecord,
) {
  response.cookies.set(cookie.name, cookie.value, cookie.options);
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  const env = getSupabaseAuthEnv();
  const supabase = createServerClient(
    env.SUPABASE_URL,
    env.SUPABASE_AUTH_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }

          response = NextResponse.next({
            request,
          });

          for (const cookie of cookiesToSet) {
            setResponseCookie(response, cookie);
          }
        },
      },
    },
  );

  await supabase.auth.getClaims();

  return response;
}
