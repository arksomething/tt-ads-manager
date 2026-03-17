import twilio, { type Twilio } from "twilio";
import { MessagingChannel } from "@prisma/client";

import { getTwilioEnv } from "@/lib/server-env";

type TwilioAddressPair = {
  from: string;
  to: string;
};

type TwilioOrgConfig = {
  messagingServiceSid: string | null;
  smsFrom: string | null;
  whatsappFrom: string | null;
};

type SendTwilioMessageArgs = {
  channel: MessagingChannel;
  toE164: string;
  body: string;
  config: TwilioOrgConfig | null;
};

export type SentTwilioMessage = {
  sid: string;
  status: string | null;
  from: string | null;
  to: string;
};

let cachedClient: Twilio | undefined;

function getTwilioClient() {
  if (!cachedClient) {
    const env = getTwilioEnv();
    cachedClient = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
  }

  return cachedClient;
}

function formatOutboundAddress(channel: MessagingChannel, value: string) {
  if (channel === MessagingChannel.WHATSAPP) {
    return value.startsWith("whatsapp:") ? value : `whatsapp:${value}`;
  }

  return value.startsWith("whatsapp:") ? value.replace("whatsapp:", "") : value;
}

function resolveMessagingConfig(
  channel: MessagingChannel,
  config: TwilioOrgConfig | null,
) {
  const env = getTwilioEnv();
  const messagingServiceSid =
    config?.messagingServiceSid?.trim() || env.TWILIO_MESSAGING_SERVICE_SID || null;

  const from =
    channel === MessagingChannel.WHATSAPP
      ? config?.whatsappFrom?.trim() || env.TWILIO_WHATSAPP_FROM || null
      : config?.smsFrom?.trim() || env.TWILIO_SMS_FROM || null;

  if (!messagingServiceSid && !from) {
    const senderField = channel === MessagingChannel.WHATSAPP ? "WhatsApp From" : "SMS From";
    throw new Error(
      `Twilio sender is not configured for ${channel.toLowerCase()} messages. Set a Messaging Service SID or ${senderField}.`,
    );
  }

  return {
    messagingServiceSid,
    from,
  };
}

export async function sendTwilioMessage(args: SendTwilioMessageArgs): Promise<SentTwilioMessage> {
  const client = getTwilioClient();
  const senderConfig = resolveMessagingConfig(args.channel, args.config);
  const to = formatOutboundAddress(args.channel, args.toE164);
  const message = await client.messages.create({
    body: args.body,
    to,
    ...(senderConfig.messagingServiceSid
      ? {
          messagingServiceSid: senderConfig.messagingServiceSid,
        }
      : {
          from: formatOutboundAddress(args.channel, senderConfig.from as string),
        }),
  });

  return {
    sid: message.sid,
    status: message.status ?? null,
    from: message.from ?? null,
    to: message.to,
  };
}

export function verifyTwilioRequestSignature(args: {
  expectedUrl: string;
  signature: string | null;
  params: Record<string, string>;
}) {
  if (!args.signature) {
    return false;
  }

  const env = getTwilioEnv();
  return twilio.validateRequest(
    env.TWILIO_AUTH_TOKEN,
    args.signature,
    args.expectedUrl,
    args.params,
  );
}

export function parseTwilioAddress(value: string): TwilioAddressPair {
  const trimmed = value.trim();

  if (trimmed.startsWith("whatsapp:")) {
    const phone = trimmed.slice("whatsapp:".length).trim();
    return {
      from: `whatsapp:${phone}`,
      to: phone,
    };
  }

  return {
    from: trimmed,
    to: trimmed,
  };
}
