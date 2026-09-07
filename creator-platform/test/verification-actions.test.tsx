import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  VerificationCodeCopy,
  VerificationStatusRefresh,
} from "@/components/verification-actions";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

function setClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

describe("verification actions", () => {
  beforeEach(() => {
    mocks.refresh.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });

  it("copies the exact verification code and confirms success accessibly", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    render(<VerificationCodeCopy code="GT-ABC123" />);

    await user.click(screen.getByRole("button", {
      name: "Copy verification code GT-ABC123",
    }));

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith("GT-ABC123");
    expect(screen.getByRole("button", {
      name: "Copy verification code GT-ABC123",
    })).toHaveTextContent("Copied");
    expect(screen.getByRole("status")).toHaveTextContent("Verification code copied.");
  });

  it("shows a useful fallback message when clipboard access fails", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
    setClipboard(writeText);
    render(<VerificationCodeCopy code="GT-ABC123" />);

    await user.click(screen.getByRole("button", {
      name: "Copy verification code GT-ABC123",
    }));

    expect(writeText).toHaveBeenCalledWith("GT-ABC123");
    expect(screen.getByRole("button", {
      name: "Copy verification code GT-ABC123",
    })).toHaveTextContent("Copy");
    expect(screen.getByRole("status")).toHaveTextContent(
      "The code could not be copied automatically. Select and copy the visible code.",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("Verification code copied.");
  });

  it("refreshes the server-backed verification status", async () => {
    const user = userEvent.setup();
    render(<VerificationStatusRefresh />);

    await user.click(screen.getByRole("button", { name: "Refresh status" }));

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
  });
});
