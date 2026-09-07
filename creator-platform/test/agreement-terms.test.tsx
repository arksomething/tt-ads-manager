import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  AgreementTerms,
  parseAgreementTermsMarkdown,
} from "@/components/agreement-terms";

const markdown = [
  "# Creator Agreement",
  "",
  "This **first paragraph** continues",
  "on the next `source` line.",
  "",
  "## Payment",
  "- First payment item",
  "* Second __payment item__",
  "",
  "### Content rights",
  "GoTall owns the accepted Deliverable.",
].join("\r\n");

describe("agreement terms markdown", () => {
  it("parses headings, joined paragraphs, and contiguous bullet lists", () => {
    expect(parseAgreementTermsMarkdown(markdown)).toEqual([
      { type: "heading", level: 1, text: "Creator Agreement" },
      {
        type: "paragraph",
        text: "This first paragraph continues on the next source line.",
      },
      { type: "heading", level: 2, text: "Payment" },
      {
        type: "list",
        items: ["First payment item", "Second payment item"],
      },
      { type: "heading", level: 3, text: "Content rights" },
      { type: "paragraph", text: "GoTall owns the accepted Deliverable." },
    ]);
  });

  it("renders assigned terms as semantic headings, paragraphs, and list items", () => {
    render(<AgreementTerms markdown={markdown} />);

    expect(screen.getByRole("heading", { level: 2, name: "Creator Agreement" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Payment" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Content rights" })).toBeInTheDocument();
    expect(screen.getByText("This first paragraph continues on the next source line.")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "First payment item",
      "Second payment item",
    ]);
    expect(screen.getByText("GoTall owns the accepted Deliverable.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("**");
    expect(document.body).not.toHaveTextContent("__");
    expect(document.body).not.toHaveTextContent("`source`");
  });

  it("offsets headings for an embedded agreement without breaking the page hierarchy", () => {
    render(<AgreementTerms markdown={markdown} headingOffset={3} />);

    expect(screen.getByRole("heading", { level: 4, name: "Creator Agreement" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 5, name: "Payment" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 6, name: "Content rights" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();
  });

  it("returns no invented blocks for empty terms", () => {
    expect(parseAgreementTermsMarkdown(" \r\n\r\n ")).toEqual([]);
  });
});
