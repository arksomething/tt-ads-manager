import { createHash, randomBytes } from "node:crypto";

import {
  MessageDirection,
  MessageParseStatus,
  MessageThreadState,
  MessagingChannel,
  type Prisma,
  SparkCodeRequestStatus,
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/lib/db";
import { requireOrganizationMembership } from "@/server/auth/organizations";
import { canManageOrganization } from "@/server/auth/roles";
import { parseSparkMessageBody } from "@/server/messaging/parser";
import { applySparkAuthorizationFromCandidates } from "@/server/spark-auth/service";

import {
  creatorContactPointSchema,
  organizationTikTokAccountSchema,
  organizationTwilioConfigSchema,
  sparkCodeRequestSchema,
  twilioTestMessageSchema,
} from "./schemas";
import { sendTwilioMessage } from "./twilio-client";

type TwilioPayload = Record<string, string>;

const removeCreatorContactPointSchema = z.object({
  contactPointId: z.string().trim().min(1),
});

function revalidateMessagingWorkspace(organizationSlug: string) {
  revalidatePath("/app");
  revalidatePath(`/org/${organizationSlug}`);
  revalidatePath(`/org/${organizationSlug}/integrations`);
  revalidatePath(`/org/${organizationSlug}/creators`);
  revalidatePath(`/org/${organizationSlug}/videos`);
  revalidatePath(`/org/${organizationSlug}/review`);
}

function normalizePhoneE164(value: string) {
  const trimmed = value.trim();
  const normalized = trimmed.replace(/[^\d+]/g, "");
  const withPrefix = normalized.startsWith("+") ? normalized : `+${normalized}`;

  if (!/^\+[1-9]\d{7,14}$/.test(withPrefix)) {
    throw new Error("Invalid phone number. Use E.164 format like +15551234567.");
  }

  return withPrefix;
}

function parseTwilioChannelAddress(value: string) {
  const trimmed = value.trim();

  if (trimmed.toLowerCase().startsWith("whatsapp:")) {
    return {
      channel: MessagingChannel.WHATSAPP,
      phoneE164: normalizePhoneE164(trimmed.slice("whatsapp:".length)),
    };
  }

  return {
    channel: MessagingChannel.SMS,
    phoneE164: normalizePhoneE164(trimmed),
  };
}

function getRequestToken() {
  return `BV-${randomBytes(3).toString("hex").toUpperCase()}`;
}

async function generateUniqueRequestToken() {
  let attempts = 0;

  while (attempts < 10) {
    attempts += 1;
    const token = getRequestToken();
    const existing = await prisma.sparkCodeRequest.findUnique({
      where: {
        requestToken: token,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return token;
    }
  }

  throw new Error("Could not allocate a unique Spark request token.");
}

function hashForTrace(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function buildSparkRequestMessage(args: {
  creatorName: string;
  requestToken: string;
  videoReference: string | null;
}) {
  const reference = args.videoReference ? ` for ${args.videoReference}` : "";
  return `Hi ${args.creatorName}, please send your TikTok Spark authorization code${reference}. Reply with the code and include token ${args.requestToken}.`;
}

async function getOrganizationTwilioConfigOrThrow(organizationId: string) {
  const config = await prisma.organizationTwilioConfig.findUnique({
    where: {
      organizationId,
    },
  });

  if (!config || !config.enabled) {
    throw new Error(
      "Twilio is not enabled for this organization. Configure it in Integrations first.",
    );
  }

  return config;
}

async function ensureCreatorMessageThread(args: {
  organizationId: string;
  creatorId: string | null;
  channel: MessagingChannel;
  contactPointId: string | null;
  state?: MessageThreadState;
  inboundAt?: Date;
  outboundAt?: Date;
}) {
  if (!args.creatorId) {
    return null;
  }

  const updateData: Prisma.CreatorMessageThreadUpdateInput = {};

  if (args.contactPointId) {
    updateData.contactPoint = {
      connect: {
        id: args.contactPointId,
      },
    };
  }

  if (args.state) {
    updateData.state = args.state;
  }

  if (args.inboundAt) {
    updateData.lastInboundAt = args.inboundAt;
  }

  if (args.outboundAt) {
    updateData.lastOutboundAt = args.outboundAt;
  }

  const createData: Prisma.CreatorMessageThreadCreateInput = {
    organization: {
      connect: {
        id: args.organizationId,
      },
    },
    creator: {
      connect: {
        id: args.creatorId,
      },
    },
    channel: args.channel,
    ...(args.contactPointId
      ? {
          contactPoint: {
            connect: {
              id: args.contactPointId,
            },
          },
        }
      : {}),
    ...(args.state ? { state: args.state } : {}),
    ...(args.inboundAt ? { lastInboundAt: args.inboundAt } : {}),
    ...(args.outboundAt ? { lastOutboundAt: args.outboundAt } : {}),
  };

  return prisma.creatorMessageThread.upsert({
    where: {
      creatorId_channel: {
        creatorId: args.creatorId,
        channel: args.channel,
      },
    },
    update: updateData,
    create: createData,
    select: {
      id: true,
    },
  });
}

async function createOutboundMessageEvent(args: {
  organizationId: string;
  creatorId: string | null;
  sparkCodeRequestId: string | null;
  threadId: string | null;
  contactPointId: string | null;
  channel: MessagingChannel;
  body: string;
  providerMessageSid: string;
  toE164: string;
  fromValue: string | null;
  rawPayload: Record<string, unknown>;
}) {
  const fromE164 =
    args.fromValue && args.fromValue.length > 0
      ? parseTwilioChannelAddress(args.fromValue).phoneE164
      : args.toE164;

  await prisma.creatorMessageEvent.create({
    data: {
      organizationId: args.organizationId,
      creatorId: args.creatorId,
      sparkCodeRequestId: args.sparkCodeRequestId,
      threadId: args.threadId,
      contactPointId: args.contactPointId,
      direction: MessageDirection.OUTBOUND,
      providerMessageSid: args.providerMessageSid,
      channel: args.channel,
      fromE164,
      toE164: args.toE164,
      body: args.body,
      parseStatus: MessageParseStatus.NOT_ATTEMPTED,
      rawPayload: args.rawPayload as Prisma.InputJsonValue,
    },
  });
}

async function sendAutomatedReply(args: {
  organizationId: string;
  creatorId: string | null;
  contactPointId: string | null;
  sparkCodeRequestId: string | null;
  threadId: string | null;
  channel: MessagingChannel;
  toE164: string;
  body: string;
}) {
  try {
    const config = await prisma.organizationTwilioConfig.findUnique({
      where: {
        organizationId: args.organizationId,
      },
      select: {
        messagingServiceSid: true,
        smsFrom: true,
        whatsappFrom: true,
      },
    });

    if (!config) {
      return;
    }

    const outbound = await sendTwilioMessage({
      channel: args.channel,
      toE164: args.toE164,
      body: args.body,
      config,
    });

    await createOutboundMessageEvent({
      organizationId: args.organizationId,
      creatorId: args.creatorId,
      sparkCodeRequestId: args.sparkCodeRequestId,
      threadId: args.threadId,
      contactPointId: args.contactPointId,
      channel: args.channel,
      body: args.body,
      providerMessageSid: outbound.sid,
      toE164: args.toE164,
      fromValue: outbound.from,
      rawPayload: {
        sid: outbound.sid,
        status: outbound.status,
      },
    });

    if (args.threadId) {
      await prisma.creatorMessageThread.update({
        where: {
          id: args.threadId,
        },
        data: {
          lastOutboundAt: new Date(),
        },
      });
    }
  } catch (error) {
    console.error("Automated Twilio reply failed", error);
  }
}

export async function upsertOrganizationTwilioConfigForOrganization(args: {
  organizationSlug: string;
  input: unknown;
}) {
  const membership = await requireOrganizationMembership(args.organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Integration access denied.");
  }

  const values = organizationTwilioConfigSchema.parse(args.input);
  const config = await prisma.organizationTwilioConfig.upsert({
    where: {
      organizationId: membership.organizationId,
    },
    update: {
      enabled: values.enabled,
      messagingServiceSid: values.messagingServiceSid ?? null,
      smsFrom: values.smsFrom ? normalizePhoneE164(values.smsFrom) : null,
      whatsappFrom: values.whatsappFrom
        ? normalizePhoneE164(values.whatsappFrom)
        : null,
    },
    create: {
      organizationId: membership.organizationId,
      enabled: values.enabled,
      messagingServiceSid: values.messagingServiceSid ?? null,
      smsFrom: values.smsFrom ? normalizePhoneE164(values.smsFrom) : null,
      whatsappFrom: values.whatsappFrom
        ? normalizePhoneE164(values.whatsappFrom)
        : null,
    },
  });

  revalidateMessagingWorkspace(args.organizationSlug);
  return config;
}

export async function upsertOrganizationTikTokAccountForOrganization(args: {
  organizationSlug: string;
  input: unknown;
}) {
  const membership = await requireOrganizationMembership(args.organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Integration access denied.");
  }

  const values = organizationTikTokAccountSchema.parse(args.input);
  const account = await prisma.organizationTikTokAccount.upsert({
    where: {
      organizationId_advertiserId: {
        organizationId: membership.organizationId,
        advertiserId: values.advertiserId,
      },
    },
    update: {
      accessToken: values.accessToken,
      refreshToken: null,
      tokenType: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: values.scope ?? undefined,
      status: values.status ?? "ACTIVE",
      lastValidatedAt: new Date(),
    },
    create: {
      organizationId: membership.organizationId,
      advertiserId: values.advertiserId,
      accessToken: values.accessToken,
      refreshToken: null,
      tokenType: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: values.scope ?? undefined,
      status: values.status ?? "ACTIVE",
      lastValidatedAt: new Date(),
    },
  });

  revalidateMessagingWorkspace(args.organizationSlug);
  return account;
}

export async function sendTwilioTestMessageForOrganization(args: {
  organizationSlug: string;
  input: unknown;
}) {
  const membership = await requireOrganizationMembership(args.organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Integration access denied.");
  }

  const values = twilioTestMessageSchema.parse(args.input);
  const config = await getOrganizationTwilioConfigOrThrow(membership.organizationId);
  const outbound = await sendTwilioMessage({
    channel: values.channel,
    toE164: values.toE164,
    body: values.body,
    config,
  });

  await createOutboundMessageEvent({
    organizationId: membership.organizationId,
    creatorId: null,
    sparkCodeRequestId: null,
    threadId: null,
    contactPointId: null,
    channel: values.channel,
    body: values.body,
    providerMessageSid: outbound.sid,
    toE164: values.toE164,
    fromValue: outbound.from,
    rawPayload: {
      sid: outbound.sid,
      status: outbound.status,
      testMessage: true,
    },
  });

  revalidateMessagingWorkspace(args.organizationSlug);
  return outbound;
}

export async function upsertCreatorContactPointForOrganization(args: {
  organizationSlug: string;
  input: unknown;
}) {
  const membership = await requireOrganizationMembership(args.organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Creator contact access denied.");
  }

  const values = creatorContactPointSchema.parse(args.input);
  const contactPoint = await prisma.$transaction(async (tx) => {
    const creator = await tx.creator.findFirst({
      where: {
        id: values.creatorId,
        organizationId: membership.organizationId,
      },
      select: {
        id: true,
      },
    });

    if (!creator) {
      throw new Error("Creator not found.");
    }

    const existingByPhone = await tx.creatorContactPoint.findUnique({
      where: {
        channel_phoneE164: {
          channel: values.channel,
          phoneE164: values.phoneE164,
        },
      },
      select: {
        id: true,
        creatorId: true,
      },
    });

    if (existingByPhone && existingByPhone.creatorId !== values.creatorId) {
      throw new Error(
        "That number is already linked to a different creator for this channel.",
      );
    }

    if (values.isPrimary) {
      await tx.creatorContactPoint.updateMany({
        where: {
          creatorId: values.creatorId,
          channel: values.channel,
          isPrimary: true,
        },
        data: {
          isPrimary: false,
        },
      });
    }

    if (existingByPhone) {
      return tx.creatorContactPoint.update({
        where: {
          id: existingByPhone.id,
        },
        data: {
          isPrimary: values.isPrimary,
          optInAt: new Date(),
          optOutAt: null,
        },
      });
    }

    return tx.creatorContactPoint.create({
      data: {
        creatorId: values.creatorId,
        channel: values.channel,
        phoneE164: values.phoneE164,
        isPrimary: values.isPrimary,
        optInAt: new Date(),
      },
    });
  });

  revalidateMessagingWorkspace(args.organizationSlug);
  return contactPoint;
}

export async function removeCreatorContactPointForOrganization(args: {
  organizationSlug: string;
  input: unknown;
}) {
  const membership = await requireOrganizationMembership(args.organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Creator contact access denied.");
  }

  const values = removeCreatorContactPointSchema.parse(args.input);
  const deleted = await prisma.creatorContactPoint.deleteMany({
    where: {
      id: values.contactPointId,
      creator: {
        organizationId: membership.organizationId,
      },
    },
  });

  if (deleted.count === 0) {
    throw new Error("Creator contact point not found.");
  }

  revalidateMessagingWorkspace(args.organizationSlug);
  return {
    removed: true,
  };
}

export async function sendSparkCodeRequestForOrganization(args: {
  organizationSlug: string;
  input: unknown;
}) {
  const membership = await requireOrganizationMembership(args.organizationSlug);

  if (!canManageOrganization(membership.role)) {
    throw new Error("Spark request access denied.");
  }

  const values = sparkCodeRequestSchema.parse(args.input);
  const creator = await prisma.creator.findFirst({
    where: {
      id: values.creatorId,
      organizationId: membership.organizationId,
    },
    select: {
      id: true,
      displayName: true,
      contactPoints: {
        where: {
          channel: values.channel,
          optOutAt: null,
        },
        orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }],
        select: {
          id: true,
          phoneE164: true,
          channel: true,
        },
      },
    },
  });

  if (!creator) {
    throw new Error("Creator not found.");
  }

  const selectedContactPoint = values.contactPointId
    ? creator.contactPoints.find((contactPoint) => contactPoint.id === values.contactPointId)
    : creator.contactPoints[0];

  if (!selectedContactPoint) {
    throw new Error(
      "No active contact point found for that creator/channel. Add one first.",
    );
  }

  const video = values.videoId
    ? await prisma.video.findFirst({
        where: {
          id: values.videoId,
          creatorId: creator.id,
          creator: {
            organizationId: membership.organizationId,
          },
        },
        select: {
          id: true,
          sourceVideoId: true,
          titleOrCaption: true,
        },
      })
    : null;

  if (values.videoId && !video) {
    throw new Error("Selected video was not found for this creator.");
  }

  const twilioConfig = await getOrganizationTwilioConfigOrThrow(membership.organizationId);
  const thread = await ensureCreatorMessageThread({
    organizationId: membership.organizationId,
    creatorId: creator.id,
    channel: values.channel,
    contactPointId: selectedContactPoint.id,
  });
  const requestToken = await generateUniqueRequestToken();
  const requestMessage =
    values.messageBody ??
    buildSparkRequestMessage({
      creatorName: creator.displayName,
      requestToken,
      videoReference: video?.sourceVideoId ?? video?.titleOrCaption ?? null,
    });
  const request = await prisma.sparkCodeRequest.create({
    data: {
      organizationId: membership.organizationId,
      creatorId: creator.id,
      videoId: video?.id ?? null,
      contactPointId: selectedContactPoint.id,
      threadId: thread?.id ?? null,
      channel: values.channel,
      requestToken,
      status: SparkCodeRequestStatus.PENDING,
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    },
    select: {
      id: true,
      requestToken: true,
    },
  });

  try {
    const outbound = await sendTwilioMessage({
      channel: values.channel,
      toE164: selectedContactPoint.phoneE164,
      body: requestMessage,
      config: twilioConfig,
    });

    await createOutboundMessageEvent({
      organizationId: membership.organizationId,
      creatorId: creator.id,
      sparkCodeRequestId: request.id,
      threadId: thread?.id ?? null,
      contactPointId: selectedContactPoint.id,
      channel: values.channel,
      body: requestMessage,
      providerMessageSid: outbound.sid,
      toE164: selectedContactPoint.phoneE164,
      fromValue: outbound.from,
      rawPayload: {
        sid: outbound.sid,
        status: outbound.status,
      },
    });

    if (thread?.id) {
      await prisma.creatorMessageThread.update({
        where: {
          id: thread.id,
        },
        data: {
          state: MessageThreadState.AWAITING_SPARK_CODE,
          lastOutboundAt: new Date(),
        },
      });
    }
  } catch (error) {
    await prisma.sparkCodeRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: SparkCodeRequestStatus.FAILED,
        failedAt: new Date(),
        lastError:
          error instanceof Error ? error.message : "Twilio request send failed.",
      },
    });
    throw error;
  }

  revalidateMessagingWorkspace(args.organizationSlug);
  return request;
}

async function resolveSparkCodeRequest(args: {
  organizationId: string;
  creatorId: string | null;
  channel: MessagingChannel;
  requestToken: string | null;
}) {
  if (args.requestToken) {
    const tokenMatch = await prisma.sparkCodeRequest.findUnique({
      where: {
        requestToken: args.requestToken,
      },
      select: {
        id: true,
        creatorId: true,
        status: true,
        threadId: true,
        videoId: true,
      },
    });

    if (
      tokenMatch &&
      tokenMatch.status !== SparkCodeRequestStatus.CANCELLED &&
      tokenMatch.status !== SparkCodeRequestStatus.EXPIRED &&
      (args.creatorId == null || tokenMatch.creatorId === args.creatorId) &&
      (tokenMatch.status === SparkCodeRequestStatus.PENDING ||
        tokenMatch.status === SparkCodeRequestStatus.RECEIVED)
    ) {
      return tokenMatch;
    }
  }

  if (!args.creatorId) {
    return null;
  }

  return prisma.sparkCodeRequest.findFirst({
    where: {
      organizationId: args.organizationId,
      creatorId: args.creatorId,
      channel: args.channel,
      status: {
        in: [SparkCodeRequestStatus.PENDING, SparkCodeRequestStatus.RECEIVED],
      },
      OR: [
        {
          expiresAt: null,
        },
        {
          expiresAt: {
            gt: new Date(),
          },
        },
      ],
    },
    orderBy: [{ requestedAt: "desc" }],
    select: {
      id: true,
      creatorId: true,
      status: true,
      threadId: true,
      videoId: true,
    },
  });
}

export async function processInboundTwilioWebhookPayload(args: {
  payload: TwilioPayload;
}) {
  const messageSid = args.payload.MessageSid?.trim();
  const fromAddress = args.payload.From?.trim();
  const toAddress = args.payload.To?.trim();
  const body = (args.payload.Body ?? "").trim();

  if (!messageSid || !fromAddress || !toAddress) {
    return {
      handled: false,
      reason: "missing-core-fields",
    } as const;
  }

  const existingEvent = await prisma.creatorMessageEvent.findUnique({
    where: {
      providerMessageSid: messageSid,
    },
    select: {
      id: true,
    },
  });

  if (existingEvent) {
    return {
      handled: true,
      duplicate: true,
    } as const;
  }

  const sourceAddress = parseTwilioChannelAddress(fromAddress);
  const destinationAddress = parseTwilioChannelAddress(toAddress);
  const channel = sourceAddress.channel;
  const contactPoint = await prisma.creatorContactPoint.findUnique({
    where: {
      channel_phoneE164: {
        channel,
        phoneE164: sourceAddress.phoneE164,
      },
    },
    include: {
      creator: {
        select: {
          id: true,
          displayName: true,
          organizationId: true,
        },
      },
    },
  });
  const destinationOrgConfig =
    channel === MessagingChannel.WHATSAPP
      ? await prisma.organizationTwilioConfig.findFirst({
          where: {
            enabled: true,
            whatsappFrom: destinationAddress.phoneE164,
          },
          select: {
            organizationId: true,
          },
        })
      : await prisma.organizationTwilioConfig.findFirst({
          where: {
            enabled: true,
            smsFrom: destinationAddress.phoneE164,
          },
          select: {
            organizationId: true,
          },
        });
  const organizationId =
    contactPoint?.creator.organizationId ?? destinationOrgConfig?.organizationId ?? null;

  if (!organizationId) {
    return {
      handled: false,
      reason: "unknown-organization",
    } as const;
  }

  const parsed = parseSparkMessageBody(body);
  const sparkCodeRequest = await resolveSparkCodeRequest({
    organizationId,
    creatorId: contactPoint?.creator.id ?? null,
    channel,
    requestToken: parsed.requestToken,
  });
  const thread = await ensureCreatorMessageThread({
    organizationId,
    creatorId: contactPoint?.creator.id ?? sparkCodeRequest?.creatorId ?? null,
    channel,
    contactPointId: contactPoint?.id ?? null,
    inboundAt: new Date(),
  });
  const threadId = sparkCodeRequest?.threadId ?? thread?.id ?? null;

  if (sparkCodeRequest?.id && threadId && sparkCodeRequest.threadId !== threadId) {
    await prisma.sparkCodeRequest.update({
      where: {
        id: sparkCodeRequest.id,
      },
      data: {
        threadId,
      },
    });
  }

  const firstCodeCandidateHash =
    parsed.candidates.length > 0 ? hashForTrace(parsed.candidates[0]) : null;
  const event = await prisma.creatorMessageEvent.create({
    data: {
      organizationId,
      creatorId: contactPoint?.creator.id ?? sparkCodeRequest?.creatorId ?? null,
      sparkCodeRequestId: sparkCodeRequest?.id ?? null,
      threadId,
      contactPointId: contactPoint?.id ?? null,
      direction: MessageDirection.INBOUND,
      providerMessageSid: messageSid,
      channel,
      fromE164: sourceAddress.phoneE164,
      toE164: destinationAddress.phoneE164,
      body,
      parseStatus:
        parsed.candidates.length > 0
          ? MessageParseStatus.CODE_FOUND
          : MessageParseStatus.NO_CODE_FOUND,
      parsedCodeHash: firstCodeCandidateHash,
      rawPayload: args.payload,
    },
    select: {
      id: true,
    },
  });

  if (!sparkCodeRequest || !contactPoint) {
    return {
      handled: true,
      eventId: event.id,
      reason: sparkCodeRequest ? "unmapped-contact-point" : "no-active-request",
    } as const;
  }

  if (parsed.candidates.length === 0) {
    await prisma.sparkCodeRequest.update({
      where: {
        id: sparkCodeRequest.id,
      },
      data: {
        lastError: "No Spark code candidate found in inbound reply.",
      },
    });

    if (threadId) {
      await prisma.creatorMessageThread.update({
        where: {
          id: threadId,
        },
        data: {
          state: MessageThreadState.FAILED,
        },
      });
    }

    await sendAutomatedReply({
      organizationId,
      creatorId: contactPoint.creator.id,
      contactPointId: contactPoint.id,
      sparkCodeRequestId: sparkCodeRequest.id,
      threadId,
      channel,
      toE164: sourceAddress.phoneE164,
      body: "I could not read that code. Please paste the Spark code exactly as copied from TikTok.",
    });

    return {
      handled: true,
      eventId: event.id,
      requestId: sparkCodeRequest.id,
      reason: "no-code-found",
    } as const;
  }

  await prisma.sparkCodeRequest.update({
    where: {
      id: sparkCodeRequest.id,
    },
    data: {
      threadId,
      status: SparkCodeRequestStatus.RECEIVED,
      receivedAt: new Date(),
      lastError: null,
    },
  });

  if (threadId) {
    await prisma.creatorMessageThread.update({
      where: {
        id: threadId,
      },
      data: {
        state: MessageThreadState.CODE_RECEIVED,
      },
    });
  }

  const tiktokAccount = await prisma.organizationTikTokAccount.findFirst({
    where: {
      organizationId,
      status: {
        in: ["ACTIVE", "ENABLED"],
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      advertiserId: true,
      accessToken: true,
    },
  });

  if (!tiktokAccount) {
    await prisma.creatorMessageEvent.update({
      where: {
        id: event.id,
      },
      data: {
        parseStatus: MessageParseStatus.FAILED,
      },
    });
    await prisma.sparkCodeRequest.update({
      where: {
        id: sparkCodeRequest.id,
      },
      data: {
        threadId,
        status: SparkCodeRequestStatus.FAILED,
        failedAt: new Date(),
        lastError: "No active TikTok advertiser account is configured.",
      },
    });

    if (threadId) {
      await prisma.creatorMessageThread.update({
        where: {
          id: threadId,
        },
        data: {
          state: MessageThreadState.FAILED,
        },
      });
    }

    return {
      handled: true,
      eventId: event.id,
      requestId: sparkCodeRequest.id,
      reason: "missing-tiktok-account",
    } as const;
  }

  const authResult = await applySparkAuthorizationFromCandidates({
    organizationId,
    creatorId: contactPoint.creator.id,
    videoId: sparkCodeRequest.videoId ?? null,
    sparkCodeRequestId: sparkCodeRequest.id,
    advertiserId: tiktokAccount.advertiserId,
    accessToken: tiktokAccount.accessToken,
    codeCandidates: parsed.candidates,
  });

  if (authResult.ok) {
    await prisma.creatorMessageEvent.update({
      where: {
        id: event.id,
      },
      data: {
        parseStatus: MessageParseStatus.APPLIED,
      },
    });
    await prisma.sparkCodeRequest.update({
      where: {
        id: sparkCodeRequest.id,
      },
      data: {
        threadId,
        status: SparkCodeRequestStatus.AUTHORIZED,
        authorizedAt: new Date(),
        lastError: null,
      },
    });

    if (threadId) {
      await prisma.creatorMessageThread.update({
        where: {
          id: threadId,
        },
        data: {
          state: MessageThreadState.AUTH_APPLIED,
        },
      });
    }

    await sendAutomatedReply({
      organizationId,
      creatorId: contactPoint.creator.id,
      contactPointId: contactPoint.id,
      sparkCodeRequestId: sparkCodeRequest.id,
      threadId,
      channel,
      toE164: sourceAddress.phoneE164,
      body: "Thanks, got it. Your Spark authorization was applied.",
    });

    return {
      handled: true,
      eventId: event.id,
      requestId: sparkCodeRequest.id,
      authorizationId: authResult.authorizationId,
    } as const;
  }

  await prisma.creatorMessageEvent.update({
    where: {
      id: event.id,
    },
    data: {
      parseStatus: MessageParseStatus.FAILED,
    },
  });
  await prisma.sparkCodeRequest.update({
    where: {
      id: sparkCodeRequest.id,
    },
    data: {
      threadId,
      status: SparkCodeRequestStatus.FAILED,
      failedAt: new Date(),
      lastError: authResult.error,
    },
  });

  if (threadId) {
    await prisma.creatorMessageThread.update({
      where: {
        id: threadId,
      },
      data: {
        state: MessageThreadState.FAILED,
      },
    });
  }

  await sendAutomatedReply({
    organizationId,
    creatorId: contactPoint.creator.id,
    contactPointId: contactPoint.id,
    sparkCodeRequestId: sparkCodeRequest.id,
    threadId,
    channel,
    toE164: sourceAddress.phoneE164,
    body: "That code was not accepted. Please generate a new Spark code and resend.",
  });

  return {
    handled: true,
    eventId: event.id,
    requestId: sparkCodeRequest.id,
    reason: "authorization-failed",
  } as const;
}

export async function processTwilioStatusWebhookPayload(args: {
  payload: TwilioPayload;
}) {
  const messageSid = args.payload.MessageSid?.trim();
  const messageStatus = args.payload.MessageStatus?.trim();

  if (!messageSid || !messageStatus) {
    return {
      handled: false,
      reason: "missing-status-fields",
    } as const;
  }

  const updated = await prisma.creatorMessageEvent.updateMany({
    where: {
      providerMessageSid: messageSid,
    },
    data: {
      deliveryStatus: messageStatus,
      rawPayload: args.payload,
    },
  });

  return {
    handled: updated.count > 0,
  } as const;
}
