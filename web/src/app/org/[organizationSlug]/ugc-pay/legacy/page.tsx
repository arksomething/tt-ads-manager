import { redirect } from "next/navigation";

import type { DashboardSearchParams } from "@/server/dashboard/filters";

type LegacyUgcPayPageProps = {
  params: Promise<{
    organizationSlug: string;
  }>;
  searchParams: Promise<DashboardSearchParams>;
};

export default async function LegacyUgcPayPage({
  params,
  searchParams,
}: LegacyUgcPayPageProps) {
  const { organizationSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const nextSearchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (!value) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const entry of value) {
        nextSearchParams.append(key, entry);
      }

      continue;
    }

    nextSearchParams.set(key, value);
  }

  const query = nextSearchParams.toString();
  redirect(
    query
      ? `/org/${organizationSlug}/ugc-pay?${query}`
      : `/org/${organizationSlug}/ugc-pay`,
  );
}
