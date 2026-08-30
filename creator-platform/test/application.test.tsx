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

  it("reviews every value, preserves edits, and submits through the authenticated API", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ applicationId: "application-1", status: "submitted" }),
    } as Response);
    render(<ApplicationPreviewForm accountEmail="dylan@example.com" />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Dylan Smith");
    await user.type(screen.getByRole("textbox", { name: "Phone number" }), "+1 555 555 0123");
    await user.type(screen.getByRole("textbox", { name: "Discord username" }), "dylan");
    await user.type(screen.getByRole("textbox", { name: "Creator handle 1" }), "@dylan.grows");
    await user.click(screen.getByRole("button", { name: "Add another handle" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Platform 2" }), "INSTAGRAM_REELS");
    await user.type(screen.getByRole("textbox", { name: "Creator handle 2" }), "@dylan.builds");
    await user.click(screen.getByRole("button", { name: /Review application/i }));

    const reviewHeading = screen.getByRole("heading", { name: "Review your application" });
    expect(reviewHeading).toHaveFocus();
    expect(screen.getByText("Final check")).toBeInTheDocument();
    expect(screen.getByText("Dylan Smith")).toBeInTheDocument();
    expect(screen.getByText("+1 555 555 0123")).toBeInTheDocument();
    expect(screen.getByText("dylan")).toBeInTheDocument();
    expect(screen.getByText("@dylan.grows")).toBeInTheDocument();
    expect(screen.getByText("@dylan.builds")).toBeInTheDocument();
    expect(screen.getByText("Signing is a separate onboarding step")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit details" }));
    const nameInput = screen.getByRole("textbox", { name: "Name" });
    expect(nameInput).toHaveFocus();
    expect(nameInput).toHaveValue("Dylan Smith");
    expect(screen.getByRole("textbox", { name: "Phone number" })).toHaveValue("+1 555 555 0123");
    expect(screen.getByRole("textbox", { name: "Creator handle 2" })).toHaveValue("@dylan.builds");

    await user.clear(nameInput);
    await user.type(nameInput, "Dylan Jones");
    await user.click(screen.getByRole("button", { name: /Review application/i }));
    expect(screen.getByText("Dylan Jones")).toBeInTheDocument();
    expect(screen.queryByText("Dylan Smith")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Submit application" }));
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Application submitted");
    expect(status).toHaveTextContent("with the creator team");
    expect(screen.getByRole("heading", { name: "Your application is with the creator team." })).toHaveFocus();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/applications",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"name":"Dylan Jones"'),
      }),
    );
    fetchSpy.mockRestore();
  });

  it("keeps the review visible when the application API rejects submission", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Application service is unavailable." }),
    } as Response);
    render(<ApplicationPreviewForm />);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Dylan Smith");
    await user.type(screen.getByRole("textbox", { name: "Phone number" }), "+1 555 555 0123");
    await user.type(screen.getByRole("textbox", { name: "Discord username" }), "dylan");
    await user.type(screen.getByRole("textbox", { name: "Creator handle 1" }), "@dylan.grows");
    await user.click(screen.getByRole("button", { name: /Review application/i }));
    await user.click(screen.getByRole("button", { name: "Submit application" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Application service is unavailable.");
    expect(screen.getByRole("heading", { name: "Review your application" })).toBeInTheDocument();
    fetchSpy.mockRestore();
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
