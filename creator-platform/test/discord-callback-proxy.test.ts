import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { proxyDiscordCallback } from "../../ops/creator-platform/cloudflare/discord-callback-proxy/src/index.mjs";

describe("gethyperspeed Discord callback route", () => {
  it("does not persist OAuth codes and state in Cloudflare invocation logs", () => {
    const configuration = JSON.parse(readFileSync(
      resolve(process.cwd(), "../ops/creator-platform/cloudflare/discord-callback-proxy/wrangler.jsonc"),
      "utf8",
    )) as { observability?: { enabled?: boolean } };
    expect(configuration.observability?.enabled).toBe(false);
  });

  it("forwards only the exact GET callback and preserves OAuth query state", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 303,
        headers: {
          Location: "https://gotall-creator-platform.vercel.app/account/discord?notice=Connected",
          "Set-Cookie": "must-not-cross-origins=1",
        },
      }),
    );
    const response = await proxyDiscordCallback(
      new Request("https://gethyperspeed.com/api/integrations/discord/callback?code=abc&state=xyz"),
      fetcher,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/account/discord");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("no-store");
    const [target, init] = fetcher.mock.calls[0];
    expect(String(target)).toBe(
      "https://gotall-creator-platform.vercel.app/api/integrations/discord/callback?code=abc&state=xyz",
    );
    expect(init.headers).not.toHaveProperty("Cookie");
  });

  it.each([
    ["POST", "https://gethyperspeed.com/api/integrations/discord/callback"],
    ["GET", "https://gethyperspeed.com/api/integrations/discord/callback/extra"],
    ["GET", "https://gethyperspeed.com/api/private"],
  ])("rejects %s %s without touching the studio or upstream", async (method, url) => {
    const fetcher = vi.fn();
    const response = await proxyDiscordCallback(new Request(url, { method }), fetcher);
    expect(response.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
