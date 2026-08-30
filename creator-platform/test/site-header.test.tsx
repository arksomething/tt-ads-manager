import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SiteHeader } from "@/components/site-header";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

describe("site header", () => {
  it("opens an accessible mobile menu and restores focus when Escape closes it", async () => {
    const user = userEvent.setup();
    render(<SiteHeader />);

    const opener = screen.getByRole("button", { name: "Open navigation" });
    expect(opener).toHaveAttribute("aria-expanded", "false");

    await user.click(opener);
    expect(screen.getByRole("navigation", { name: "Mobile navigation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close navigation" })).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("navigation", { name: "Mobile navigation" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveFocus();
  });
});
