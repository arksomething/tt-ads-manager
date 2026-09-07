import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PasswordField } from "@/components/password-field";

describe("password field", () => {
  it("reveals and hides the value without changing it or submitting the form", async () => {
    const user = userEvent.setup();
    render(
      <form>
        <PasswordField
          autoComplete="current-password"
          label="Password"
          name="password"
        />
      </form>,
    );

    const input = screen.getByLabelText("Password");
    const showButton = screen.getByRole("button", { name: "Show password" });

    expect(input).toHaveAttribute("type", "password");
    expect(showButton).toHaveAttribute("type", "button");
    expect(showButton).toHaveAttribute("aria-controls", input.id);
    expect(showButton).toHaveAttribute("aria-pressed", "false");

    await user.type(input, "a secure password");
    await user.click(showButton);

    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveValue("a secure password");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Hide password" }));

    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveValue("a secure password");
  });

  it("gives confirmation controls a field-specific accessible name", () => {
    render(
      <PasswordField
        autoComplete="new-password"
        label="Confirm new password"
        name="passwordConfirm"
      />,
    );

    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(
      screen.getByRole("button", { name: "Show confirm new password" }),
    ).toBeInTheDocument();
  });
});
