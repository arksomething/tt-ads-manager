import { describe, expect, it } from "vitest";

import { addAuthMessage, sanitizeNextPath } from "@/lib/auth-navigation";
import { validatePasswordPair } from "@/server/auth/http";

describe("creator account navigation", () => {
  it("keeps safe internal destinations and rejects external redirects", () => {
    expect(sanitizeNextPath("/apply?from=account", "/account")).toBe("/apply?from=account");
    expect(sanitizeNextPath("https://attacker.example", "/account")).toBe("/account");
    expect(sanitizeNextPath("//attacker.example/path", "/account")).toBe("/account");
    expect(sanitizeNextPath("/\\attacker.example", "/account")).toBe("/account");
  });

  it("adds encoded account notices without changing the destination", () => {
    expect(addAuthMessage("/account", "notice", "Password updated.")).toBe(
      "/account?notice=Password+updated.",
    );
  });

  it("enforces password length and exact confirmation without trimming", () => {
    expect(validatePasswordPair("too-short", "too-short")).toMatch(/at least 10/i);
    expect(validatePasswordPair("password one", "password two")).toMatch(/do not match/i);
    expect(validatePasswordPair(" password  ", " password  ")).toBeNull();
  });
});
