import { describe, expect, it } from "vitest";

import { normalizeCreatorAccountState } from "@/server/accounts/state";

describe("creator account state", () => {
  it("normalizes the single-row RPC response and remains provider-neutral", () => {
    expect(normalizeCreatorAccountState([{
      next_path: "/account",
      account_status: "profile_incomplete",
      application_status: "approved",
      agreement_status: "pending",
    }])).toEqual({
      nextPath: "/account",
      profileState: "profile_incomplete",
      applicationState: "approved",
      agreementState: "pending",
    });
  });

  it("uses null states for an empty RPC result", () => {
    expect(normalizeCreatorAccountState([])).toEqual({
      nextPath: null,
      profileState: null,
      applicationState: null,
      agreementState: null,
    });
  });
});
