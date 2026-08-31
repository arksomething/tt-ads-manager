import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { authenticatedWorkerBody, privateJson } from "@/server/discord/internal-route";
import { parseDeliveryCompletion } from "@/server/discord/protocol";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
type RouteContext = { params: Promise<{ deliveryId: string }> };

function stateResult(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value;
  if (row && typeof row === "object") {
    const record = row as { state?: unknown; delivery_state?: unknown };
    return String(record.delivery_state ?? record.state ?? "unknown");
  }
  return "unknown";
}

export async function POST(request: NextRequest, context: RouteContext) {
  const authenticated = await authenticatedWorkerBody(request);
  if ("response" in authenticated) return authenticated.response;
  const { deliveryId } = await context.params;
  const completion = parseDeliveryCompletion(authenticated.body);
  if (!uuidPattern.test(deliveryId) || !completion) {
    return privateJson({ error: "Delivery receipt is invalid." }, 400);
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("complete_creator_notification_delivery", {
    delivery_id: deliveryId,
    lease_token: completion.leaseToken,
    result: completion.result,
  });
  if (error) return privateJson({ error: "Reminder queue is unavailable." }, 503);
  return privateJson({ accepted: true, state: stateResult(data) });
}
