import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AndroidGuidePage, { metadata } from "@/app/access/android-7c91f4a2b6e8/page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

describe("Android free-access guide", () => {
  it("publishes the testing link, both videos, and the no-charge checkpoint", () => {
    const { container } = render(<AndroidGuidePage />);

    expect(screen.getByRole("heading", { name: "How to get GoTall for free on Android" })).toBeInTheDocument();

    const testingLinks = screen.getAllByRole("link", { name: /testing/i });
    expect(testingLinks).toHaveLength(1);
    testingLinks.forEach((link) => {
      expect(link).toHaveAttribute(
        "href",
        "https://play.google.com/apps/testing/app.gotall.play",
      );
    });

    const videos = container.querySelectorAll("video");
    expect(videos).toHaveLength(2);
    expect(within(videos[0]).getByText(/browser cannot play this video/i)).toBeInTheDocument();
    expect(videos[0].querySelector("source")).toHaveAttribute(
      "src",
      "/videos/android-free-access/install.mp4",
    );
    expect(videos[1].querySelector("source")).toHaveAttribute(
      "src",
      "/videos/android-free-access/paywall.mp4",
    );

    expect(screen.getAllByText(/you will not be charged/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("retconned.")).toBeInTheDocument();
    expect(metadata.title).toBe("Get GoTall free on Android");
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
