import type { Metadata } from "next";

import styles from "./android.module.css";

const PLAY_TESTING_URL = "https://play.google.com/apps/testing/app.gotall.play";

export const metadata: Metadata = {
  title: "Get GoTall free on Android",
  description:
    "Join the GoTall Android testing program, install the app, and activate a free test subscription without being charged.",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

function GuideVideo({ label, src, poster }: { label: string; src: string; poster: string }) {
  return (
    <video
      aria-label={label}
      className={styles.video}
      controls
      muted
      playsInline
      poster={poster}
      preload="metadata"
    >
      <source src={src} type="video/mp4" />
      Your browser cannot play this video. You can still follow the written instructions on this page.
    </video>
  );
}

export default function AndroidGuidePage() {
  return (
    <main className={styles.page}>
      <article className={styles.article}>
        <h1>How to get GoTall for free on Android</h1>

        <p>First, open this link on your Android device:</p>

        <p>
          <a href={PLAY_TESTING_URL} rel="noreferrer" target="_blank">
            https://play.google.com/apps/testing/app.gotall.play
          </a>
        </p>

        <p>Follow the instructions in the video, then download the app.</p>

        <GuideVideo
          label="How to join the GoTall Android testing program and download the app"
          poster="/videos/android-free-access/install-poster.webp"
          src="/videos/android-free-access/install.mp4"
        />

        <p>
          After you are inside the app, complete the onboarding and answer the questions. If you
          want, you can keep the default settings and choose random things in the multiple choice.
          You can always change them later.
        </p>

        <p>You should reach the paywall shown in this video:</p>

        <GuideVideo
          label="What the GoTall paywall and Google Play test subscription sheet look like"
          poster="/videos/android-free-access/paywall-poster.webp"
          src="/videos/android-free-access/paywall.mp4"
        />

        <p>
          After you try to pay, the payment sheet at the bottom should say,
          <strong> “This is a test subscription… You will not be charged.”</strong>
        </p>

        <p>
          Press <strong>Pay</strong> or <strong>Subscribe</strong>. You will not be charged.
        </p>

        <p>
          If you have any issues, contact me on Discord at <strong>retconned.</strong> (the period is
          included), or as <strong>Evan - GoTall Developer</strong> on the Creator server.
        </p>
      </article>
    </main>
  );
}
