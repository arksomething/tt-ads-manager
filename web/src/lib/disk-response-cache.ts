import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Snapshot mode for local audit runs: when the given env var points at a
// directory, successful GET responses persist there and are served back on
// later runs with no TTL. The snapshot is scoped by directory — start a fresh
// one by pointing at a new/emptied directory. Never enabled in serverless
// (env vars absent), so production fetch semantics are unchanged.
export function readDiskCachedResponse<T>(envVar: string, cacheKey: string) {
  const dir = process.env[envVar]?.trim();

  if (!dir) {
    return { found: false as const, value: undefined };
  }

  try {
    const parsed = JSON.parse(
      readFileSync(getDiskCacheFile(dir, cacheKey), "utf8"),
    ) as { value: T };
    return { found: true as const, value: parsed.value };
  } catch {
    return { found: false as const, value: undefined };
  }
}

export function writeDiskCachedResponse(
  envVar: string,
  cacheKey: string,
  value: unknown,
) {
  const dir = process.env[envVar]?.trim();

  if (!dir) {
    return;
  }

  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      getDiskCacheFile(dir, cacheKey),
      JSON.stringify({ cacheKey, fetchedAt: new Date().toISOString(), value }),
    );
  } catch {
    // A failed snapshot write must never fail the request.
  }
}

function getDiskCacheFile(dir: string, cacheKey: string) {
  const hash = createHash("sha256").update(cacheKey).digest("hex");
  return path.join(dir, `${hash}.json`);
}
