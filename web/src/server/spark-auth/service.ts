import { SparkAuthorizationStatus } from "@/lib/prisma-shim";

import { prisma } from "@/lib/db";
import { hashSparkCode } from "@/server/messaging/parser";
import {
  requestTikTokBusinessApi,
  TikTokBusinessApiError,
} from "@/server/tiktok-business/client";

type TikTokAuthPayload = Record<string, unknown> | null;

type ApplySparkAuthorizationArgs = {
  organizationId: string;
  creatorId: string;
  videoId: string | null;
  sparkCodeRequestId: string | null;
  advertiserId: string;
  accessToken: string;
  codeCandidates: string[];
};

type ApplySparkAuthorizationResult =
  | {
      ok: true;
      authorizationId: string;
      tiktokItemId: string | null;
      authEndTime: Date | null;
    }
  | {
      ok: false;
      error: string;
    };

function getFirstString(payloads: TikTokAuthPayload[], keys: string[]) {
  for (const payload of payloads) {
    if (!payload) {
      continue;
    }

    for (const key of keys) {
      const value = payload[key];

      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }

  return null;
}

function getFirstNumber(payloads: TikTokAuthPayload[], keys: string[]) {
  for (const payload of payloads) {
    if (!payload) {
      continue;
    }

    for (const key of keys) {
      const value = payload[key];
      const numberValue =
        typeof value === "number"
          ? value
          : typeof value === "string"
            ? Number(value)
            : null;

      if (typeof numberValue === "number" && Number.isFinite(numberValue)) {
        return numberValue;
      }
    }
  }

  return null;
}

function epochSecondsToDate(value: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return new Date(value * 1000);
}

function extractErrorMessage(error: unknown) {
  if (error instanceof TikTokBusinessApiError) {
    return error.message;
  }

  return error instanceof Error ? error.message : "Spark authorization failed.";
}

async function persistSparkAuthorization(args: {
  organizationId: string;
  creatorId: string;
  videoId: string | null;
  sparkCodeRequestId: string | null;
  advertiserId: string;
  authCodeHash: string;
  status: SparkAuthorizationStatus;
  lastError: string | null;
  authorizePayload: TikTokAuthPayload;
  infoPayload: TikTokAuthPayload;
}) {
  const payloads = [args.infoPayload, args.authorizePayload];
  const identityType = getFirstString(payloads, ["identity_type", "identityType"]);
  const identityId = getFirstString(payloads, ["identity_id", "identityId"]);
  const identityAuthorizedBcId = getFirstString(payloads, [
    "identity_authorized_bc_id",
    "identityAuthorizedBcId",
  ]);
  const tiktokItemId = getFirstString(payloads, ["item_id", "itemId"]);
  const authStartTime = epochSecondsToDate(
    getFirstNumber(payloads, ["auth_start_time", "authStartTime"]),
  );
  const authEndTime = epochSecondsToDate(
    getFirstNumber(payloads, ["auth_end_time", "authEndTime"]),
  );

  return prisma.sparkAuthorization.upsert({
    where: {
      organizationId_advertiserId_authCodeHash: {
        organizationId: args.organizationId,
        advertiserId: args.advertiserId,
        authCodeHash: args.authCodeHash,
      },
    },
    update: {
      creatorId: args.creatorId,
      videoId: args.videoId,
      sparkCodeRequestId: args.sparkCodeRequestId,
      identityType,
      identityId,
      identityAuthorizedBcId,
      tiktokItemId,
      authStartTime,
      authEndTime,
      status: args.status,
      lastError: args.lastError,
    },
    create: {
      organizationId: args.organizationId,
      creatorId: args.creatorId,
      videoId: args.videoId,
      sparkCodeRequestId: args.sparkCodeRequestId,
      advertiserId: args.advertiserId,
      authCodeHash: args.authCodeHash,
      identityType,
      identityId,
      identityAuthorizedBcId,
      tiktokItemId,
      authStartTime,
      authEndTime,
      status: args.status,
      lastError: args.lastError,
    },
    select: {
      id: true,
      tiktokItemId: true,
      authEndTime: true,
    },
  });
}

export async function applySparkAuthorizationFromCandidates(
  args: ApplySparkAuthorizationArgs,
): Promise<ApplySparkAuthorizationResult> {
  if (args.codeCandidates.length === 0) {
    return {
      ok: false,
      error: "No Spark code candidates were provided.",
    };
  }

  let lastError = "Spark authorization failed.";

  for (const candidate of args.codeCandidates) {
    const authCodeHash = hashSparkCode(candidate);

    try {
      const authorizePayload = await requestTikTokBusinessApi<TikTokAuthPayload>({
        accessToken: args.accessToken,
        method: "POST",
        path: "/open_api/v1.3/tt_video/authorize/",
        body: {
          advertiser_id: args.advertiserId,
          auth_code: candidate,
        },
      });
      const infoPayload = await requestTikTokBusinessApi<TikTokAuthPayload>({
        accessToken: args.accessToken,
        method: "GET",
        path: "/open_api/v1.3/tt_video/info/",
        query: {
          advertiser_id: args.advertiserId,
          auth_code: candidate,
        },
      });
      const authorization = await persistSparkAuthorization({
        organizationId: args.organizationId,
        creatorId: args.creatorId,
        videoId: args.videoId,
        sparkCodeRequestId: args.sparkCodeRequestId,
        advertiserId: args.advertiserId,
        authCodeHash,
        status: SparkAuthorizationStatus.AUTHORIZED,
        lastError: null,
        authorizePayload,
        infoPayload,
      });

      return {
        ok: true,
        authorizationId: authorization.id,
        tiktokItemId: authorization.tiktokItemId,
        authEndTime: authorization.authEndTime,
      };
    } catch (error) {
      lastError = extractErrorMessage(error);

      await persistSparkAuthorization({
        organizationId: args.organizationId,
        creatorId: args.creatorId,
        videoId: args.videoId,
        sparkCodeRequestId: args.sparkCodeRequestId,
        advertiserId: args.advertiserId,
        authCodeHash,
        status: SparkAuthorizationStatus.FAILED,
        lastError,
        authorizePayload: null,
        infoPayload: null,
      });
    }
  }

  return {
    ok: false,
    error: lastError,
  };
}
