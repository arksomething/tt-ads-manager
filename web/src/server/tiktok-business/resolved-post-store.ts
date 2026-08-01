import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseDatabaseEnv } from "@/lib/server-env";

// Durable cross-instance cache for resolved TikTok posts. An ad's attached
// post is immutable, so successful resolutions are stored forever and unlock
// warm page loads on cold serverless instances. Reads and writes go straight
// through supabase-js (not the prisma shim) so cache writes never invalidate
// the shim's table caches mid-request. All failures here degrade to "cache
// miss" — the caller falls back to live TikTok lookups.

const RESOLVED_POST_CACHE_TABLE = "TikTokResolvedPostCache";
const READ_CHUNK_SIZE = 150;

let storeClient: SupabaseClient | null | undefined;

function getStoreClient() {
  if (storeClient === undefined) {
    try {
      const env = getSupabaseDatabaseEnv();
      storeClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVER_KEY, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
    } catch {
      storeClient = null;
    }
  }

  return storeClient;
}

export async function readResolvedPostsFromStore(
  cacheKeys: readonly string[],
): Promise<Map<string, Record<string, unknown>>> {
  const resolved = new Map<string, Record<string, unknown>>();
  const client = getStoreClient();

  if (!client || cacheKeys.length === 0) {
    return resolved;
  }

  try {
    for (let start = 0; start < cacheKeys.length; start += READ_CHUNK_SIZE) {
      const chunk = cacheKeys.slice(start, start + READ_CHUNK_SIZE);
      const { data, error } = await client
        .from(RESOLVED_POST_CACHE_TABLE)
        .select("cacheKey,payload")
        .in("cacheKey", chunk);

      if (error) {
        return resolved;
      }

      for (const row of data ?? []) {
        if (
          typeof row.cacheKey === "string" &&
          row.payload &&
          typeof row.payload === "object" &&
          !Array.isArray(row.payload)
        ) {
          resolved.set(row.cacheKey, row.payload as Record<string, unknown>);
        }
      }
    }
  } catch {
    return resolved;
  }

  return resolved;
}

export async function writeResolvedPostsToStore(
  entries: ReadonlyArray<{ cacheKey: string; payload: Record<string, unknown> }>,
) {
  const client = getStoreClient();

  if (!client || entries.length === 0) {
    return;
  }

  try {
    await client.from(RESOLVED_POST_CACHE_TABLE).upsert(
      entries.map((entry) => ({
        cacheKey: entry.cacheKey,
        payload: entry.payload,
        updatedAt: new Date().toISOString(),
      })),
      { onConflict: "cacheKey" },
    );
  } catch {
    // Best-effort cache write; live lookups already produced the data.
  }
}
