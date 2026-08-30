import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApplicationPreviewForm } from "@/components/application-preview-form";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

describe("application preview", () => {
  it("completes locally and explicitly confirms that nothing was submitted", async () => {
    const user = userEvent.setup();
    render(<ApplicationPreviewForm />);

    await user.click(screen.getByRole("radio", { name: /CPM/i }));
    await user.type(screen.getByRole("textbox", { name: "First name" }), "Dylan");
    await user.type(screen.getByRole("textbox", { name: "Email address" }), "dylan@example.com");
    await user.type(screen.getByRole("textbox", { name: "Discord username" }), "dylan");
    await user.type(screen.getByRole("textbox", { name: "Best video" }), "https://tiktok.com/@dylan/video/1");
    await user.selectOptions(screen.getByRole("combobox", { name: "How did you hear about us?" }), "Creator referral");
    await user.click(screen.getByRole("button", { name: /Review application/i }));

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Frontend flow complete");
    expect(status).toHaveTextContent("Nothing was submitted or stored");
  });
});
