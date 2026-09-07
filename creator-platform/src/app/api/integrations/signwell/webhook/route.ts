import { NextResponse, type NextRequest } from "next/server";

import {
  getSignWellCompletedArtifact,
  SignWellError,
  verifySignWellWebhook,
} from "@/lib/agreements/signwell";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const MAX_WEBHOOK_BYTES = 1_048_576;

function response(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  if (contentType !== "application/json") {
    return response(415, { error: "JSON required." });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return response(413, { error: "Payload too large." });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
    return response(413, { error: "Payload too large." });
  }

  let event;
  try {
    event = verifySignWellWebhook(rawBody);
  } catch (error) {
    const status = error instanceof SignWellError ? error.status : 401;
    return response(status, { error: "Webhook verification failed." });
  }

  const supabase = createAdminClient();
  const { data: preliminaryResult, error: preliminaryError } = await supabase.rpc(
    "process_signwell_agreement_event",
    { event_input: event },
  );
  if (preliminaryError) {
    return response(503, { error: "Webhook could not be stored." });
  }

  if (preliminaryResult === "pending") {
    return response(503, {
      received: true,
      error: "Agreement document attachment is still pending.",
    });
  }

  if (preliminaryResult !== "artifact_required") {
    return response(200, {
      received: true,
      result: preliminaryResult === "duplicate" ? "duplicate" : "accepted",
    });
  }

  if (event.eventType !== "document_completed") {
    return response(503, { error: "Agreement event requested an unexpected artifact." });
  }

  {
    let artifact;
    try {
      artifact = await getSignWellCompletedArtifact(event.documentId);
    } catch {
      return response(503, {
        received: true,
        error: "Completed agreement artifact is not ready for archival.",
      });
    }

    const artifactRef = `signwell/${event.documentId}/${artifact.sha256}.pdf`;
    const { error: archiveError } = await supabase.storage
      .from("creator-agreements")
      .upload(artifactRef, artifact.bytes, {
        cacheControl: "31536000",
        contentType: "application/pdf",
        upsert: true,
      });
    if (archiveError) {
      return response(503, {
        received: true,
        error: "Completed agreement artifact could not be archived.",
      });
    }
    const eventInput: Record<string, unknown> = {
      ...event,
      artifactSha256: artifact.sha256,
      artifactRef,
      artifactSizeBytes: artifact.bytes.length,
    };
    const { data, error } = await supabase.rpc("process_signwell_agreement_event", {
      event_input: eventInput,
    });
    if (error) {
      return response(503, { error: "Webhook could not be finalized." });
    }

    return response(200, {
      received: true,
      result: data === "duplicate" ? "duplicate" : "accepted",
    });
  }
}
