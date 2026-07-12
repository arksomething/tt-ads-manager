import { NextResponse } from "next/server";

import {
  getCreatorPortalSessionCookie,
  resolveCreatorPortalAccessByLinkToken,
} from "@/server/creator-portal/access";

function buildCreatorRedirectUrl(request: Request) {
  const requestUrl = new URL(request.url);
  const searchParams = new URLSearchParams();

  for (const key of ["startDate", "endDate", "payMode", "viewWindowMode"]) {
    const value = requestUrl.searchParams.get(key)?.trim();

    if (value) {
      searchParams.set(key, value);
    }
  }

  const query = searchParams.toString();
  return new URL(query ? `/creator?${query}` : "/creator", request.url);
}

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

  const response = NextResponse.redirect(buildCreatorRedirectUrl(request));
  const sessionCookie = getCreatorPortalSessionCookie(access.id as string);
  response.cookies.set(
    sessionCookie.name,
    sessionCookie.value,
    sessionCookie.options,
  );
  return response;
}
