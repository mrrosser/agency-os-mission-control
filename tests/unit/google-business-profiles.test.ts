import { describe, expect, it } from "vitest";
import {
  capabilitiesFromGoogleScopes,
  hasGoogleGmailSendScope,
  resolveGoogleBusinessProfileContext,
} from "@/lib/google/business-profiles";

describe("Google business profile contract", () => {
  it("distinguishes Gmail send authority from read-only Gmail access", () => {
    expect(
      hasGoogleGmailSendScope(
        "openid https://www.googleapis.com/auth/gmail.readonly"
      )
    ).toBe(false);
    expect(
      hasGoogleGmailSendScope(
        "openid https://www.googleapis.com/auth/gmail.send"
      )
    ).toBe(true);
  });

  it("maps canonical businesses to the worker profile ids", () => {
    expect(
      resolveGoogleBusinessProfileContext({ businessId: "rt_solutions" })
    ).toMatchObject({
      businessId: "rt_solutions",
      profileId: "rt_solutions_work",
        label: "RT.Solutions",
    });
    expect(
      resolveGoogleBusinessProfileContext({ profileId: "rosser_gallery_work" })
    ).toMatchObject({
      businessId: "rosser_nft_gallery",
      profileId: "rosser_gallery_work",
      label: "Rosser Gallery",
    });
  });

  it("fails closed for unknown or mismatched context", () => {
    expect(() =>
      resolveGoogleBusinessProfileContext({ businessId: "rosser_gallery" })
    ).toThrow("Unknown or mismatched Google business profile");
    expect(() =>
      resolveGoogleBusinessProfileContext({
        businessId: "rt_solutions",
        profileId: "rosser_gallery_work",
      })
    ).toThrow("Unknown or mismatched Google business profile");
  });

  it("keeps the no-context legacy path and derives capabilities from scopes", () => {
    expect(resolveGoogleBusinessProfileContext({})).toBeNull();
    expect(
      capabilitiesFromGoogleScopes(
        "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.readonly"
      )
    ).toEqual({ drive: true, gmail: false, calendar: true });
  });
});
