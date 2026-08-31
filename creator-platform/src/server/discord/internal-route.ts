import { NextResponse, type NextRequest } from "next/server";

import { authenticateDiscordWorkerRequest } from "@/server/discord/worker-auth";

const maximumBodyBytes = 32_768;

export function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
    },
  });
}

export async function authenticatedWorkerBody(request: NextRequest) {
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return { response: privateJson({ error: "JSON is required." }, 415) } as const;
  }
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > maximumBodyBytes) {
    return { response: privateJson({ error: "Request is too large." }, 413) } as const;
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > maximumBodyBytes) {
    return { response: privateJson({ error: "Request is too large." }, 413) } as const;
  }
  const authentication = await authenticateDiscordWorkerRequest(request, rawBody);
  if (!authentication.ok) {
    const unavailable = authentication.reason === "configuration" || authentication.reason === "backend";
    if (unavailable) {
      // Do not log request identity, nonces, signatures, or bodies.
      console.error(`[creator-discord-worker-auth] ${authentication.reason}`);
    }
    return {
      response: privateJson(
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
    return { response: privateJson({ error: "Request is not valid JSON." }, 400) } as const;
  }
}
