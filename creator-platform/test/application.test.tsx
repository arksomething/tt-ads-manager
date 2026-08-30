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
  it("asks only for identity, phone, Discord, and platform handles", () => {
    render(<ApplicationPreviewForm />);

    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Phone number" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Discord username" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Platform 1" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Creator handle 1" })).toBeInTheDocument();
    expect(screen.getByText("Standard creator deal")).toBeInTheDocument();

    expect(screen.queryByRole("textbox", { name: "Email address" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Best video" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "How did you hear about us?" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("supports multiple platform handles and completes only in the browser", async () => {
    const user = userEvent.setup();
    render(<ApplicationPreviewForm />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Dylan Smith");
    await user.type(screen.getByRole("textbox", { name: "Phone number" }), "+1 555 555 0123");
    await user.type(screen.getByRole("textbox", { name: "Discord username" }), "dylan");
    await user.type(screen.getByRole("textbox", { name: "Creator handle 1" }), "@dylan.grows");
    await user.click(screen.getByRole("button", { name: "Add another handle" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Platform 2" }), "INSTAGRAM_REELS");
    await user.type(screen.getByRole("textbox", { name: "Creator handle 2" }), "@dylan.builds");
    await user.click(screen.getByRole("button", { name: /Review application/i }));

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Frontend flow complete");
    expect(status).toHaveTextContent("standard creator deal would be assigned automatically");
    expect(status).toHaveTextContent("Nothing was submitted or stored");
  });

  it("focuses added handles and prevents duplicate platform accounts", async () => {
    const user = userEvent.setup();
    render(<ApplicationPreviewForm />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Dylan Smith");
    await user.type(screen.getByRole("textbox", { name: "Phone number" }), "+1 555 555 0123");
    await user.type(screen.getByRole("textbox", { name: "Discord username" }), "dylan");
    await user.type(screen.getByRole("textbox", { name: "Creator handle 1" }), "@Dylan.Grows");
    await user.click(screen.getByRole("button", { name: "Add another handle" }));

    const secondHandle = screen.getByRole("textbox", { name: "Creator handle 2" });
    expect(secondHandle).toHaveFocus();
    await user.type(secondHandle, "dylan.grows");
    await user.click(screen.getByRole("button", { name: /Review application/i }));

    expect(screen.getByText("That platform and handle are already listed.")).toBeInTheDocument();
    expect(secondHandle).toHaveAttribute("aria-invalid", "true");
    expect(secondHandle).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Remove account 2" }));
    expect(screen.queryByRole("textbox", { name: "Creator handle 2" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Creator handle 1" })).toHaveFocus();
  });
});
