import { existsSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminWorkspaceShell } from "@/components/admin-workspace-shell";
import { ContentLibraryHeader } from "@/components/content-library-header";
import { CreatorWorkspaceShell } from "@/components/creator-workspace-shell";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}));

function expectPageExists(href: string) {
  expect(existsSync(join(process.cwd(), "src/app", href, "page.tsx")), href).toBe(true);
}

describe("creator-platform navigation integrity", () => {
  afterEach(() => cleanup());

  it("keeps every admin workspace destination backed by a real page", () => {
    render(
      <AdminWorkspaceShell
        active="content"
        role="admin"
        eyebrow="Operations"
        title="Content"
        description="Review content."
      >Workspace</AdminWorkspaceShell>,
    );

    const navigation = screen.getByRole("navigation", { name: "Creator operations" });
    const destinations = Array.from(navigation.querySelectorAll("a")).map((link) => link.getAttribute("href"));
    expect(destinations).toEqual([
      "/admin",
      "/admin/applications",
      "/admin/creators",
      "/admin/verifications",
      "/admin/content",
      "/admin/scripts",
      "/admin/assets",
      "/admin/deals",
      "/admin/finance",
      "/admin/discord",
      "/admin/staff",
    ]);
    destinations.forEach((href) => expectPageExists(href!));
  });

  it("keeps staff management out of reviewer navigation", () => {
    render(
      <AdminWorkspaceShell
        active="home"
        role="reviewer"
        eyebrow="Operations"
        title="Home"
        description="Review creator operations."
      >Workspace</AdminWorkspaceShell>,
    );

    expect(screen.queryByRole("link", { name: "Staff" })).not.toBeInTheDocument();
  });

  it("keeps creator destinations real and exposes the current script or asset page", () => {
    render(
      <CreatorWorkspaceShell
        active="earnings"
        eyebrow="Finance"
        title="Earnings"
        description="Recorded amounts."
        accountEmail="creator@example.com"
      >Workspace</CreatorWorkspaceShell>,
    );
    const creatorNavigation = screen.getByRole("complementary", { name: "Creator account navigation" });
    Array.from(creatorNavigation.querySelectorAll("a"))
      .map((link) => link.getAttribute("href"))
      .forEach((href) => expectPageExists(href!));
    cleanup();

    render(<ContentLibraryHeader active="scripts" />);
    expect(screen.getByRole("link", { name: "Scripts" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Assets" })).not.toHaveAttribute("aria-current");
  });
});
