import { describe, expect, it } from "vitest";
import { buildAuthErrorDetails } from "@/lib/auth/auth-error-messages";

describe("buildAuthErrorDetails", () => {
  it("maps unauthorized domain errors to canonical login guidance", () => {
    const details = buildAuthErrorDetails(
      { code: "auth/unauthorized-domain", message: "Firebase: Error (auth/unauthorized-domain)." },
      { canonicalLoginUrl: "https://leadflow-review.web.app/login" }
    );

    expect(details.code).toBe("auth/unauthorized-domain");
    expect(details.helpHref).toBe("https://leadflow-review.web.app/login");
    expect(details.message).toContain("Google sign-in is blocked");
  });

  it("falls back to source error message for unknown auth codes", () => {
    const details = buildAuthErrorDetails({
      code: "auth/internal-error",
      message: "Firebase: Error (auth/internal-error).",
    });

    expect(details.code).toBe("auth/internal-error");
    expect(details.message).toBe("Firebase: Error (auth/internal-error).");
  });

  it("uses default message when there is no structured error", () => {
    const details = buildAuthErrorDetails("plain-string-error");
    expect(details.message).toBe("Failed to sign in. Please try again.");
  });
});
