import { describe, expect, it } from "vitest";
import {
  buildGoogleOAuthCleanUrl,
  getGoogleOAuthCallbackFeedback,
  hasGoogleOAuthCallbackParams,
} from "@/components/integrations/google-oauth-callback-feedback";

const ALLOWED_ERROR_CODES = [
  "access_denied",
  "temporarily_unavailable",
  "provider_error",
  "connection_session_invalid",
  "connection_superseded",
  "token_exchange_failed",
  "scope_not_allowed",
  "account_identity_failed",
  "account_already_connected",
  "profile_replacement_requires_disconnect",
  "credential_storage_failed",
  "configuration_error",
] as const;

describe("Google OAuth callback feedback", () => {
  it.each(ALLOWED_ERROR_CODES)("maps %s to bounded actionable copy", (code) => {
    const params = new URLSearchParams({
      google: "error",
      googleError: code,
      googleBusiness: "rt_solutions",
      googleProfile: "rt_solutions_work",
      googleErrorDescription: "<script>provider-controlled text</script>",
    });

    const feedback = getGoogleOAuthCallbackFeedback(params);

    expect(feedback?.kind).toBe("error");
    expect(feedback?.title).toContain("RT.Solutions");
    expect(feedback?.description.length).toBeGreaterThan(30);
    expect(JSON.stringify(feedback)).not.toContain("provider-controlled");
    expect(JSON.stringify(feedback)).not.toContain("<script>");
  });

  it("uses generic trusted copy for an unknown error code", () => {
    const feedback = getGoogleOAuthCallbackFeedback(
      new URLSearchParams({
        google: "error",
        googleError: "attacker-controlled-message",
        googleErrorDescription: "render me",
      })
    );

    expect(feedback).toEqual({
      kind: "error",
      title: "Google connection was not completed",
      description:
        "The connection could not be completed. Start a fresh connection from the intended organization profile.",
      showHelpLink: true,
    });
  });

  it("does not treat inherited object keys as allowlisted codes", () => {
    const feedback = getGoogleOAuthCallbackFeedback(
      new URLSearchParams({ google: "error", googleError: "toString" })
    );

    expect(feedback?.description).toBe(
      "The connection could not be completed. Start a fresh connection from the intended organization profile."
    );
  });

  it("includes only a bounded support correlation value", () => {
    const accepted = getGoogleOAuthCallbackFeedback(
      new URLSearchParams({
        google: "error",
        googleError: "provider_error",
        googleCorrelation: "d7977cc4-3936-4b40-9b81-12ed81264eee",
      })
    );
    const rejected = getGoogleOAuthCallbackFeedback(
      new URLSearchParams({
        google: "error",
        googleError: "provider_error",
        googleCorrelation: "<script>alert(1)</script>",
      })
    );

    expect(accepted?.supportId).toBe("d7977cc4-3936-4b40-9b81-12ed81264eee");
    expect(rejected?.supportId).toBeUndefined();
  });

  it("labels success only when business and profile are an exact pair", () => {
    const rtSolutions = getGoogleOAuthCallbackFeedback(
      new URLSearchParams({
        google: "connected",
        googleBusiness: "rt_solutions",
        googleProfile: "rt_solutions_work",
      })
    );
    const rosserGallery = getGoogleOAuthCallbackFeedback(
      new URLSearchParams({
        google: "connected",
        googleBusiness: "rosser_nft_gallery",
        googleProfile: "rosser_gallery_work",
      })
    );
    const mismatched = getGoogleOAuthCallbackFeedback(
      new URLSearchParams({
        google: "connected",
        googleBusiness: "rt_solutions",
        googleProfile: "rosser_gallery_work",
      })
    );

    expect(rtSolutions?.title).toContain("RT.Solutions");
    expect(rtSolutions?.description).toContain("rt_solutions_work");
    expect(rosserGallery?.title).toContain("Rosser Gallery");
    expect(rosserGallery?.description).toContain("rosser_gallery_work");
    expect(mismatched?.title).toBe("Google connection completed");
    expect(mismatched?.description).not.toContain("RT.Solutions");
    expect(mismatched?.description).not.toContain("Rosser Gallery");
  });

  it("scrubs callback data while preserving unrelated navigation state", () => {
    const url = new URL(
      "https://leadflow-review.web.app/dashboard/integrations?tab=google&google=error&googleError=provider_error&googleErrorDescription=raw&googleBusiness=rt_solutions&googleProfile=rt_solutions_work&googleCorrelation=abc-123#connections"
    );

    expect(hasGoogleOAuthCallbackParams(url.searchParams)).toBe(true);
    expect(buildGoogleOAuthCleanUrl(url)).toBe(
      "/dashboard/integrations?tab=google#connections"
    );
  });

  it("ignores unrelated query parameters", () => {
    const params = new URLSearchParams({ tab: "google" });

    expect(hasGoogleOAuthCallbackParams(params)).toBe(false);
    expect(getGoogleOAuthCallbackFeedback(params)).toBeNull();
  });
});
