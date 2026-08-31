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
  if (!validation || validation.workerId !== authenticated.identity.workerId) {
    return privateJson({ error: "Scheduler request is invalid." }, 400);
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("schedule_creator_reminder_tick");
  if (error) return privateJson({ error: "Reminder scheduler is unavailable." }, 503);
  return privateJson({ scheduled: data ?? null });
}
