import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { authenticatedWorkerBody, privateJson } from "@/server/discord/internal-route";
import { parseLeaseInput } from "@/server/discord/protocol";

export async function POST(request: NextRequest) {
  const authenticated = await authenticatedWorkerBody(request);
  if ("response" in authenticated) return authenticated.response;
  const body = authenticated.body as Record<string, unknown> | null;
  const validation = parseLeaseInput({
    ...body,
    maxMessages: 1,
    leaseSeconds: 30,
  });
  const workerVersion = typeof body?.workerVersion === "string"
    ? body.workerVersion.trim().slice(0, 40)
    : "";
  const observedAt = typeof body?.observedAt === "string" && Number.isFinite(Date.parse(body.observedAt))
    ? new Date(body.observedAt).toISOString()
    : null;
  const status = body?.status === "healthy" || body?.status === "degraded" || body?.status === "draining"
    ? body.status
    : null;
  if (
    !validation ||
    validation.workerId !== authenticated.identity.workerId ||
    !workerVersion ||
    !observedAt ||
    !status
  ) return privateJson({ error: "Heartbeat is invalid." }, 400);

  const supabase = createAdminClient();
  const { error } = await supabase.rpc("record_creator_discord_worker_heartbeat", {
    input: {
      worker_id: validation.workerId,
      boot_id: validation.bootId,
      protocol_version: 1,
      worker_version: workerVersion,
      status,
      observed_at: observedAt,
    },
  });
  if (error) return privateJson({ error: "Worker heartbeat is unavailable." }, 503);
  return privateJson({ accepted: true });
}
