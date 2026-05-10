import assert from "node:assert/strict";
import test from "node:test";

import {
  getRenewalBucketAmounts,
  isActivationPeriodLabel,
  isRenewalPeriodLabel,
  isTrialPeriodLabel,
} from "../src/server/adapty/revenue-renewals.ts";

test("classifies Adapty period labels", () => {
  assert.equal(isActivationPeriodLabel("Activation"), true);
  assert.equal(isActivationPeriodLabel("Renewals 1"), false);
  assert.equal(isRenewalPeriodLabel("Renewals 6+"), true);
  assert.equal(isRenewalPeriodLabel("Renewal 2"), true);
  assert.equal(isRenewalPeriodLabel("Activation"), false);
  assert.equal(isTrialPeriodLabel("Trial"), true);
});

test("deducts old-source proceeds from the organic bucket", () => {
  assert.deepEqual(
    getRenewalBucketAmounts({
      paidRevenue: 300,
      renewalRevenue: 250,
      totalRevenue: 1_000,
    }),
    {
      newProceeds: 750,
      organic: 450,
      renewalBucket: 250,
    },
  );
});

test("caps the old-source bucket to the organic remainder after paid rows", () => {
  assert.deepEqual(
    getRenewalBucketAmounts({
      paidRevenue: 850,
      renewalRevenue: 400,
      totalRevenue: 1_000,
    }),
    {
      newProceeds: 600,
      organic: 0,
      renewalBucket: 150,
    },
  );
});
