import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ContentSubmissionForm } from "@/components/content-submission-form";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

describe("content submission form", () => {
  it("submits published content without accepting attribution or earning controls", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ submissionId: "submission-1", matchState: "submitted" }),
    } as Response);

    render(<ContentSubmissionForm canSubmit platformAccounts={[{
      id: "d9428888-122b-4f22-9f8e-fadce93715ed",
      platform: "TIKTOK",
      handle: "creator",
    }]} />);

    await user.selectOptions(screen.getByRole("combobox", { name: /verified creator account/i }), "d9428888-122b-4f22-9f8e-fadce93715ed");
    await user.type(screen.getByRole("textbox", { name: "Published post URL" }), "https://tiktok.com/@creator/video/123");
    await user.type(screen.getByRole("textbox", { name: /Native post ID/i }), "123");
    await user.type(screen.getByRole("textbox", { name: /Note/i }), "Campaign launch");
    await user.click(screen.getByRole("button", { name: "Submit published post" }));

    expect(fetchSpy).toHaveBeenCalledWith("/api/content-submissions", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        platform: "TIKTOK",
        url: "https://tiktok.com/@creator/video/123",
        platformAccountId: "d9428888-122b-4f22-9f8e-fadce93715ed",
        nativePostId: "123",
        note: "Campaign launch",
      }),
    }));
    expect(screen.getByRole("status")).toHaveTextContent(/waiting for attribution review/i);
    expect(mocks.refresh).toHaveBeenCalled();
    expect(screen.queryByLabelText(/earnings/i)).not.toBeInTheDocument();
    fetchSpy.mockRestore();
  });

  it("stays disabled and explains the active-enrollment gate", () => {
    render(<ContentSubmissionForm canSubmit={false} platformAccounts={[]} />);
    expect(screen.getByRole("button", { name: "Submit published post" })).toBeDisabled();
    expect(screen.getByText(/unlocks when your creator enrollment becomes active/i)).toBeInTheDocument();
  });
});
