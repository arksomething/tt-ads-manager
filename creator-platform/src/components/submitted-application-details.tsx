import type { CreatorApplicationSnapshot } from "@/server/accounts/application";

function platformLabel(platform: CreatorApplicationSnapshot["accounts"][number]["platform"]) {
  return platform === "TIKTOK" ? "TikTok" : "Instagram";
}

function displayHandle(handle: string) {
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function submittedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

type SubmittedApplicationDetailsProps = {
  application: CreatorApplicationSnapshot;
  titleId: string;
};

export function SubmittedApplicationDetails({
  application,
  titleId,
}: SubmittedApplicationDetailsProps) {
  const dateLabel = submittedDate(application.submittedAt);

  return (
    <section className="account-submission" aria-labelledby={titleId}>
      <div className="account-submission__header">
        <div>
          <p className="eyebrow">Saved to your account</p>
          <h3 id={titleId}>Submitted details</h3>
        </div>
        {dateLabel ? (
          <time dateTime={application.submittedAt}>Submitted {dateLabel}</time>
        ) : null}
      </div>

      <dl className="application-review__identity">
        <div><dt>Name</dt><dd>{application.name}</dd></div>
        <div><dt>Phone number</dt><dd>{application.phoneNumber}</dd></div>
        <div className="application-review__wide">
          <dt>Discord username</dt><dd>{application.discordUsername}</dd>
        </div>
      </dl>

      <div className="application-review__accounts">
        <div className="application-review__section-heading">
          <h4>Submitted creator accounts</h4>
          <span>
            {application.accounts.length}{" "}
            {application.accounts.length === 1 ? "account" : "accounts"}
          </span>
        </div>
        {application.accounts.length ? (
          <ul>
            {application.accounts.map((account, index) => (
              <li key={`${account.platform}:${account.handle}:${index}`}>
                <span>{platformLabel(account.platform)}</span>
                <strong>{displayHandle(account.handle)}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="account-submission__empty">
            Creator account details are temporarily unavailable.
          </p>
        )}
        <p className="account-submission__note">
          These are the handles you submitted. They are not marked connected or verified until ownership checks are complete.
        </p>
      </div>
    </section>
  );
}
