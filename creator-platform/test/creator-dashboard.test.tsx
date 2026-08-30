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

    const calendar = screen.getByRole("group", { name: "Sample posting activity over fifty-two weeks" });
    const activityDays = calendar.querySelectorAll("button");
    expect(activityDays).toHaveLength(364);
    expect(screen.getByText("Sample calendar")).toBeInTheDocument();
    expect(activityDays[1]).toHaveAccessibleName("Tuesday, June 3, 2025: 1 tracked post (sample)");
    expect(Array.from(activityDays).filter((day) => day.tabIndex === 0)).toHaveLength(1);
    expect(activityDays[363]).toHaveAttribute("tabindex", "0");

    activityDays[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(activityDays[7]).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowLeft}");
    expect(activityDays[1]).toHaveFocus();

    await user.click(activityDays[1]);
    expect(screen.getByText("Sample day 2 · Jun 3")).toBeInTheDocument();
  });
});
