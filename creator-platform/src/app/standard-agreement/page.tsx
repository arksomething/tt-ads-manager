import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Download, ShieldCheck } from "lucide-react";

import agreementData from "@/content/standard-creator-agreement-sample.json";
import { BrandMark } from "@/components/brand-mark";

import styles from "./standard-agreement.module.css";

export const metadata: Metadata = {
  title: "Sample standard creator agreement",
  description: "Non-binding sample of the proposed GoTall standard creator agreement.",
};

export default function StandardAgreementPage() {
  return (
    <main className={styles.page}>
      <header className={styles.siteHeader}>
        <Link href="/" className="wordmark"><BrandMark /><span>Creator program</span></Link>
        <Link className={styles.backLink} href="/account">
          <ArrowLeft aria-hidden="true" size={15} />
          Back to account
        </Link>
      </header>

      <article className={styles.document}>
        <header className={styles.documentHeader}>
          <div className={styles.status}>{agreementData.status}</div>
          <div className={styles.titleRow}>
            <div>
              <p>GoTall creator program</p>
              <h1>{agreementData.documentTitle}</h1>
              <span>{agreementData.version} · {agreementData.documentDate}</span>
            </div>
            <a
              className={styles.download}
              download
              href="/documents/gotall-standard-creator-agreement-sample-v0.1.docx"
            >
              <Download aria-hidden="true" size={15} />
              Download DOCX
            </a>
          </div>
          <p className={styles.summary}>{agreementData.summary}</p>
        </header>

        <section className={styles.notice} aria-labelledby="sample-notice-title">
          <ShieldCheck aria-hidden="true" size={22} />
          <div>
            <h2 id="sample-notice-title">Read this before relying on the sample</h2>
            {agreementData.notices.map((notice) => <p key={notice}>{notice}</p>)}
          </div>
        </section>

        <section className={styles.parties} aria-label="Sample agreement parties">
          <div><span>Company</span><strong>{agreementData.parties.company}</strong></div>
          <div><span>Creator</span><strong>{agreementData.parties.creator}</strong></div>
          <div><span>Effective date</span><strong>{agreementData.parties.effectiveDate}</strong></div>
        </section>

        <section className={styles.keyTerms} aria-labelledby="key-terms-title">
          <div className={styles.sectionHeading}>
            <span>Deal overview</span>
            <h2 id="key-terms-title">Proposed key terms</h2>
          </div>
          <div className={styles.keyTermGrid}>
            {agreementData.keyTerms.map((term) => (
              <article key={term.label}>
                <span>{term.label}</span>
                <strong>{term.value}</strong>
                <small>{term.status}</small>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.rightsCallout} aria-labelledby="rights-summary-title">
          <span>Content and advertising rights</span>
          <h2 id="rights-summary-title">GoTall owns accepted program content and may use it in paid media.</h2>
          <p>
            The proposed language combines work-made-for-hire treatment with a present copyright
            assignment, editing and derivative rights, a publicity release, and express permission
            for Spark Ads, Partnership Ads, and other paid placements. Creator accounts and unrelated
            pre-existing content remain the creator’s property.
          </p>
        </section>

        <section className={styles.body} aria-label="Full sample agreement">
          <div className={styles.recitals}>
            {agreementData.recitals.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>

          {agreementData.sections.map((section) => (
            <section className={styles.clause} id={"section-" + section.number} key={section.number}>
              <h2><span>{section.number}.</span> {section.title}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.bullets.length ? (
                <ul>
                  {section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                </ul>
              ) : null}
            </section>
          ))}
        </section>

        <section className={styles.schedule} aria-labelledby="schedule-a-title">
          <div className={styles.sectionHeading}>
            <span>Deal schedule</span>
            <h2 id="schedule-a-title">{agreementData.scheduleA.title}</h2>
          </div>
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>Term</th><th>Proposed value</th><th>Approval state</th></tr></thead>
              <tbody>
                {agreementData.scheduleA.rows.map((row) => (
                  <tr key={row.term}>
                    <th scope="row">{row.term}</th>
                    <td>{row.proposedValue}</td>
                    <td>{row.approvalState}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.brief} aria-labelledby="campaign-brief-title">
          <div className={styles.sectionHeading}>
            <span>Per assignment</span>
            <h2 id="campaign-brief-title">Campaign Brief fields</h2>
          </div>
          <ul>{agreementData.campaignBriefFields.map((field) => <li key={field}>{field}</li>)}</ul>
        </section>

        <section className={styles.references} aria-labelledby="drafting-references-title">
          <div className={styles.sectionHeading}>
            <span>Drafting references</span>
            <h2 id="drafting-references-title">Primary sources reviewed</h2>
          </div>
          <ul>
            {agreementData.references.map((reference) => (
              <li key={reference.url}>
                <a href={reference.url} rel="noreferrer">{reference.title}</a>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.signatures} aria-labelledby="signature-title">
          <div className={styles.sectionHeading}>
            <span>Sample only</span>
            <h2 id="signature-title">Signature blocks</h2>
          </div>
          <div>
            {agreementData.signatureBlocks.map((signature) => (
              <article key={signature.label}>
                <strong>{signature.label}</strong>
                <span>Name: {signature.name}</span>
                <span>Title: {signature.title}</span>
                <span>Date: {signature.date}</span>
              </article>
            ))}
          </div>
        </section>

        <footer className={styles.footer}>
          <strong>{agreementData.status}</strong>
          <span>{agreementData.version} · An assigned, signed version controls.</span>
        </footer>
      </article>
    </main>
  );
}
