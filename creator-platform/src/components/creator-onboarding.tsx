import Link from "next/link";
import { ArrowRight, Check, LockKeyhole } from "lucide-react";

import type {
  CreatorOnboardingStep,
  CreatorOnboardingViewModel,
} from "@/lib/creator-onboarding";

import styles from "./creator-onboarding.module.css";

function StepIcon({ step, number }: { step: CreatorOnboardingStep; number: number }) {
  if (step.state === "complete") return <Check aria-hidden="true" size={15} />;
  if (step.state === "locked") return <LockKeyhole aria-hidden="true" size={13} />;
  return <>{number}</>;
}

export function CreatorOnboardingProgress({
  steps,
}: {
  steps: CreatorOnboardingStep[];
}) {
  return (
    <ol className={styles.progress} aria-label="Creator onboarding progress">
      {steps.map((step, index) => (
        <li
          aria-current={step.state === "current" ? "step" : undefined}
          data-state={step.state}
          key={step.key}
        >
          <span className={styles.stepIcon} aria-hidden="true">
            <StepIcon step={step} number={index + 1} />
          </span>
          <span className={styles.stepCopy}>
            <strong>{step.label}</strong>
            <span>{step.detail}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function CreatorOnboardingHome({
  model,
  firstName,
  notice,
  error,
  children,
}: {
  model: CreatorOnboardingViewModel;
  firstName?: string | null;
  notice?: string | null;
  error?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <section className={styles.page}>
      <header className={styles.intro}>
        <h1>{firstName ? `Welcome, ${firstName}.` : "Welcome to GoTall"}</h1>
        <p>Complete four short steps to join the creator program.</p>
      </header>

      <CreatorOnboardingProgress steps={model.steps} />

      {notice ? <p className="auth-message auth-message--notice" role="status">{notice}</p> : null}
      {error ? <p className="auth-message auth-message--error" role="alert">{error}</p> : null}

      <section className={styles.currentCard} aria-labelledby="creator-onboarding-current-title">
        <div className={styles.currentHeader}>
          <div>
            <p className={styles.eyebrow}>{model.eyebrow}</p>
            <h2 id="creator-onboarding-current-title">{model.title}</h2>
            <p className={styles.description}>{model.description}</p>
          </div>
          {model.statusLabel ? <span className={styles.status}>{model.statusLabel}</span> : null}
        </div>

        {model.decisionMessage ? (
          <p className={styles.decision} role="status"><strong>Creator team:</strong> {model.decisionMessage}</p>
        ) : null}

        {model.primaryAction || model.secondaryAction ? (
          <div className={styles.actions}>
            {model.primaryAction ? (
              <Link className={styles.primary} href={model.primaryAction.href}>
                {model.primaryAction.label}
                <ArrowRight aria-hidden="true" size={15} />
              </Link>
            ) : null}
            {model.secondaryAction ? (
              <Link className={styles.secondary} href={model.secondaryAction.href}>
                {model.secondaryAction.label}
              </Link>
            ) : null}
          </div>
        ) : null}
      </section>

      {model.nextSteps.length ? (
        <section className={styles.next} aria-labelledby="creator-onboarding-next-title">
          <h2 id="creator-onboarding-next-title">What happens next</h2>
          <ol>
            {model.nextSteps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </section>
      ) : null}

      {children ? <div className={styles.details}>{children}</div> : null}
    </section>
  );
}
