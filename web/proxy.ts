import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // Collector batches use a body-bound HMAC and a dedicated RLS-constrained
  // database login. Do not run cookie/session middleware on this machine route.
  if (
    request.nextUrl.pathname ===
    "/api/v1/creator-tracker/ingestion/batches"
  ) {
    return NextResponse.next();
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
