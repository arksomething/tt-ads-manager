// Inventory and first-window evidence come from the owned tracker. Provider
// observations and lifetime counters cannot silently replace cutoff evidence.
export type OwnedObservation = {
  id: number; observed_at: number; source_observed_at: number | null;
  confidence: string; is_complete: number | boolean; views: number | null;
  availability: string; source: string; evidence_manifest_sha256: string | null;
};
export type OwnedVideo = {
  id: string; native_account_id: string; handle: string; platform: string;
  sourceVideoId: string; url: string; caption: string | null; publishedAt: number;
  excluded: boolean; availability: string; observations: OwnedObservation[];
  finalization: null | { status: string; cutoff_at: number; gross_views: number | null;
    selected_final_observation_id: number | null; policy_version: string;
    finalization_sha256: string | null; exception_code: string | null };
};
export type OwnedTrackerEvidence = {
  captured_at: number;
  accounts: { native_account_id: string; platform: string; handle: string }[];
  videos: OwnedVideo[];
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export function priceableOwnedWindow(video: OwnedVideo, args: {
  start: number; endExclusive: number; now: number; windowDays: number;
}) {
  if (!Number.isFinite(video.publishedAt) || !Number.isInteger(args.windowDays) || args.windowDays < 1 || args.windowDays > 90) {
    throw new Error('Invalid owned tracker publication or deal window.');
  }
  const cutoff = video.publishedAt + args.windowDays * DAY;
  if (video.publishedAt >= args.endExclusive || video.publishedAt > args.now || cutoff <= args.start) return null;
  const warnings: string[] = [];
  const observations = video.observations.filter(o => o.confidence === 'direct' &&
    Boolean(o.is_complete) && o.availability === 'available' &&
    typeof o.views === 'number' && o.views >= 0 &&
    (o.source_observed_at ?? o.observed_at) >= video.publishedAt &&
    (o.source_observed_at ?? o.observed_at) <= args.now
  ).sort((a,b)=>(a.source_observed_at ?? a.observed_at)-(b.source_observed_at ?? b.observed_at));
  const at = (o: OwnedObservation) => o.source_observed_at ?? o.observed_at;
  const end = Math.min(cutoff, args.endExclusive, args.now);
  const final = video.finalization;
  const finalObservation = observations.find(o=>o.id===final?.selected_final_observation_id);
  const validFinal = cutoff <= args.endExclusive && cutoff <= args.now &&
    final?.cutoff_at === cutoff && final.status === 'final' &&
    final.gross_views != null && final.finalization_sha256 && finalObservation &&
    finalObservation.views === final.gross_views && Math.abs(at(finalObservation)-cutoff) <= 3*HOUR;
  let state: string = 'accruing';
  let selected = validFinal ? finalObservation : observations.filter(o=>at(o)<=end).at(-1);
  if (!validFinal && cutoff <= end) {
    state='needs_review';
    warnings.push(`${video.sourceVideoId}: seven-day evidence is not finalized (${final?.exception_code ?? 'missing cutoff evidence'}); view earnings are provisional.`);
  } else if (validFinal) state='final';
  if (selected && !validFinal && end-at(selected)>24*HOUR) {
    warnings.push(`${video.sourceVideoId}: latest eligible direct observation is over 24 hours before the report cutoff.`);
  }
  const baseline = video.publishedAt >= args.start ? null : [...observations]
    .filter(o=>Math.abs(at(o)-args.start)<=3*HOUR && at(o)<=end)
    .sort((a,b)=>Math.abs(at(a)-args.start)-Math.abs(at(b)-args.start)||at(a)-at(b))[0];
  const baselineMissing = video.publishedAt < args.start && !baseline;
  if (baseline && at(baseline)!==args.start) warnings.push(`${video.sourceVideoId}: month-boundary split uses a direct observation ${Math.round((at(baseline)-args.start)/60_000)} minutes from midnight; carryover is approximate.`);
  if (baselineMissing) warnings.push(`${video.sourceVideoId}: month-boundary baseline unavailable; carryover view earnings are excluded pending review.`);
  if (!selected) {
    state='unavailable';
    warnings.push(`${video.sourceVideoId}: direct view evidence unavailable; fixed fee retained and view earnings excluded pending review.`);
  }
  const before = baseline?.views ?? 0;
  const grossEnd = selected?.views ?? null;
  if (grossEnd != null && grossEnd < before) {
    warnings.push(`${video.sourceVideoId}: counter regression across the period; view earnings excluded pending review.`);
    state='needs_review';selected=undefined;
  }
  const views = selected && !baselineMissing ? Math.max(0,(selected.views ?? 0)-before) : null;
  return {views, grossViewsBeforePeriod: before, grossViewsAtPeriodEnd: views == null ? before : before+views,
    state: baselineMissing ? 'needs_review' : state, warnings, cutoff,
    observationId: selected?.id ?? null, baselineObservationId: baseline?.id ?? null,
    observedAt: selected ? at(selected) : null, finalizationSha256: validFinal ? final?.finalization_sha256 : null};
}

export function verifyOwnedInventory(evidence: OwnedTrackerEvidence, nativeIds: string[], now: number) {
  if (!Number.isFinite(evidence.captured_at) || now-evidence.captured_at>5*60_000 || evidence.captured_at>now+60_000) throw new Error('Owned tracker snapshot is stale.');
  const wanted=new Set(nativeIds);
  if (!wanted.size || evidence.accounts.length!==wanted.size || new Set(evidence.accounts.map(a=>a.native_account_id)).size!==wanted.size || evidence.accounts.some(a=>a.platform!=='tiktok'||!wanted.has(a.native_account_id))) throw new Error('Owned tracker account scope mismatch.');
  const seen=new Set<string>();
  for(const video of evidence.videos) {
    if(video.platform!=='tiktok'||!wanted.has(video.native_account_id)||seen.has(video.sourceVideoId))throw new Error('Owned tracker video scope mismatch or duplicate.');
    seen.add(video.sourceVideoId);
  }
}
