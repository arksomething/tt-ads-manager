import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminStaffPage from "@/app/admin/staff/page";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  directory: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));
vi.mock("@/server/admin/access", () => ({ requireCreatorAdmin: mocks.requireAdmin }));
vi.mock("@/server/admin/staff", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/admin/staff")>();
  return { ...original, getAdminStaffDirectory: mocks.directory };
});

const directory = {
  staffMembers: [
    { email: "admin@example.com", role: "admin" as const, active: true, emailConfirmed: true },
    { email: "reviewer@example.com", role: "reviewer" as const, active: true, emailConfirmed: true },
    { email: "former@example.com", role: "reviewer" as const, active: false, emailConfirmed: true },
  ],
  recentEvents: [{
    actor: "ops@example.com",
    targetEmail: "reviewer@example.com",
    priorRole: null,
    priorActive: null,
    newRole: "reviewer" as const,
    newActive: true as const,
    outcome: "added" as const,
    createdAt: "2026-09-03T12:00:00.000Z",
  }],
};

describe("admin staff page", () => {
  beforeEach(() => {
    mocks.requireAdmin.mockReset();
    mocks.directory.mockReset();
    mocks.refresh.mockReset();
    vi.unstubAllGlobals();
    mocks.requireAdmin.mockResolvedValue({
      account: { id: "admin-1", email: "admin@example.com" },
      staff: { role: "admin" },
    });
    mocks.directory.mockResolvedValue(directory);
  });

  it("uses the admin guard and renders only minimal staff status", async () => {
    const { container } = render(await AdminStaffPage());

    expect(mocks.requireAdmin).toHaveBeenCalledWith("/admin/staff");
    expect(screen.getByRole("heading", { name: "Staff access" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Staff" })).toHaveAttribute("href", "/admin/staff");
    expect(screen.getByText("admin@example.com")).toBeInTheDocument();
    expect(screen.getAllByText("reviewer@example.com")).toHaveLength(2);
    expect(screen.getByText("former@example.com")).toBeInTheDocument();
    expect(screen.getByText("Active administrators").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Active reviewers").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Inactive staff").parentElement).toHaveTextContent("1");
    expect(screen.getByRole("heading", { name: "Recent access changes" })).toBeInTheDocument();
    expect(screen.getByText("ops@example.com")).toBeInTheDocument();
    expect(screen.getByText("Added as Reviewer")).toBeInTheDocument();
    expect(screen.getByText(/does not prove two distinct humans/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Type to confirm administrator access/i)).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("authUserId");
    expect(container.textContent).not.toContain("provider");
    expect(screen.queryByRole("button", { name: /delete|deactivate|demote|change role/i })).not.toBeInTheDocument();
  });

  it("fails closed and hides mutation controls when the directory is unavailable", async () => {
    mocks.directory.mockRejectedValue(new Error("RPC unavailable"));
    render(await AdminStaffPage());

    expect(screen.getByRole("alert")).toHaveTextContent(/access changes are disabled/i);
    expect(screen.queryByRole("button", { name: /add or reactivate/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Existing account email/i)).not.toBeInTheDocument();
  });

  it("fails closed when the directory omits every active administrator", async () => {
    mocks.directory.mockResolvedValue({
      staffMembers: [{
        email: "former@example.com",
        role: "reviewer",
        active: false,
        emailConfirmed: true,
      }],
    });
    render(await AdminStaffPage());
    expect(screen.getByRole("alert")).toHaveTextContent(/did not include an active administrator/i);
    expect(screen.queryByRole("button", { name: /add or reactivate/i })).not.toBeInTheDocument();
  });

  it("submits only normalized email and role, then refreshes verified state", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        staffMember: {
          email: "new.staff@example.com",
          role: "admin",
          active: true,
          emailConfirmed: true,
        },
        requestOutcome: "added",
      }),
    }));
    render(await AdminStaffPage());

    await user.type(screen.getByLabelText(/Existing account email/i), "New.Staff@Example.COM");
    await user.selectOptions(screen.getByLabelText(/Access role/i), "admin");
    const confirmation = "GRANT ADMIN ACCESS TO new.staff@example.com";
    expect(screen.getByText(confirmation)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Type to confirm administrator access/i), confirmation);
    await user.click(screen.getByRole("button", { name: "Add or reactivate staff" }));

    expect(fetch).toHaveBeenCalledWith("/api/admin/staff", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }));
    const options = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(options.body))).toEqual({
      email: "new.staff@example.com",
      role: "admin",
      confirmation,
    });
    expect(await screen.findByRole("status")).toHaveTextContent(/active administrator access/i);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not claim success or refresh on a rejected access change", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ error: "No existing confirmed account matches." }),
    }));
    render(await AdminStaffPage());

    await user.type(screen.getByLabelText(/Existing account email/i), "missing@example.com");
    await user.click(screen.getByRole("button", { name: "Add or reactivate staff" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no existing confirmed account/i);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not claim success when the response belongs to a different request", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        staffMember: {
          email: "different@example.com",
          role: "reviewer",
          active: true,
          emailConfirmed: true,
        },
        requestOutcome: "added",
      }),
    }));
    render(await AdminStaffPage());

    await user.type(screen.getByLabelText(/Existing account email/i), "staff@example.com");
    await user.click(screen.getByRole("button", { name: "Add or reactivate staff" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be saved/i);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
