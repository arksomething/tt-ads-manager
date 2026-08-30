import type { Metadata } from "next";

import { AdminActivityPreview } from "@/components/admin-activity-preview";

export const metadata: Metadata = {
  title: "Admin activity preview",
  description: "A sample of the GoTall creator-success activity workspace.",
};

export default function AdminPreviewPage() {
  return <AdminActivityPreview />;
}
