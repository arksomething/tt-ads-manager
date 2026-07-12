import assert from "node:assert/strict";
import test from "node:test";

import {
  CREATOR_PORTAL_ALL_TIME_DEAL_START_DATE,
  getCreatorPortalCreatorDealInput,
} from "../src/lib/creator-portal-deal-form.ts";

test("blank creator portal deal dates create an all-time open-ended deal", () => {
  const formData = new FormData();
  formData.set("campaignCreatorId", "campaign-creator-1");
  formData.set("currency", "USD");
  formData.set("effectiveStartDate", "");
  formData.set("effectiveEndDate", "");
  formData.set("cpmAmount", "3");

  const input = getCreatorPortalCreatorDealInput(formData);

  assert.equal(input.effectiveStartDate, CREATOR_PORTAL_ALL_TIME_DEAL_START_DATE);
  assert.equal(input.effectiveEndDate, undefined);
});

test("creator portal deal dates are preserved when explicitly entered", () => {
  const formData = new FormData();
  formData.set("campaignCreatorId", "campaign-creator-1");
  formData.set("currency", "USD");
  formData.set("effectiveStartDate", "2026-04-01");
  formData.set("effectiveEndDate", "2026-04-30");

  const input = getCreatorPortalCreatorDealInput(formData);

  assert.equal(input.effectiveStartDate, "2026-04-01");
  assert.equal(input.effectiveEndDate, "2026-04-30");
});
