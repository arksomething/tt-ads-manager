import { z } from "zod";

const LOWERCASE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_TIMESTAMP_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const ISSUE_CODE = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$/;

export const CREATOR_TRACKER_MONITOR_PATH =
  "/api/v1/creator-tracker/heartbeat";
export const CREATOR_TRACKER_MONITOR_ID = "creator-tracker-xps";
export const CREATOR_TRACKER_MONITOR_MAX_BODY_BYTES = 8 * 1024;
export const CREATOR_TRACKER_MONITOR_MAX_CLOCK_SKEW_SECONDS = 300;

const timestamp = z
  .string()
  .max(35)
  .regex(ISO_TIMESTAMP_WITH_OFFSET, "must be an ISO-8601 timestamp with an offset")
  .refine((value) => Number.isFinite(Date.parse(value)), "must be a real timestamp");

export const creatorTrackerMonitorHeartbeatSchema = z
  .object({
    schemaVersion: z.literal(1),
    monitorId: z.literal(CREATOR_TRACKER_MONITOR_ID),
    bootId: z.string().regex(LOWERCASE_UUID, "must be a lowercase UUID"),
    sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    observedAt: timestamp,
    status: z.enum(["healthy", "degraded", "failing"]),
    issueCodes: z
      .array(z.string().regex(ISSUE_CODE, "must be a lowercase issue code"))
      .max(32)
      .refine((values) => new Set(values).size === values.length, {
        message: "issue codes must be unique",
      }),
    releaseId: z.string().regex(RELEASE_ID).nullable(),
  })
  .strict();

export type CreatorTrackerMonitorHeartbeat = z.infer<
  typeof creatorTrackerMonitorHeartbeatSchema
>;
