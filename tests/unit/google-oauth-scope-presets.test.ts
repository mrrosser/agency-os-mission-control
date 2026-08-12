import { describe, expect, it } from "vitest";
import {
  assertGoogleTokenScopeForPreset,
  googleAuthUrlOptionsForPreset,
  isGoogleTokenScopeExactForPreset,
  scopesForPreset,
} from "@/lib/google/oauth";

describe("Google OAuth scope presets", () => {
  it("keeps the warm reconnect Gmail grant send-only", () => {
    const scopes = scopesForPreset("gmail_send");

    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.send");
    expect(scopes).toContain("https://www.googleapis.com/auth/userinfo.email");
    expect(scopes).not.toContain("https://www.googleapis.com/auth/userinfo.profile");
    expect(scopes).not.toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(scopes.some((scope) => scope.includes("/auth/drive"))).toBe(false);
    expect(scopes.some((scope) => scope.includes("/auth/calendar"))).toBe(false);
    expect(googleAuthUrlOptionsForPreset("gmail_send").include_granted_scopes).toBe(
      false
    );
    expect(() =>
      assertGoogleTokenScopeForPreset(
        "gmail_send",
        [
          "https://www.googleapis.com/auth/userinfo.email",
          "https://www.googleapis.com/auth/gmail.send",
        ].join(" ")
      )
    ).not.toThrow();
    expect(() =>
      assertGoogleTokenScopeForPreset(
        "gmail_send",
        "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly"
      )
    ).toThrow(/broader or incomplete grant/);
    expect(
      isGoogleTokenScopeExactForPreset(
        "gmail_send",
        [
          "https://www.googleapis.com/auth/userinfo.email",
          "https://www.googleapis.com/auth/gmail.send",
        ].join(" ")
      )
    ).toBe(true);
    expect(
      isGoogleTokenScopeExactForPreset(
        "gmail_send",
        `${scopes.join(" ")} https://www.googleapis.com/auth/drive.readonly`
      )
    ).toBe(false);
  });

  it("preserves the existing full Gmail preset", () => {
    const scopes = scopesForPreset("gmail");
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.send");
  });
});
