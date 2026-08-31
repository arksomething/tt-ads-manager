import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { authenticatedWorkerBody, privateJson } from "@/server/discord/internal-route";
import { parseRoleCompletion } from "@/server/discord/protocol";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
type RouteContext = { params: Promise<{ jobId: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  const authenticated = await authenticatedWorkerBody(request);
  if ("response" in authenticated) return authenticated.response;
  const { jobId } = await context.params;
  const completion = parseRoleCompletion(authenticated.body);
  if (!uuidPattern.test(jobId) || !completion) {
    return privateJson({ error: "Role receipt is invalid." }, 400);
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("complete_creator_discord_role_sync_job", {
    job_id: jobId,
    lease_token: completion.leaseToken,
    result: completion.result,
  });
  if (error) return privateJson({ error: "Role queue is unavailable." }, 503);
  return privateJson({ accepted: true, result: data ?? null });
}
