import type { Metadata } from "next";

import { AccountVerificationPreview } from "@/components/account-verification-preview";

export const metadata: Metadata = {
  title: "Account verification preview",
  description: "A sample of the creator-first GoTall onboarding flow.",
};

export default function OnboardingPreviewPage() {
  return <AccountVerificationPreview />;
}
