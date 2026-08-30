import type { Metadata } from "next";

import { CreatorDashboardPreview } from "@/components/creator-dashboard-preview";

export const metadata: Metadata = {
  title: "Creator dashboard preview",
  description: "A sample of the creator-first GoTall workspace.",
};

export default function CreatorPreviewPage() {
  return <CreatorDashboardPreview />;
}
