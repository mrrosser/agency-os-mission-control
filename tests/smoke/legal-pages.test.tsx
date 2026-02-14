import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";

describe("legal pages", () => {
  it("renders privacy policy content", () => {
    const markup = renderToStaticMarkup(<PrivacyPage />);
    expect(markup).toContain("Privacy Policy");
    expect(markup).toContain("Google User Data");
  });

  it("renders terms of service content", () => {
    const markup = renderToStaticMarkup(<TermsPage />);
    expect(markup).toContain("Terms of Service");
    expect(markup).toContain("Third-Party Integrations");
  });
});
