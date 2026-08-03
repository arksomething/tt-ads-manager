// One-off validation: compare TikTok Ads API spark-post resolution against
// viral.app-sourced ViralPostEnrichment rows (ground truth) for gotall.
// Read-only: calls the resolver directly, never writes enrichment rows.
import { prisma } from "../src/lib/db";
import { resolveTikTokSparkPostsByItemIds } from "../src/server/tiktok-business/ad-manager-resolver";

const ORG_SLUG = "gotall";
const SAMPLE_LIMIT = 40;

function extractUsername(url: string | null) {
  const match = url?.match(/\/@([^/?#]+)\/video\//i);
  return match ? decodeURIComponent(match[1]).toLowerCase() : null;
}

function decodePostedAt(id: string) {
  if (!/^\d{15,20}$/.test(id)) return null;
  return new Date(Number(BigInt(id) >> BigInt(32)) * 1000);
}

async function main() {
  const organization = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true },
  });
  if (!organization) throw new Error("org not found");

  const groundTruth = (await prisma.viralPostEnrichment.findMany({
    where: {
      organizationId: organization.id,
      platform: "tiktok",
      status: "SUCCEEDED",
    },
    orderBy: [{ lastFetchedAt: "desc" }],
  })) as Array<{
    platformVideoId: string;
    accountUsername: string | null;
    accountDisplayName: string | null;
    caption: string | null;
    publishedAt: Date | string | null;
    thumbnailUrl: string | null;
    videoUrl: string | null;
    viewCount: number | null;
    rawPayload: unknown;
  }>;

  const viralRows = groundTruth
    .filter((row) => {
      const payload = row.rawPayload as { source?: string } | null;
      return payload?.source !== "tiktok-ads-api";
    })
    .slice(0, SAMPLE_LIMIT);

  console.log(`ground truth rows (viral.app-sourced, SUCCEEDED): ${viralRows.length}`);
  if (viralRows.length === 0) {
    console.log("nothing to compare");
    return;
  }

  const lookup = await resolveTikTokSparkPostsByItemIds({
    organizationSlug: ORG_SLUG,
    itemIds: viralRows.map((row) => row.platformVideoId),
  });

  console.log(
    `ads api: knownItemIds=${lookup.knownItemIds.size} resolved=${lookup.postsByItemId.size} warnings=${JSON.stringify(lookup.warnings)}`,
  );

  let usernameMatches = 0;
  let usernameMismatches = 0;
  let publishedAtClose = 0;
  let publishedAtFar = 0;
  let captionOverlap = 0;
  let thumbPresent = 0;
  const problems: string[] = [];

  for (const row of viralRows) {
    const post = lookup.postsByItemId.get(row.platformVideoId);
    if (!post) continue;

    const adsUsername =
      post.identityUsername?.toLowerCase() ?? extractUsername(post.shareUrl);
    const truthUsername = row.accountUsername?.toLowerCase() ?? null;
    if (adsUsername && truthUsername) {
      if (adsUsername === truthUsername) usernameMatches += 1;
      else {
        usernameMismatches += 1;
        problems.push(
          `USERNAME ${row.platformVideoId}: ads=@${adsUsername} viral=@${truthUsername}`,
        );
      }
    }

    const decoded = decodePostedAt(row.platformVideoId);
    const truthPublished = row.publishedAt ? new Date(row.publishedAt) : null;
    if (decoded && truthPublished) {
      const deltaHours =
        Math.abs(decoded.getTime() - truthPublished.getTime()) / 3_600_000;
      if (deltaHours <= 48) publishedAtClose += 1;
      else {
        publishedAtFar += 1;
        problems.push(
          `PUBLISHED ${row.platformVideoId}: decoded=${decoded.toISOString()} viral=${truthPublished.toISOString()} (${deltaHours.toFixed(0)}h apart)`,
        );
      }
    }

    const adsCaption = post.title?.trim().toLowerCase() ?? "";
    const truthCaption = row.caption?.trim().toLowerCase() ?? "";
    if (adsCaption && truthCaption) {
      const shorter = adsCaption.length <= truthCaption.length ? adsCaption : truthCaption;
      const longer = adsCaption.length <= truthCaption.length ? truthCaption : adsCaption;
      if (longer.includes(shorter.slice(0, 40))) captionOverlap += 1;
      else problems.push(`CAPTION ${row.platformVideoId}: ads="${post.title}" viral="${row.caption}"`);
    }

    if (post.coverUrl) thumbPresent += 1;
  }

  console.log(
    JSON.stringify(
      {
        compared: viralRows.length,
        coverage: {
          knownToAdsAccount: lookup.knownItemIds.size,
          resolvedWithMetadata: lookup.postsByItemId.size,
        },
        username: { matches: usernameMatches, mismatches: usernameMismatches },
        publishedAtVsIdDecode: { within48h: publishedAtClose, beyond48h: publishedAtFar },
        captionOverlap,
        thumbnailsPresent: thumbPresent,
      },
      null,
      1,
    ),
  );

  if (problems.length > 0) {
    console.log("PROBLEMS:");
    for (const problem of problems) console.log("  " + problem);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
