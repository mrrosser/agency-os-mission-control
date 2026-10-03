import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WarmReconnectPreferences } from "@/components/crm/warm-reconnect-preferences";

const hookState = vi.hoisted(() => ({ values: null as unknown[] | null, index: 0 }));

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (initial: unknown) =>
      react.useState(hookState.values ? hookState.values[hookState.index++] : initial),
  };
});

describe("warm reconnect preferences UI", () => {
  beforeEach(() => {
    hookState.values = null;
    hookState.index = 0;
  });

  it("renders a privacy-first, brand-specific preference surface without remote media", () => {
    const html = renderToStaticMarkup(<WarmReconnectPreferences />);
    expect(html).toContain("Your inbox should still feel like yours.");
    expect(html).toContain("Opening your private preference link");
    expect(html).not.toMatch(/<img|src=["']https?:\/\//i);
    expect(html).not.toMatch(/mailto:|token=/i);
  });

  it("offers exactly two business choices with no default subscription", () => {
    hookState.values = [
      { available: true, canUpdatePreferences: true, globallyUnsubscribed: false },
      { rosser_gallery: false, rt_solutions: false },
      false,
      false,
      null,
    ];
    const html = renderToStaticMarkup(<WarmReconnectPreferences />);
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toContain("Rosser Gallery");
    expect(html).toContain("RT.Solutions");
    expect(html).toContain("newsletters, and community events");
    expect(html).not.toMatch(/checked=""|art and studio notes|personal updates/i);
    expect(html).toContain("Unsubscribe from promotional email");
  });

  it("keeps historical art choices out of the rendered selection surface", () => {
    hookState.values = [
      { available: true, canUpdatePreferences: true, globallyUnsubscribed: false },
      { marcus_rosser_art: true, rosser_gallery: true, rt_solutions: false },
      false,
      false,
      null,
    ];
    const html = renderToStaticMarkup(<WarmReconnectPreferences />);
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).not.toMatch(/marcus_rosser_art|art and studio notes|personal updates/i);
  });

  it("captures capabilities from the URL fragment, clears it, and omits credentials", () => {
    const source = readFileSync(
      join(process.cwd(), "components", "crm", "warm-reconnect-preferences.tsx"),
      "utf8"
    );
    expect(source).toContain("window.location.hash.slice(1)");
    expect(source).toContain("window.history.replaceState");
    expect(source).toContain('credentials: "omit"');
    expect(source).toContain('referrerPolicy: "no-referrer"');
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
  });
});
