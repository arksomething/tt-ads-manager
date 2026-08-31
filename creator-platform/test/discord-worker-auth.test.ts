import { createHmac, createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyDiscordWorkerSignature } from "@/server/discord/worker-auth";

function signature(args: {
  secret: string;
  timestamp: number;
  nonce: string;
  workerId: string;
  method: string;
  pathname: string;
  body: string;
}) {
  const bodyHash = createHash("sha256").update(args.body).digest("hex");
  const canonical = [
    "v1",
    String(args.timestamp),
    args.nonce,
    args.workerId,
    args.method,
    args.pathname,
    bodyHash,
  ].join("\n");
  return `v1=${createHmac("sha256", args.secret).update(canonical).digest("hex")}`;
}

describe("Discord worker HMAC authentication", () => {
  it("binds the worker, path, method, timestamp, nonce, and exact body", () => {
    const args = {
      secret: "s".repeat(48),
      timestamp: 1_800_000_000,
      nonce: randomUUID(),
      workerId: "gotall-xps-discord-worker",
      method: "POST",
      pathname: "/api/internal/discord/v1/lease",
      body: '{"maxMessages":10}',
    };
    const result = verifyDiscordWorkerSignature({
      ...args,
      timestamp: String(args.timestamp),
      signature: signature(args),
      nowSeconds: args.timestamp,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity.bodySha256).toHaveLength(64);
      expect(result.identity.workerId).toBe(args.workerId);
    }

    expect(verifyDiscordWorkerSignature({
      ...args,
      timestamp: String(args.timestamp),
      body: '{"maxMessages":11}',
      signature: signature(args),
      nowSeconds: args.timestamp,
    })).toEqual({ ok: false, reason: "signature" });
  });

  it("fails closed outside the five-minute clock window", () => {
    const args = {
      secret: "s".repeat(48),
      timestamp: 1_800_000_000,
      nonce: randomUUID(),
      workerId: "gotall-xps-discord-worker",
      method: "POST",
      pathname: "/api/internal/discord/v1/lease",
      body: "{}",
    };
    expect(verifyDiscordWorkerSignature({
      ...args,
      timestamp: String(args.timestamp),
      signature: signature(args),
      nowSeconds: args.timestamp + 301,
    })).toEqual({ ok: false, reason: "clock_skew" });
  });
});
