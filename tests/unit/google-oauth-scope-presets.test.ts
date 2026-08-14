import { describe, expect, it } from "vitest";
import {
  assertGoogleTokenScopeForPreset,
  assessGoogleTokenScopeForPreset,
  getGoogleAuthUrl,
  googleAuthUrlOptionsForPreset,
  isGoogleTokenScopeBoundedForPreset,
  scopesForPreset,
} from "@/lib/google/oauth";

describe("Google OAuth scope presets", () => {
  it("requires PKCE and includes the exact bounded scope request in Google's URL", () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";
    process.env.GOOGLE_OAUTH_REDIRECT_URI =
      "https://leadflow-review.web.app/api/google/callback";
    process.env.MISSION_CONTROL_PUBLIC_ORIGIN =
      "https://leadflow-review.web.app";
    const challenge = "c".repeat(43);

    const authUrl = new URL(
      getGoogleAuthUrl("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
        scopePreset: "gmail_send",
        codeChallenge: challenge,
      })
    );

    expect(authUrl.origin).toBe("https://accounts.google.com");
    expect(authUrl.searchParams.get("code_challenge")).toBe(challenge);
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("include_granted_scopes")).toBe("false");
    expect(authUrl.searchParams.get("prompt")).toBe("consent select_account");
    expect(authUrl.searchParams.get("scope")?.split(" ").sort()).toEqual(
      scopesForPreset("gmail_send").sort()
    );
    expect(() =>
      getGoogleAuthUrl("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
        scopePreset: "gmail_send",
      } as never)
    ).toThrow("Invalid OAuth PKCE challenge");
    expect(() =>
      getGoogleAuthUrl("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
        scopePreset: "gmail_send",
        codeChallenge: "too-short",
      })
    ).toThrow("Invalid OAuth PKCE challenge");
  });

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
    ).toThrow(/missing required permissions|unsupported data access/);
    expect(
      isGoogleTokenScopeBoundedForPreset(
        "gmail_send",
        [
          "https://www.googleapis.com/auth/userinfo.email",
          "https://www.googleapis.com/auth/gmail.send",
        ].join(" ")
      )
    ).toBe(true);
    expect(
      isGoogleTokenScopeBoundedForPreset(
        "gmail_send",
        `${scopes.join(" ")} https://www.googleapis.com/auth/drive.readonly`
      )
    ).toBe(false);
    expect(
      isGoogleTokenScopeBoundedForPreset(
        "gmail_send",
        `${scopes.join(" ")} openid email`
      )
    ).toBe(true);
    expect(assessGoogleTokenScopeForPreset("gmail_send", `${scopes.join(" ")} openid email`))
      .toMatchObject({
        valid: true,
        identityAliasCount: 3,
        unsupportedCount: 0,
      });
    expect(
      isGoogleTokenScopeBoundedForPreset(
        "gmail_send",
        "openid email https://www.googleapis.com/auth/gmail.send"
      )
    ).toBe(true);
    expect(
      isGoogleTokenScopeBoundedForPreset(
        "gmail_send",
        `${scopes.join(" ")} profile`
      )
    ).toBe(true);
    expect(googleAuthUrlOptionsForPreset("gmail_send").prompt).toBe(
      "consent select_account"
    );
  });

  it("preserves the existing full Gmail preset", () => {
    const scopes = scopesForPreset("gmail");
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.send");
  });

  it.each([
    "core",
    "drive",
    "calendar",
    "gmail",
    "gmail_send",
    "full",
  ] as const)("requires and bounds every %s preset grant", (preset) => {
    const requested = scopesForPreset(preset);
    const withHarmlessAliases = [...requested, "openid", "email", "profile"].join(
      " "
    );
    expect(isGoogleTokenScopeBoundedForPreset(preset, withHarmlessAliases)).toBe(
      true
    );

    const firstDataScope = requested.find(
      (scope) => !scope.includes("/auth/userinfo.")
    );
    expect(firstDataScope).toBeTruthy();
    expect(
      isGoogleTokenScopeBoundedForPreset(
        preset,
        [...requested.filter((scope) => scope !== firstDataScope), "openid", "email"].join(
          " "
        )
      )
    ).toBe(false);
    expect(
      isGoogleTokenScopeBoundedForPreset(
        preset,
        `${withHarmlessAliases} https://www.googleapis.com/auth/contacts.readonly`
      )
    ).toBe(false);
  });
});
