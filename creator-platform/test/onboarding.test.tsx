import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AccountVerificationPreview } from "@/components/account-verification-preview";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

describe("account verification preview", () => {
  it("keeps continuation disabled until both platform accounts are verified", () => {
    render(<AccountVerificationPreview />);

    expect(screen.getByLabelText("1 of 2 verified")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByText("Waiting for code")).toBeInTheDocument();
  });

  it("confirms the copy-code interaction", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<AccountVerificationPreview />);

    await user.click(screen.getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledWith("GT-DYLAN-482");
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(screen.getByText("Verification code copied.")).toBeInTheDocument();
  });

  it("does not claim success when clipboard access fails", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    render(<AccountVerificationPreview />);

    await user.click(screen.getByRole("button", { name: "Copy code" }));

    expect(screen.queryByRole("button", { name: "Copied" })).not.toBeInTheDocument();
    expect(screen.getByText(/could not copy automatically/i)).toBeInTheDocument();
  });
});
