"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { CreatorPortalSkeleton } from "./skeleton";

const CREATOR_PORTAL_PENDING_REFRESH_MS = 5_000;

export function CreatorPortalPendingRefresh() {
  const router = useRouter();

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let isCancelled = false;

    function refresh() {
      if (isCancelled) {
        return;
      }

      if (document.visibilityState === "visible") {
        router.refresh();
      }

      timeoutId = setTimeout(refresh, CREATOR_PORTAL_PENDING_REFRESH_MS);
    }

    timeoutId = setTimeout(refresh, CREATOR_PORTAL_PENDING_REFRESH_MS);

    return () => {
      isCancelled = true;

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [router]);

  return <CreatorPortalSkeleton />;
}
