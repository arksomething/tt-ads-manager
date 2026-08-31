import { createClient } from "@supabase/supabase-js";

import { getSupabaseAdminEnv } from "@/lib/server-env";

/**
 * Server-only Supabase client for narrow, audited service-role operations.
 * Never pass this client or its configuration into a Client Component.
 */
export function createAdminClient() {
  const env = getSupabaseAdminEnv();

  return createClient(env.url, env.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
