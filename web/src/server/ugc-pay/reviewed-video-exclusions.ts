/** Explicit owner-authorized content reviews, not model-only payout decisions.
 * Reviewed 2026-09-24 against full videos / ordered carousel slides.
 * These stable IDs remain excluded if accounts are renamed or deals are added.
 * Evidence: payouts/content-reviews/2026-09-24-no-plug.json.
 */
export const REVIEWED_VIDEO_EXCLUSIONS = [
  { sourceVideoId: '7670592048327691542', reason: 'No GoTall plug: age-13 height chart. Existing August 7 exclusion confirmed.' },
  { sourceVideoId: '7671324275168578838', reason: 'No GoTall plug: age-12 height chart; no app, brand or CTA in the full video.' },
  { sourceVideoId: '7685429928845823253', reason: 'No GoTall plug: forearm-height carousel; all five slides reviewed.' },
  { sourceVideoId: '7686212723625037087', reason: 'No GoTall plug: generic growth advice. Caption hashtag alone does not supply the required in-video promotion.' },
  { sourceVideoId: '7688543691539090701', reason: 'No GoTall plug: generic posture advice; no app, brand or CTA in the full video.' },
  { sourceVideoId: '7685955530145205518', reason: 'Unrelated DUDE Wipes product promotion; no GoTall promotion.' },
  { sourceVideoId: '7686915834215714068', reason: 'Unrelated personal return-to-posting vlog; no GoTall promotion.' },
] as const;

type VideoIdentity = { organizationId?: string; sourceVideoId: string; videoUrl: string };
export function getReviewedVideoExclusion(identity: VideoIdentity) {
  if (identity.organizationId !== 'org_public_tt_ads_manager' || !/^\d+$/.test(identity.sourceVideoId)) return null;
  let url: URL;
  try { url = new URL(identity.videoUrl); } catch { return null; }
  if (!['www.tiktok.com', 'tiktok.com', 'm.tiktok.com'].includes(url.hostname) ||
      !new RegExp(`^/@[^/]+/(?:video|photo)/${identity.sourceVideoId}/?$`).test(url.pathname)) return null;
  return REVIEWED_VIDEO_EXCLUSIONS.find(row => row.sourceVideoId === identity.sourceVideoId) ?? null;
}

export function applyReviewedVideoExclusion<T extends {
  fixedFeePerVideo: number | null; cpmAmount: number; payoutCapPerVideo: number;
  viewCapPerVideo: number | null; perVideoCapScope: string; notes: string | null;
}>(deal: T, identity: VideoIdentity): T {
  const review = getReviewedVideoExclusion(identity);
  if (!review) return deal;
  return { ...deal, fixedFeePerVideo: 0, cpmAmount: 0, payoutCapPerVideo: 0,
    viewCapPerVideo: 0, perVideoCapScope: 'TOTAL', notes: `Not payable: ${review.reason}` };
}
