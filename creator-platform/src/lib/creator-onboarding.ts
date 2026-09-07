export type CreatorOnboardingStepKey =
  | "account"
  | "application"
  | "profiles"
  | "agreement";

export type CreatorOnboardingStepState = "complete" | "current" | "locked";

export type CreatorOnboardingStep = {
  key: CreatorOnboardingStepKey;
  label: string;
  state: CreatorOnboardingStepState;
  detail: string;
};

export type CreatorOnboardingAction = {
  href: string;
  label: string;
};

export type CreatorOnboardingViewModel = {
  currentStep: number;
  eyebrow: string;
  title: string;
  description: string;
  statusLabel: string | null;
  primaryAction: CreatorOnboardingAction | null;
  secondaryAction: CreatorOnboardingAction | null;
  decisionMessage: string | null;
  nextSteps: string[];
  steps: CreatorOnboardingStep[];
};

type CreatorOnboardingInput = {
  nextPath: string | null | undefined;
  stateAvailable: boolean;
  applicationStatus?: string | null;
  agreementStatus?: string | null;
  decisionMessage?: string | null;
  agreementReadyToSend?: boolean;
};

const labels: Record<CreatorOnboardingStepKey, string> = {
  account: "Account",
  application: "Application",
  profiles: "Profiles",
  agreement: "Agreement",
};

function stepsFor(currentStep: number, currentDetail: string): CreatorOnboardingStep[] {
  const keys = Object.keys(labels) as CreatorOnboardingStepKey[];
  return keys.map((key, index) => {
    const stepNumber = index + 1;
    if (stepNumber < currentStep) {
      return { key, label: labels[key], state: "complete", detail: "Complete" };
    }
    if (stepNumber === currentStep) {
      return { key, label: labels[key], state: "current", detail: currentDetail };
    }
    return { key, label: labels[key], state: "locked", detail: "Locked" };
  });
}

function model(
  currentStep: number,
  currentDetail: string,
  values: Omit<CreatorOnboardingViewModel, "currentStep" | "steps">,
): CreatorOnboardingViewModel {
  return {
    currentStep,
    steps: stepsFor(currentStep, currentDetail),
    ...values,
  };
}

const sampleDealAction = {
  href: "/standard-agreement",
  label: "Preview the standard deal",
};

export function deriveCreatorOnboardingViewModel({
  nextPath,
  stateAvailable,
  applicationStatus,
  agreementStatus,
  decisionMessage,
  agreementReadyToSend = false,
}: CreatorOnboardingInput): CreatorOnboardingViewModel {
  if (!stateAvailable || !nextPath) {
    return model(2, "Unavailable", {
      eyebrow: "Onboarding status",
      title: "We couldn’t load your next step",
      description: "Your account is safe. Try loading this page again.",
      statusLabel: "Temporarily unavailable",
      primaryAction: { href: "/account", label: "Try again" },
      secondaryAction: null,
      decisionMessage: null,
      nextSteps: [],
    });
  }

  if (nextPath === "/apply") {
    return model(2, "Ready", {
      eyebrow: "Step 2 of 4 · About 1 minute",
      title: "You’re ready to apply",
      description:
        "Your email is verified. Tell us who you are and which TikTok or Instagram profiles you create from.",
      statusLabel: null,
      primaryAction: { href: "/apply", label: "Start application" },
      secondaryAction: sampleDealAction,
      decisionMessage: null,
      nextSteps: [
        "We review your application",
        "You verify your creator profiles",
        "You review and sign your assigned agreement",
      ],
    });
  }

  if (nextPath === "/application/status") {
    if (applicationStatus === "changes_requested") {
      return model(2, "Needs attention", {
        eyebrow: "Step 2 of 4",
        title: "We need one update",
        description: "Make the requested change, then send your application back for review.",
        statusLabel: "Needs attention",
        primaryAction: { href: "/apply", label: "Make requested changes" },
        secondaryAction: { href: "/application/status#submitted-application", label: "View submitted application" },
        decisionMessage: decisionMessage ?? "The creator team left an update on your application.",
        nextSteps: ["Update your application", "We review the change", "You verify your creator profiles"],
      });
    }

    if (applicationStatus === "rejected" || applicationStatus === "withdrawn") {
      return model(2, "Closed", {
        eyebrow: "Application decision",
        title: applicationStatus === "withdrawn"
          ? "Your application was withdrawn"
          : "Your application wasn’t approved",
        description: applicationStatus === "withdrawn"
          ? "Your submitted details remain saved to this account."
          : "We’re not able to move this application forward. The creator team’s note appears below.",
        statusLabel: "Closed",
        primaryAction: null,
        secondaryAction: { href: "/", label: "Back to creator program" },
        decisionMessage: decisionMessage ?? null,
        nextSteps: [],
      });
    }

    if (applicationStatus === "approved") {
      return model(2, "Approved", {
        eyebrow: "Application approved",
        title: "We’re preparing your next step",
        description:
          "Your application is approved. The creator team is assigning the exact deal version and profile checks before onboarding continues.",
        statusLabel: "Preparing onboarding",
        primaryAction: null,
        secondaryAction: { href: "/application/status#submitted-application", label: "View submitted application" },
        decisionMessage: decisionMessage ?? null,
        nextSteps: ["Your deal version is assigned", "You verify your creator profiles", "You review and sign the agreement"],
      });
    }

    const inReview = applicationStatus === "in_review";
    return model(2, inReview ? "Under review" : "Received", {
      eyebrow: "Step 2 of 4",
      title: inReview ? "We’re reviewing your application" : "Application received",
      description: inReview
        ? "We’ll show the decision here when the review is complete. You do not need to submit again."
        : "We have your details and creator profiles. There’s nothing else to do while the creator team reviews them.",
      statusLabel: inReview ? "Under review" : "Received",
      primaryAction: null,
      secondaryAction: { href: "/application/status#submitted-application", label: "View submitted application" },
      decisionMessage: null,
      nextSteps: ["We finish the review", "You verify your creator profiles", "You review and sign the agreement"],
    });
  }

  if (nextPath === "/onboarding/accounts") {
    return model(3, "Action required", {
      eyebrow: "Step 3 of 4",
      title: "You’re approved—verify your profiles",
      description:
        "Verification protects your account and ensures posts are tracked to the correct creator.",
      statusLabel: null,
      primaryAction: { href: "/onboarding/accounts", label: "Verify creator profiles" },
      secondaryAction: { href: "/application/status#submitted-application", label: "Review application" },
      decisionMessage: null,
      nextSteps: ["Add the code to each public profile", "We confirm account ownership", "You review and sign the agreement"],
    });
  }

  if (nextPath === "/onboarding/agreement") {
    if (agreementStatus === "declined" || agreementStatus === "voided") {
      return model(4, "Needs help", {
        eyebrow: "Step 4 of 4",
        title: "Your agreement needs help",
        description: "The current document can’t be completed. Use the program contact who sent your invitation for the next step.",
        statusLabel: agreementStatus === "declined" ? "Declined" : "Voided",
        primaryAction: null,
        secondaryAction: { href: "/account", label: "Back to account" },
        decisionMessage: null,
        nextSteps: [],
      });
    }

    if (agreementStatus === "error") {
      return model(4, "Needs attention", {
        eyebrow: "Step 4 of 4",
        title: "We couldn’t prepare your agreement",
        description: "Your application, verified profiles, and assigned deal are safe.",
        statusLabel: "Preparation failed",
        primaryAction: { href: "/onboarding/agreement", label: "Try again" },
        secondaryAction: sampleDealAction,
        decisionMessage: null,
        nextSteps: ["Review your assigned terms", "Sign securely with SignWell", "Your workspace unlocks after confirmation"],
      });
    }

    if (agreementStatus === "creator_accepted") {
      return model(4, "Confirmation pending", {
        eyebrow: "Step 4 of 4",
        title: "Signature submitted",
        description:
          "SignWell has recorded signing activity. We’re confirming the completed document before unlocking your workspace.",
        statusLabel: "Confirming",
        primaryAction: { href: "/onboarding/agreement", label: "Check status" },
        secondaryAction: { href: "/account", label: "Back to account" },
        decisionMessage: null,
        nextSteps: ["We verify the completed document", "Your creator workspace unlocks"],
      });
    }

    if (["sent", "viewed"].includes(agreementStatus ?? "")) {
      return model(4, "Signature required", {
        eyebrow: "Step 4 of 4",
        title: "Finish signing your agreement",
        description:
          "Continue where you left off. Your workspace unlocks after the completed document is confirmed.",
        statusLabel: "Awaiting signature",
        primaryAction: { href: "/onboarding/agreement", label: "Continue signing" },
        secondaryAction: sampleDealAction,
        decisionMessage: null,
        nextSteps: ["Review your exact assigned terms", "Sign securely with SignWell", "We confirm the completed document"],
      });
    }

    if (agreementReadyToSend) {
      return model(4, "Ready to review", {
        eyebrow: "Step 4 of 4",
        title: "Your agreement is ready to review",
        description: "Read your exact compensation and content-usage terms before signing.",
        statusLabel: null,
        primaryAction: { href: "/onboarding/agreement", label: "Review agreement" },
        secondaryAction: sampleDealAction,
        decisionMessage: null,
        nextSteps: ["Review your exact assigned terms", "Sign securely with SignWell", "Your workspace unlocks after confirmation"],
      });
    }

    return model(4, "Preparing", {
      eyebrow: "Step 4 of 4",
      title: "We’re preparing your agreement",
      description: "No action is needed yet. Your exact deal terms will appear here when the document is ready.",
      statusLabel: "Preparing",
      primaryAction: null,
      secondaryAction: sampleDealAction,
      decisionMessage: null,
      nextSteps: ["We prepare your assigned version", "You review and sign it", "Your workspace unlocks after confirmation"],
    });
  }

  if (nextPath === "/account") {
    const completeModel = model(4, "Complete", {
      eyebrow: "Onboarding complete",
      title: "You’re in",
      description: "Your creator workspace is active.",
      statusLabel: "Active",
      primaryAction: { href: "/account#creator-command-center-title", label: "Open creator workspace" },
      secondaryAction: null,
      decisionMessage: null,
      nextSteps: [],
    });
    return {
      ...completeModel,
      steps: completeModel.steps.map((step) => ({
        ...step,
        state: "complete" as const,
        detail: "Complete",
      })),
    };
  }

  return deriveCreatorOnboardingViewModel({
    nextPath: null,
    stateAvailable: false,
    applicationStatus,
    agreementStatus,
    decisionMessage,
  });
}
