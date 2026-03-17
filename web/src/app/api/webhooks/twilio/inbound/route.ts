import { NextResponse } from "next/server";

import { getTwilioEnv } from "@/lib/server-env";
import { processInboundTwilioWebhookPayload } from "@/server/messaging/mutations";
import { verifyTwilioRequestSignature } from "@/server/messaging/twilio-client";

function formDataToPayload(formData: FormData) {
  const payload: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    payload[key] = typeof value === "string" ? value : value.name;
  }

  return payload;
}

function toTwimlResponse(status = 200) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, {
    status,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
    },
  });
}

export async function POST(request: Request) {
  const signature = request.headers.get("x-twilio-signature");

  try {
    const formData = await request.formData();
    const payload = formDataToPayload(formData);
    const env = getTwilioEnv();
    const expectedUrl = env.TWILIO_INBOUND_WEBHOOK_URL ?? request.url;
    const isValidSignature = verifyTwilioRequestSignature({
      expectedUrl,
      signature,
      params: payload,
    });

    if (!isValidSignature) {
      return NextResponse.json(
        {
          error: "Invalid Twilio signature.",
        },
        { status: 403 },
      );
    }

    await processInboundTwilioWebhookPayload({
      payload,
    });

    return toTwimlResponse();
  } catch (error) {
    console.error("Twilio inbound webhook failed", error);
    return toTwimlResponse(500);
  }
}
