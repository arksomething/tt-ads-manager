import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import Home from "@/app/page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

vi.mock("@/lib/server-env", () => ({
  hasSupabaseAuthEnv: () => false,
}));

vi.mock("@/server/auth/session", () => ({
  getCurrentAccount: vi.fn(),
}));

describe("creator program landing page", () => {
  it("leads with the creator journey and marks dashboard numbers as samples", async () => {
    render(await Home());

    expect(screen.getByRole("heading", { name: "Make the content. Know what happens next." })).toBeInTheDocument();
    expect(screen.getAllByText("Sample workspace").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /apply to create/i })).toHaveAttribute("href", "/apply");
    expect(screen.getByText(/estimated, under review, approved, and paid/i)).toBeInTheDocument();
    expect(screen.getByText(/program is designed around one standard deal/i)).toBeInTheDocument();
  });
});
