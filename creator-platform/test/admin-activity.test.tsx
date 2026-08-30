import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AdminActivityPreview } from "@/components/admin-activity-preview";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

describe("admin activity preview", () => {
  it("opens explicit activity detail from a keyboard-usable day cell", async () => {
    const user = userEvent.setup();
    render(<AdminActivityPreview />);

    const cell = screen.getByRole("button", { name: "Dylan, Jun 2: 1 tracked post" });
    cell.focus();
    await user.keyboard("{Enter}");

    expect(cell).toHaveAttribute("aria-pressed", "true");
    const detail = screen.getByRole("complementary", { name: "Activity detail" });
    expect(detail).toHaveTextContent("Dylan · Jun 2");
    expect(detail).toHaveTextContent("1 tracked post");
  });

  it("explains the activity calculation instead of leaving the help control inert", async () => {
    const user = userEvent.setup();
    render(<AdminActivityPreview />);

    await user.click(screen.getByRole("button", { name: "How activity is calculated" }));
    expect(screen.getByRole("heading", { name: "Observed posts, not guessed zeros" })).toBeInTheDocument();
    expect(screen.getByText(/missing, stale, or source-restricted observations remain explicit/i)).toBeInTheDocument();
  });
});
