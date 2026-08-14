import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GoogleWorkspaceSettingsNotice } from "@/components/settings/GoogleWorkspaceSettingsNotice";

describe("GoogleWorkspaceSettingsNotice", () => {
  it("routes users to separate organization connection controls", () => {
    const markup = renderToStaticMarkup(<GoogleWorkspaceSettingsNotice />);

    expect(markup).toContain("RT.Solutions");
    expect(markup).toContain("Rosser Gallery");
    expect(markup).toContain('href="/dashboard/integrations"');
    expect(markup).toContain("Manage Google connections");
  });

  it("keeps context-free connect and disconnect requests out of Settings", () => {
    const source = readFileSync(
      join(process.cwd(), "app", "dashboard", "settings", "page.tsx"),
      "utf8"
    );

    expect(source).not.toContain('fetch("/api/google/connect"');
    expect(source).not.toContain('fetch("/api/google/disconnect"');
    expect(source).not.toContain("googleErrorDescription ||");
    expect(source).toContain("<GoogleWorkspaceSettingsNotice />");
  });

  it("handles and scrubs callbacks on every configured return page", () => {
    const crmSource = readFileSync(
      join(process.cwd(), "app", "dashboard", "crm", "page.tsx"),
      "utf8"
    );
    const integrationsSource = readFileSync(
      join(process.cwd(), "app", "dashboard", "integrations", "page.tsx"),
      "utf8"
    );

    expect(crmSource).toContain("<GoogleOAuthCallbackFeedback />");
    expect(integrationsSource).toContain("<GoogleOAuthCallbackFeedback />");
  });
});
