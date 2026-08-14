import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () =>
    new URLSearchParams({
      google: "error",
      googleError: "scope_not_allowed",
      googleErrorDescription: "DO NOT RENDER PROVIDER TEXT",
      googleBusiness: "rosser_nft_gallery",
      googleProfile: "rosser_gallery_work",
    }),
}));

import { GoogleOAuthCallbackFeedback } from "@/components/integrations/GoogleOAuthCallbackFeedback";

describe("GoogleOAuthCallbackFeedback UI", () => {
  it("renders trusted organization-specific guidance without provider text", () => {
    const markup = renderToStaticMarkup(<GoogleOAuthCallbackFeedback />);

    expect(markup).toContain("Rosser Gallery Google connection was not completed");
    expect(markup).toContain("permissions outside this profile&#x27;s approved connection");
    expect(markup).toContain('href="/help/google-oauth"');
    expect(markup).not.toContain("DO NOT RENDER PROVIDER TEXT");
    expect(markup).not.toContain("scope_not_allowed");
  });
});
