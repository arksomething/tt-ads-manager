import { NextResponse } from "next/server";

import { authenticatePlatformVerificationWorkerRequest } from "@/server/platform-verification/worker-auth";

const maximumBodyBytes = 16_384;

export function verificationWorkerJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

export async function authenticatedVerificationWorkerBody(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return { response: verificationWorkerJson({ error: "JSON is required." }, 415) } as const;
  }

  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null
    && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBodyBytes)
  ) {
    return { response: verificationWorkerJson({ error: "Request is too large." }, 413) } as const;
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > maximumBodyBytes) {
    return { response: verificationWorkerJson({ error: "Request is too large." }, 413) } as const;
  }

  const authentication = await authenticatePlatformVerificationWorkerRequest(request, rawBody);
  if (!authentication.ok) {
    const unavailable = authentication.reason === "configuration" || authentication.reason === "backend";
    if (unavailable) {
      // Never log request bodies, signatures, nonces, handles, or bio codes.
      console.error(`[creator-platform-verification-worker-auth] ${authentication.reason}`);
    }
    return {
      response: verificationWorkerJson(
        { error: unavailable ? "Worker authentication is unavailable." : "Worker authentication failed." },
        unavailable ? 503 : 401,
      ),
    } as const;
  }

  try {
    return {
      body: JSON.parse(rawBody) as unknown,
      identity: authentication.identity,
    } as const;
  } catch {
    return { response: verificationWorkerJson({ error: "Request is not valid JSON." }, 400) } as const;
  }
}
