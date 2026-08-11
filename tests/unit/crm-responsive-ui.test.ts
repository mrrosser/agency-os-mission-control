import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(...parts: string[]) {
  return readFileSync(join(process.cwd(), ...parts), "utf8");
}

describe("CRM responsive UI source", () => {
  it("exposes CRM in desktop and accessible mobile navigation", () => {
    const source = readSource("app", "dashboard", "layout.tsx");

    expect(source).toContain('{ href: "/dashboard/crm", label: "CRM"');
    expect(source).toContain('aria-label="Open navigation menu"');
    expect(source).toContain('aria-current={isActive ? "page" : undefined}');
    expect(source).toContain('aria-label={label}');
    expect(source).toContain("lg:flex");
    expect(source).toContain("lg:hidden");
  });

  it("keeps desktop drag and drop while providing a compact phone stage control", () => {
    const source = readSource("app", "dashboard", "crm", "page.tsx");

    expect(source).toContain('data-testid="crm-mobile-list"');
    expect(source).toContain('data-testid="crm-desktop-board"');
    expect(source).toContain('aria-label={`Pipeline stage for ${lead.companyName}`}');
    expect(source).toContain("void updateLeadStage(lead.id");
    expect(source).toContain("<DragDropContext onDragEnd={onDragEnd}>");
    expect(source).toContain('if (value === "rosser_nft_gallery") return "Rosser Gallery";');
    expect(source).not.toContain(">Rosser NFT Gallery<");
  });

  it("keeps the canonical registry read-only, fail-closed, and separate from leads", () => {
    const page = readSource("app", "dashboard", "crm", "page.tsx");
    const panel = readSource("components", "crm", "portfolio-registry-summary.tsx");

    expect(page).toContain('fetch("/api/crm/registry/summary"');
    expect(page).toContain("<PortfolioRegistrySummary");
    expect(page).toContain("Editable lead pipeline source:");
    expect(panel).toContain('data-testid="portfolio-crm-registry"');
    expect(panel).toContain('data-testid="portfolio-crm-outreach-blocked"');
    expect(panel).toContain("aggregate only · separate from the editable lead pipeline below");
    expect(panel).toContain("grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6");
    expect(panel).toContain("grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4");
    expect(panel).toContain("No permission basis");
    expect(panel).toContain("Registry freshness");
  });

  it("constrains dialogs and fixed feedback controls to a phone viewport", () => {
    const dialog = readSource("components", "ui", "dialog.tsx");
    const feedback = readSource("components", "feedback", "BetaFeedback.tsx");
    const identity = readSource("app", "dashboard", "identity", "page.tsx");

    expect(dialog).toContain("max-h-[calc(100dvh-2rem)]");
    expect(dialog).toContain("overflow-y-auto");
    expect(feedback).toContain("env(safe-area-inset-bottom)");
    expect(feedback).toContain('aria-label="Open beta feedback"');
    expect(identity.match(/grid-cols-1 gap-4 sm:grid-cols-2/g)).toHaveLength(2);
  });

  it("cancels stale customer timeline requests before applying responses", () => {
    const source = readSource("app", "dashboard", "crm", "page.tsx");

    expect(source).toContain("timelineAbortRef.current?.abort()");
    expect(source).toContain("signal: controller.signal");
    expect(source).toContain("timelineAbortRef.current !== controller");
    expect(source).toContain("selectedLeadIdRef.current === leadId");
  });

  it("runs the public responsive shell on a representative phone project", () => {
    const config = readSource("playwright.config.ts");

    expect(config).toContain('name: "mobile-chrome"');
    expect(config).toContain('devices["Pixel 7"]');
    expect(config).toContain("responsive-shell|authenticated-crm");
  });

  it("keeps the authenticated CRM audit isolated and aligned with rendered test ids", () => {
    const source = readSource("tests", "playwright", "authenticated-crm.spec.ts");

    expect(source).toContain('mobile ? "crm-mobile-list" : "crm-desktop-board"');
    expect(source).not.toContain('getByTestId("crm-mobile-board")');
    expect(source).toContain('page.route("**/api/agents/control-plane"');
    expect(source).toContain('page.route("**/api/telemetry/error"');
    expect(source).toContain('page.route("**/api/crm/**"');
    expect(source).toContain('page.route("**/api/crm/registry/summary"');
    expect(source).not.toContain("route.continue()");
  });
});
