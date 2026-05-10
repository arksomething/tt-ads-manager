import { requireOrganizationMembership } from "@/server/auth/organizations";

import {
  enqueueViralPostEnrichments,
  getViralPostAttributions,
  type ViralPostAttribution,
} from "./viral-post-enrichment";
import type { TikTokSingularReportRow } from "./reporting";

export type SingularViralTikTokPostAttribution = ViralPostAttribution;

export async function getViralTikTokPostAttributionsForSingularRows(
  organizationSlug: string,
  rows: readonly TikTokSingularReportRow[],
) {
  const membership = await requireOrganizationMembership(organizationSlug);
  const postIds = [
    ...new Set(
      rows
        .map((row) => row.tiktokPostId?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  await enqueueViralPostEnrichments({
    organizationId: membership.organizationId,
    platformVideoIds: postIds,
  });

  const attributions = await getViralPostAttributions({
    organizationId: membership.organizationId,
    platformVideoIds: postIds,
  });

  return {
    attributions,
    postIdCount: postIds.length,
    matchedPostCount: attributions.size,
    pendingPostIds: postIds.filter((postId) => !attributions.has(postId)),
    warnings: [] as string[],
  };
}
