import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { authenticatedWorkerBody, privateJson } from "@/server/discord/internal-route";
import { mapDeliveryLeaseRow, parseLeaseInput } from "@/server/discord/protocol";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authenticated = await authenticatedWorkerBody(request);
  if ("response" in authenticated) return authenticated.response;

  const input = parseLeaseInput(authenticated.body);
  if (!input || input.workerId !== authenticated.identity.workerId) {
    return privateJson({ error: "Lease request is invalid." }, 400);
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("claim_creator_notification_deliveries", {
    worker_id: input.workerId,
    max_messages: input.maxMessages,
    lease_seconds: input.leaseSeconds,
  });
  if (error) return privateJson({ error: "Reminder queue is unavailable." }, 503);

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return privateJson({ protocolVersion: 1, messages: rows.map(mapDeliveryLeaseRow) });
}
