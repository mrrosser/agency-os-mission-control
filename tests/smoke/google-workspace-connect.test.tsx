import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/providers/auth-provider", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

import { GoogleWorkspaceConnect } from "@/components/integrations/GoogleWorkspaceConnect";

describe("GoogleWorkspaceConnect", () => {
  it("renders independent organization connection controls", () => {
    const markup = renderToStaticMarkup(<GoogleWorkspaceConnect />);

    expect(markup).toContain("RT Solutions");
    expect(markup).toContain("rt_solutions_work");
    expect(markup).toContain("Rosser Gallery");
    expect(markup).toContain("rosser_gallery_work");
    expect(markup.match(/Connect Drive \+ Calendar/g)).toHaveLength(2);
    expect(markup).toContain("Connection does not send email or create calendar events");
  });
});
