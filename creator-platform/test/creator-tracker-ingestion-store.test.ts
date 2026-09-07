import { describe, expect, it } from "vitest";

import { creatorTrackerIngestionSchema } from "@/lib/creator-tracker/ingestion-contract";
import {
  applyCreatorTrackerDerivedRegressions,
  CreatorTrackerIngestionStoreError,
  resolveCreatorTrackerVideoFirstSeenRows,
} from "@/server/creator-tracker/ingestion-store";

import { fullCreatorTrackerPayload } from "./creator-tracker-fixture";

const missingHistoricalRunId = "018f0000-0000-7000-8000-00000000000b";
const replacementClaimId = "018f0000-0000-7000-8000-00000000000c";

function parsedVideo() {
  const payload = creatorTrackerIngestionSchema.parse(
    fullCreatorTrackerPayload(),
  );
  return { payload, video: payload.videos[0], runId: payload.runs[0].id };
}

function existingVideo(
  video: ReturnType<typeof parsedVideo>["video"],
  firstSeenRunId: string,
) {
  return {
    id: video.id,
    firstSeenAt: video.firstSeenAt,
    firstSeenRunId,
    captionFirst: video.captionFirst,
    hashtagsFirst: [...video.hashtagsFirst],
  };
}

describe("normalized creator video first-seen lineage", () => {
  it("keeps a claimed first-seen run when that run is durably available", () => {
    const { payload, video, runId } = parsedVideo();
    const [resolved] = resolveCreatorTrackerVideoFirstSeenRows(
      [video],
      [],
      new Set([runId]),
      payload.batch.id,
    );

    expect(resolved.firstSeenRunId).toBe(runId);
    expect(resolved.metadata._creatorTrackerIngestion).toMatchObject({
      batchId: payload.batch.id,
      runId,
      claimedFirstSeenRunId: runId,
      firstSeenRunResolution: "claimed_run",
    });
  });

  it("uses the signed page run when a laptop-only historical run was never exported", () => {
    const { payload, video, runId } = parsedVideo();
    const [resolved] = resolveCreatorTrackerVideoFirstSeenRows(
      [{ ...video, firstSeenRunId: missingHistoricalRunId }],
      [],
      new Set([runId]),
      payload.batch.id,
    );

    expect(resolved.firstSeenRunId).toBe(runId);
    expect(resolved.metadata._creatorTrackerIngestion).toMatchObject({
      claimedFirstSeenRunId: missingHistoricalRunId,
      firstSeenRunResolution: "canonical_evidence_fallback",
    });
  });

  it("preserves the resolved canonical run as the authority on later pages", () => {
    const { payload, video, runId } = parsedVideo();
    const [resolved] = resolveCreatorTrackerVideoFirstSeenRows(
      [{ ...video, firstSeenRunId: missingHistoricalRunId }],
      [
        existingVideo(video, runId),
      ],
      new Set([runId]),
      payload.batch.id,
    );

    expect(resolved.firstSeenRunId).toBe(runId);
    expect(resolved.metadata._creatorTrackerIngestion).toMatchObject({
      claimedFirstSeenRunId: missingHistoricalRunId,
      firstSeenRunResolution: "existing_canonical_authority",
    });
  });

  it("keeps the existing canonical run when a later collector claim differs", () => {
    const { payload, video, runId } = parsedVideo();
    const [resolved] = resolveCreatorTrackerVideoFirstSeenRows(
      [{ ...video, firstSeenRunId: replacementClaimId }],
      [existingVideo(video, runId)],
      new Set([runId]),
      payload.batch.id,
    );

    expect(resolved.firstSeenRunId).toBe(runId);
    expect(resolved.metadata._creatorTrackerIngestion).toMatchObject({
      claimedFirstSeenRunId: replacementClaimId,
      firstSeenRunResolution: "existing_canonical_authority",
    });
  });

  it("preserves first-seen hashtags already committed for an existing video", () => {
    const { payload, video, runId } = parsedVideo();
    const [resolved] = resolveCreatorTrackerVideoFirstSeenRows(
      [{ ...video, hashtagsFirst: ["later", "claim"] }],
      [existingVideo(video, runId)],
      new Set([runId]),
      payload.batch.id,
    );

    expect(resolved.hashtagsFirst).toEqual(video.hashtagsFirst);
    expect(resolved.metadata._creatorTrackerIngestion).toMatchObject({
      historicalIdentityResolution: "existing_canonical_authority",
    });
  });

  it("rejects a video when neither claimed nor current evidence run exists", () => {
    const { payload, video } = parsedVideo();

    expect(() =>
      resolveCreatorTrackerVideoFirstSeenRows(
        [{ ...video, firstSeenRunId: missingHistoricalRunId }],
        [],
        new Set(),
        payload.batch.id,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<CreatorTrackerIngestionStoreError>>({
        code: "FIRST_SEEN_RUN_UNRESOLVED",
      }),
    );
  });
});

describe("normalized creator observation regressions", () => {
  it("uses the regression derived from canonical counter order", () => {
    const payload = creatorTrackerIngestionSchema.parse(
      fullCreatorTrackerPayload(),
    );
    const observation = payload.observations[0];
    expect(observation.counterRegression).toBe(false);

    const [resolved] = applyCreatorTrackerDerivedRegressions(
      [observation],
      [{ id: observation.id, computedRegression: true }],
    );

    expect(resolved.counterRegression).toBe(true);
    expect(resolved.views).toBe(observation.views);
    expect(resolved.observedAt).toBe(observation.observedAt);
  });

  it("fails closed when the database does not derive every observation", () => {
    const payload = creatorTrackerIngestionSchema.parse(
      fullCreatorTrackerPayload(),
    );

    expect(() =>
      applyCreatorTrackerDerivedRegressions(payload.observations, []),
    ).toThrowError(
      expect.objectContaining<Partial<CreatorTrackerIngestionStoreError>>({
        code: "COUNTER_REGRESSION_DERIVATION_INCOMPLETE",
      }),
    );
  });
});
