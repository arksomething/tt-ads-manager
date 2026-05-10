import { NextResponse } from "next/server";

import { getViewsBaseCredentials } from "@/server/settings/managed-secrets";
import { getViewsBaseFacelessReport } from "@/server/viewsbase/report";

type RouteContext = {
  params: Promise<{
    organizationSlug: string;
  }>;
};

function getParam(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key)?.trim();
  return value ? value : undefined;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load ViewsBase report.";
}

export async function GET(request: Request, context: RouteContext) {
  const { organizationSlug } = await context.params;
  const url = new URL(request.url);

  try {
    const viewsBaseCredentials = await getViewsBaseCredentials(organizationSlug);
    const remoteOrgSlug =
      getParam(url.searchParams, "orgSlug") ??
      (viewsBaseCredentials.configured
        ? viewsBaseCredentials.value.defaultOrgSlug
        : null) ??
      "gotall";
    const campaignSlug = getParam(url.searchParams, "campaignSlug") ?? "all";
    const report = await getViewsBaseFacelessReport({
      organizationSlug,
      remoteOrgSlug,
      campaignSlug,
      startDate: getParam(url.searchParams, "startDate"),
      endDate: getParam(url.searchParams, "endDate"),
    });

    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      {
        error: getErrorMessage(error),
      },
      {
        status: 500,
      },
    );
  }
}
