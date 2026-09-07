import { createAdminClient } from "@/lib/supabase/admin";
import {
  authenticatedVerificationWorkerBody,
  verificationWorkerJson,
} from "@/server/platform-verification/internal-route";
import {
  mapVerificationLease,
  parseVerificationLeaseInput,
} from "@/server/platform-verification/protocol";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authenticated = await authenticatedVerificationWorkerBody(request);
  if ("response" in authenticated) return authenticated.response;

  const input = parseVerificationLeaseInput(authenticated.body);
  if (!input || input.workerId !== authenticated.identity.workerId) {
    return verificationWorkerJson({ error: "Lease request is invalid." }, 400);
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("lease_creator_platform_verification_jobs", {
    worker_id: input.workerId,
    requested_max_jobs: input.maxJobs,
    requested_lease_seconds: input.leaseSeconds,
  });
  if (error) return verificationWorkerJson({ error: "Verification queue is unavailable." }, 503);
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return verificationWorkerJson({ protocolVersion: 1, jobs: rows.map(mapVerificationLease) });
}
