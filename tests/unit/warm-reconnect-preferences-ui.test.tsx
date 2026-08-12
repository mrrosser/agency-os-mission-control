import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WarmReconnectPreferences } from "@/components/crm/warm-reconnect-preferences";

describe("warm reconnect preferences UI", () => {
  it("renders a privacy-first, brand-specific preference surface without remote media", () => {
    const html = renderToStaticMarkup(<WarmReconnectPreferences />);
    expect(html).toContain("Your inbox should still feel like yours.");
    expect(html).toContain("Opening your private preference link");
    expect(html).not.toMatch(/<img|src=["']https?:\/\//i);
    expect(html).not.toMatch(/mailto:|token=/i);
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
