import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import StandardAgreementPage from "@/app/standard-agreement/page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

describe("public standard agreement sample", () => {
  it("labels the document as non-binding and keeps the assigned agreement controlling", () => {
    render(<StandardAgreementPage />);

    expect(screen.getByRole("heading", { level: 1, name: "GoTall Standard Creator Agreement" }))
      .toBeInTheDocument();
    expect(screen.getAllByText("DRAFT — NON-BINDING — NOT FOR SIGNATURE")).not.toHaveLength(0);
    expect(screen.getByRole("heading", { name: "Read this before relying on the sample" }))
      .toBeInTheDocument();
    expect(screen.getByText(/GoTall has not activated a default deal version/u)).toBeInTheDocument();
    expect(screen.getByText(/An assigned, signed version controls/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign/iu })).not.toBeInTheDocument();
  });

  it("renders explicit content ownership and paid-advertising rights", () => {
    render(<StandardAgreementPage />);

    expect(screen.getByRole("heading", {
      name: "GoTall owns accepted program content and may use it in paid media.",
    })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Ownership of Deliverables/u })).toBeInTheDocument();
    expect(screen.getByRole("heading", {
      name: /Advertising, platform, and publicity rights/u,
    })).toBeInTheDocument();
    expect(screen.getByText(/irrevocably assigns, transfers, and conveys to GoTall/u))
      .toBeInTheDocument();
    expect(screen.getAllByText(/Spark Ads/u)).not.toHaveLength(0);
    expect(screen.getAllByText(/Partnership Ads/u)).not.toHaveLength(0);
    expect(screen.getByText(/Creator keeps ownership of Creator’s social-media account/u))
      .toBeInTheDocument();
  });

  it("links to the checked-in versioned DOCX artifact", () => {
    render(<StandardAgreementPage />);

    const href = "/documents/gotall-standard-creator-agreement-sample-v0.1.docx";
    const download = screen.getByRole("link", { name: "Download DOCX" });
    expect(download).toHaveAttribute("href", href);
    expect(download).toHaveAttribute("download");

    const artifact = resolve(process.cwd(), "public", href.replace(/^\//u, ""));
    expect(existsSync(artifact)).toBe(true);
    expect(statSync(artifact).size).toBeGreaterThan(0);
  });
});
