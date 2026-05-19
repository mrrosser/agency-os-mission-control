import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLoginHostPolicy, getCanonicalLoginUrl } from "@/lib/auth/canonical-host";

describe("canonical host policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to the hosted Mission Control login URL", () => {
    expect(getCanonicalLoginUrl()).toBe("https://leadflow-review.web.app/login");
  });

  it("redirects unsupported browser hosts to the canonical login URL", () => {
    vi.stubEnv("NEXT_PUBLIC_CANONICAL_LOGIN_URL", "https://leadflow-review.web.app/login");
    vi.stubEnv("NEXT_PUBLIC_AUTO_REDIRECT_NON_CANONICAL_LOGIN", "true");

    expect(buildLoginHostPolicy("ai-hell-mary-mission-control-gdyt2qma6a-uc.a.run.app")).toEqual({
      action: "redirect",
      canonicalLoginUrl: "https://leadflow-review.web.app/login",
      hostWarning: true,
    });
  });

  it("allows localhost without host warnings", () => {
    expect(buildLoginHostPolicy("localhost")).toEqual({
      action: "allow",
      canonicalLoginUrl: "https://leadflow-review.web.app/login",
      hostWarning: false,
    });
  });
});
