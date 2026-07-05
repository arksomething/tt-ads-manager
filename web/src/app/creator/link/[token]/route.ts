import { NextResponse } from "next/server";

import {
  getCreatorPortalSessionCookie,
  resolveCreatorPortalAccessByLinkToken,
} from "@/server/creator-portal/access";

export async function GET(
  request: Request,
  context: {
    params: Promise<{
      token: string;
    }>;
  },
) {
  const { token } = await context.params;
  const access = await resolveCreatorPortalAccessByLinkToken(token);

  if (!access?.id) {
    return NextResponse.redirect(new URL("/creator?error=invalid-link", request.url));
  }

  const response = NextResponse.redirect(new URL("/creator", request.url));
  const sessionCookie = getCreatorPortalSessionCookie(access.id as string);
  response.cookies.set(
    sessionCookie.name,
    sessionCookie.value,
    sessionCookie.options,
  );
  return response;
}
