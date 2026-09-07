import { createAdminClient } from "@/lib/supabase/admin";
import {
  authenticatedVerificationWorkerBody,
  verificationWorkerJson,
} from "@/server/platform-verification/internal-route";
import {
  mapVerificationResult,
  parseVerificationCompletionInput,
} from "@/server/platform-verification/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authenticated = await authenticatedVerificationWorkerBody(request);
  if ("response" in authenticated) return authenticated.response;

  const input = parseVerificationCompletionInput(authenticated.body);
  if (!input || input.workerId !== authenticated.identity.workerId) {
    return verificationWorkerJson({ error: "Completion request is invalid." }, 400);
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("complete_creator_platform_verification_job", {
    target_job_id: input.jobId,
    target_lease_token: input.leaseToken,
    result_input: input.result,
  });
  if (error) return verificationWorkerJson({ error: "Verification completion is unavailable." }, 503);
  const result = mapVerificationResult(Array.isArray(data) ? data[0] : data);
  return verificationWorkerJson(
    { protocolVersion: 1, result },
    result.accepted ? 200 : 409,
  );
}
