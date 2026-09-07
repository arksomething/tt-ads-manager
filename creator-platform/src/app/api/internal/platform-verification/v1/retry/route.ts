import { createAdminClient } from "@/lib/supabase/admin";
import {
  authenticatedVerificationWorkerBody,
  verificationWorkerJson,
} from "@/server/platform-verification/internal-route";
import {
  mapVerificationResult,
  parseVerificationRetryInput,
} from "@/server/platform-verification/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authenticated = await authenticatedVerificationWorkerBody(request);
  if ("response" in authenticated) return authenticated.response;

  const input = parseVerificationRetryInput(authenticated.body);
  if (!input || input.workerId !== authenticated.identity.workerId) {
    return verificationWorkerJson({ error: "Retry request is invalid." }, 400);
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("retry_creator_platform_verification_job", {
    target_job_id: input.jobId,
    target_lease_token: input.leaseToken,
    retry_input: input.retry,
  });
  if (error) return verificationWorkerJson({ error: "Verification retry is unavailable." }, 503);
  const result = mapVerificationResult(Array.isArray(data) ? data[0] : data);
  return verificationWorkerJson(
    { protocolVersion: 1, result },
    result.accepted ? 200 : 409,
  );
}
