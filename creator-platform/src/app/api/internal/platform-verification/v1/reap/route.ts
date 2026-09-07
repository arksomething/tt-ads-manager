import { createAdminClient } from "@/lib/supabase/admin";
import {
  authenticatedVerificationWorkerBody,
  verificationWorkerJson,
} from "@/server/platform-verification/internal-route";
import {
  mapVerificationReap,
  parseVerificationReapInput,
} from "@/server/platform-verification/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authenticated = await authenticatedVerificationWorkerBody(request);
  if ("response" in authenticated) return authenticated.response;

  const input = parseVerificationReapInput(authenticated.body);
  if (!input || input.workerId !== authenticated.identity.workerId) {
    return verificationWorkerJson({ error: "Recovery request is invalid." }, 400);
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("reap_creator_platform_verification_jobs", {
    requested_max_jobs: input.maxJobs,
  });
  if (error) return verificationWorkerJson({ error: "Verification recovery is unavailable." }, 503);
  const summary = mapVerificationReap(Array.isArray(data) ? data[0] : data);
  return verificationWorkerJson({ protocolVersion: 1, summary });
}
