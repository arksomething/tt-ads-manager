import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CreatorOnboardingProgress } from "@/components/creator-onboarding";
import { deriveCreatorOnboardingViewModel } from "@/lib/creator-onboarding";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

describe("creator onboarding view model", () => {
  it.each([
    {
      nextPath: "/apply",
      applicationStatus: null,
      agreementStatus: null,
      currentStep: 2,
      title: "You’re ready to apply",
      action: { href: "/apply", label: "Start application" },
      states: ["complete", "current", "locked", "locked"],
    },
    {
      nextPath: "/application/status",
      applicationStatus: "in_review",
      agreementStatus: null,
      currentStep: 2,
      title: "We’re reviewing your application",
      action: null,
      states: ["complete", "current", "locked", "locked"],
    },
    {
      nextPath: "/onboarding/accounts",
      applicationStatus: "approved",
      agreementStatus: "pending",
      currentStep: 3,
      title: "You’re approved—verify your profiles",
      action: { href: "/onboarding/accounts", label: "Verify creator profiles" },
      states: ["complete", "complete", "current", "locked"],
    },
    {
      nextPath: "/onboarding/agreement",
      applicationStatus: "approved",
      agreementStatus: "pending",
      currentStep: 4,
      title: "Your agreement is ready to review",
      action: { href: "/onboarding/agreement", label: "Review agreement" },
      states: ["complete", "complete", "complete", "current"],
    },
  ])("maps $nextPath to one explicit current step", (fixture) => {
    const model = deriveCreatorOnboardingViewModel({
      nextPath: fixture.nextPath,
      stateAvailable: true,
      applicationStatus: fixture.applicationStatus,
      agreementStatus: fixture.agreementStatus,
      agreementReadyToSend: fixture.nextPath === "/onboarding/agreement",
    });

    expect(model.currentStep).toBe(fixture.currentStep);
    expect(model.title).toBe(fixture.title);
    expect(model.primaryAction).toEqual(fixture.action);
    expect(model.steps.map((step) => step.state)).toEqual(fixture.states);
    expect(model.steps.filter((step) => step.state === "current")).toHaveLength(1);
  });

  it("turns review decisions into truthful actions without advancing the creator", () => {
    const changesRequested = deriveCreatorOnboardingViewModel({
      nextPath: "/application/status",
      stateAvailable: true,
      applicationStatus: "changes_requested",
      decisionMessage: "Replace the Instagram handle.",
    });
    expect(changesRequested).toMatchObject({
      currentStep: 2,
      title: "We need one update",
      decisionMessage: "Replace the Instagram handle.",
      primaryAction: { href: "/apply", label: "Make requested changes" },
    });

    const rejected = deriveCreatorOnboardingViewModel({
      nextPath: "/application/status",
      stateAvailable: true,
      applicationStatus: "rejected",
      decisionMessage: "This campaign is not a match.",
    });
    expect(rejected).toMatchObject({
      currentStep: 2,
      statusLabel: "Closed",
      primaryAction: null,
      decisionMessage: "This campaign is not a match.",
    });
  });

  it("distinguishes agreement preparation, continuation, failure, and help states", () => {
    const input = {
      nextPath: "/onboarding/agreement",
      stateAvailable: true,
      applicationStatus: "approved",
    } as const;

    expect(deriveCreatorOnboardingViewModel({
      ...input,
      agreementStatus: "pending",
      agreementReadyToSend: false,
    })).toMatchObject({
      title: "We’re preparing your agreement",
      primaryAction: null,
      secondaryAction: { href: "/standard-agreement" },
    });

    expect(deriveCreatorOnboardingViewModel({
      ...input,
      agreementStatus: "sent",
    })).toMatchObject({
      title: "Finish signing your agreement",
      primaryAction: { href: "/onboarding/agreement", label: "Continue signing" },
    });

    expect(deriveCreatorOnboardingViewModel({
      ...input,
      agreementStatus: "error",
    })).toMatchObject({
      statusLabel: "Preparation failed",
      primaryAction: { href: "/onboarding/agreement", label: "Try again" },
    });

    expect(deriveCreatorOnboardingViewModel({
      ...input,
      agreementStatus: "declined",
    })).toMatchObject({
      title: "Your agreement needs help",
      statusLabel: "Declined",
      primaryAction: null,
      secondaryAction: { href: "/account", label: "Back to account" },
    });

    expect(deriveCreatorOnboardingViewModel({
      ...input,
      agreementStatus: "creator_accepted",
    })).toMatchObject({
      currentStep: 4,
      title: "Signature submitted",
      statusLabel: "Confirming",
      primaryAction: { href: "/onboarding/agreement", label: "Check status" },
      secondaryAction: { href: "/account", label: "Back to account" },
      nextSteps: [
        "We verify the completed document",
        "Your creator workspace unlocks",
      ],
    });

    expect(deriveCreatorOnboardingViewModel({
      ...input,
      agreementStatus: "creator_accepted",
    }).steps[3]).toMatchObject({
      state: "current",
      detail: "Confirmation pending",
    });
  });

  it("marks every step complete only after the protected account becomes active", () => {
    const model = deriveCreatorOnboardingViewModel({
      nextPath: "/account",
      stateAvailable: true,
      applicationStatus: "approved",
      agreementStatus: "completed",
    });

    expect(model.title).toBe("You’re in");
    expect(model.primaryAction).toEqual({
      href: "/account#creator-command-center-title",
      label: "Open creator workspace",
    });
    expect(model.steps).toHaveLength(4);
    expect(model.steps.every((step) => step.state === "complete")).toBe(true);
  });

  it("fails closed when the canonical account state is unavailable", () => {
    expect(deriveCreatorOnboardingViewModel({
      nextPath: null,
      stateAvailable: false,
      applicationStatus: "approved",
      agreementStatus: "completed",
    })).toMatchObject({
      title: "We couldn’t load your next step",
      statusLabel: "Temporarily unavailable",
      primaryAction: { href: "/account", label: "Try again" },
      nextSteps: [],
    });
  });
});

describe("creator onboarding progress", () => {
  it("renders four accessible steps with exactly one current step", () => {
    const model = deriveCreatorOnboardingViewModel({
      nextPath: "/onboarding/accounts",
      stateAvailable: true,
      applicationStatus: "approved",
      agreementStatus: "pending",
    });

    render(<CreatorOnboardingProgress steps={model.steps} />);

    const progress = screen.getByRole("list", { name: "Creator onboarding progress" });
    const steps = within(progress).getAllByRole("listitem");
    expect(steps).toHaveLength(4);
    expect(steps.filter((step) => step.getAttribute("aria-current") === "step")).toEqual([
      steps[2],
    ]);
    expect(steps[0]).toHaveAttribute("data-state", "complete");
    expect(steps[0]).toHaveTextContent("AccountComplete");
    expect(steps[2]).toHaveAttribute("data-state", "current");
    expect(steps[2]).toHaveTextContent("ProfilesAction required");
    expect(steps[3]).toHaveAttribute("data-state", "locked");
    expect(steps[3]).toHaveTextContent("AgreementLocked");
  });
});
