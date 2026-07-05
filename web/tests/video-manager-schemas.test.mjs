import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { extname, resolve as resolvePath } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const mockModules = new Map([
  [
    "@/lib/prisma-shim",
    `export const Platform = {
      TIKTOK: "TIKTOK",
      INSTAGRAM_REELS: "INSTAGRAM_REELS",
      YOUTUBE_SHORTS: "YOUTUBE_SHORTS",
    };`,
  ],
]);

function localTsUrl(path) {
  const resolved = resolvePath(path);
  return pathToFileURL(extname(resolved) ? resolved : `${resolved}.ts`).href;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const mock = mockModules.get(specifier);

    if (mock) {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(mock)}`,
      };
    }

    if (specifier.startsWith("@/")) {
      return nextResolve(localTsUrl(resolvePath("src", specifier.slice(2))), context);
    }

    if (specifier.startsWith(".") && !extname(specifier)) {
      return nextResolve(
        localTsUrl(new URL(specifier, context.parentURL).pathname),
        context,
      );
    }

    return nextResolve(specifier, context);
  },
});

test("video talking status schema accepts talking actions", async () => {
  const { setVideoTalkingStatusSchema } = await import(
    "../src/server/videos/schemas.ts"
  );

  assert.deepEqual(
    setVideoTalkingStatusSchema.parse({
      videoId: "video-1",
      action: "mark-non-talking",
    }),
    {
      videoId: "video-1",
      platform: "TIKTOK",
      action: "mark-non-talking",
    },
  );

  assert.equal(
    setVideoTalkingStatusSchema.parse({
      videoId: "video-1",
      action: "mark-talking",
    }).action,
    "mark-talking",
  );
});

test("video talking status schema rejects unknown actions", async () => {
  const { setVideoTalkingStatusSchema } = await import(
    "../src/server/videos/schemas.ts"
  );
  const result = setVideoTalkingStatusSchema.safeParse({
    videoId: "video-1",
    action: "archive",
  });

  assert.equal(result.success, false);
});

test("video talking status schema accepts provider source ids", async () => {
  const { setVideoTalkingStatusSchema } = await import(
    "../src/server/videos/schemas.ts"
  );

  assert.deepEqual(
    setVideoTalkingStatusSchema.parse({
      sourceVideoId: "7350000000000000000",
      action: "mark-non-talking",
    }),
    {
      sourceVideoId: "7350000000000000000",
      platform: "TIKTOK",
      action: "mark-non-talking",
    },
  );
});
