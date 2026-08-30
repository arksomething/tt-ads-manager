import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CreatorDashboardPreview } from "@/components/creator-dashboard-preview";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

describe("creator dashboard preview", () => {
  it("switches the shared chart from views to earnings", async () => {
    const user = userEvent.setup();
    render(<CreatorDashboardPreview />);

    expect(screen.getByText("2,401,234")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Earnings" }));
    expect(screen.getByText("$842.16")).toBeInTheDocument();
    expect(screen.getByText(/estimated sample · stale · not approved/i)).toBeInTheDocument();
  });

  it("traps focus in the inbox, closes on Escape, and restores the opener", async () => {
    const user = userEvent.setup();
    render(<CreatorDashboardPreview />);

    const opener = screen.getAllByRole("button", { name: "Open inbox" })[0];
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Inbox" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close inbox" })).toHaveFocus();

    const lastAction = screen.getByRole("button", { name: "Start a new message" });
    lastAction.focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Close inbox" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Inbox" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("turns activity and missing-post controls into explicit preview detail", async () => {
    const user = userEvent.setup();
    render(<CreatorDashboardPreview />);

    await user.click(screen.getByRole("button", { name: "How this works" }));
    expect(screen.getByRole("heading", { name: "What counts as activity" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Report a missing post" }));
    expect(screen.getByRole("heading", { name: "Reporting is preview-only" })).toBeInTheDocument();
    expect(screen.getByText(/no report was sent/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Day 2: 1 post" }));
    expect(screen.getByText("Sample day 2")).toBeInTheDocument();
  });
});
