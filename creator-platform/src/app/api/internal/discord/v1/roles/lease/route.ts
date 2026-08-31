import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { authenticatedWorkerBody, privateJson } from "@/server/discord/internal-route";
import { mapRoleLeaseRow, parseRoleLeaseInput } from "@/server/discord/protocol";

export async function POST(request: NextRequest) {
  const authenticated = await authenticatedWorkerBody(request);
  if ("response" in authenticated) return authenticated.response;
  const input = parseRoleLeaseInput(authenticated.body);
  if (!input || input.workerId !== authenticated.identity.workerId) {
    return privateJson({ error: "Role lease request is invalid." }, 400);
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("claim_creator_discord_role_sync_jobs", {
    worker_id: input.workerId,
    max_jobs: input.maxJobs,
    lease_seconds: input.leaseSeconds,
  });
  if (error) return privateJson({ error: "Role queue is unavailable." }, 503);
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return privateJson({ protocolVersion: 1, jobs: rows.map(mapRoleLeaseRow) });
}
