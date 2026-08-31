import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { authenticatedWorkerBody, privateJson } from "@/server/discord/internal-route";
import { parseLeaseToken } from "@/server/discord/protocol";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

type RouteContext = { params: Promise<{ deliveryId: string }> };

function readyResult(value: unknown) {
  if (typeof value === "boolean") return value;
  const row = Array.isArray(value) ? value[0] : value;
  if (row && typeof row === "object" && "ready" in row) {
    return Boolean((row as { ready?: unknown }).ready);
  }
  return false;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const authenticated = await authenticatedWorkerBody(request);
  if ("response" in authenticated) return authenticated.response;
  const { deliveryId } = await context.params;
  const leaseToken = parseLeaseToken(authenticated.body);
  if (!uuidPattern.test(deliveryId) || !leaseToken) {
    return privateJson({ error: "Delivery transition is invalid." }, 400);
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("begin_creator_notification_delivery", {
    delivery_id: deliveryId,
    lease_token: leaseToken,
  });
  if (error) return privateJson({ error: "Reminder queue is unavailable." }, 503);
  return privateJson({ ready: readyResult(data) });
}
