export type RenewalBucketAmounts = {
  newProceeds: number;
  organic: number;
  renewalBucket: number;
};

function normalizePeriodLabel(label: string | null) {
  return label?.trim().toLowerCase().replace(/[\s_-]+/g, " ") ?? "";
}

export function isActivationPeriodLabel(label: string | null) {
  return normalizePeriodLabel(label) === "activation";
}

export function isTrialPeriodLabel(label: string | null) {
  return normalizePeriodLabel(label) === "trial";
}

export function isRenewalPeriodLabel(label: string | null) {
  return normalizePeriodLabel(label).startsWith("renewal");
}

export function getRenewalBucketAmounts(args: {
  totalRevenue: number;
  paidRevenue: number;
  renewalRevenue: number;
}): RenewalBucketAmounts {
  const newProceeds = Math.max(args.totalRevenue - args.renewalRevenue, 0);
  const organicBeforeRenewal = Math.max(args.totalRevenue - args.paidRevenue, 0);
  const renewalBucket = Math.min(args.renewalRevenue, organicBeforeRenewal);
  const organic = Math.max(organicBeforeRenewal - renewalBucket, 0);

  return {
    newProceeds,
    organic,
    renewalBucket,
  };
}
