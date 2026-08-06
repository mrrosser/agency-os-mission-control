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

  it("runs the public responsive shell on a representative phone project", () => {
    const config = readSource("playwright.config.ts");

    expect(config).toContain('name: "mobile-chrome"');
    expect(config).toContain('devices["Pixel 7"]');
    expect(config).toContain("responsive-shell\\.spec\\.ts");
  });
});
