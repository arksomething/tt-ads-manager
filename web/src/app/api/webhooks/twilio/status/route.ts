import { NextResponse } from "next/server";

import { processTwilioStatusWebhookPayload } from "@/server/messaging/mutations";
import { verifyTwilioRequestSignature } from "@/server/messaging/twilio-client";

function formDataToPayload(formData: FormData) {
  const payload: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    payload[key] = typeof value === "string" ? value : value.name;
  }

  return payload;
}

export async function POST(request: Request) {
  const signature = request.headers.get("x-twilio-signature");

  try {
    const formData = await request.formData();
    const payload = formDataToPayload(formData);
    const isValidSignature = verifyTwilioRequestSignature({
      expectedUrl: request.url,
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

    const result = await processTwilioStatusWebhookPayload({
      payload,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Twilio status webhook failed", error);
    return NextResponse.json(
      {
        error: "Twilio status webhook failed.",
      },
      { status: 500 },
    );
  }
}
