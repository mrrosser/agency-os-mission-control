import { describe, expect, it } from "vitest";
import {
  assertGoogleProfileConnectionPolicy,
  capabilitiesFromGoogleScopes,
  getGoogleSendingProfile,
  getGoogleSendingProfileEmail,
  GOOGLE_BUSINESS_PROFILES,
  hasGoogleGmailSendScope,
  isGoogleSendingProfile,
  resolveGoogleBusinessProfileContext,
  RT_SOLUTIONS_SENDING_PROFILE,
  RT_SOLUTIONS_SENDING_EMAIL,
} from "@/lib/google/business-profiles";

describe("Google business profile contract", () => {
  it("keeps RT work as the business default and requires explicit RT sending selection", () => {
    expect(resolveGoogleBusinessProfileContext({ businessId: "rt_solutions" })?.profileId)
      .toBe("rt_solutions_work");
    expect(resolveGoogleBusinessProfileContext({
      businessId: "rt_solutions", profileId: "rt_solutions_send",
    })).toEqual(RT_SOLUTIONS_SENDING_PROFILE);
    expect(resolveGoogleBusinessProfileContext({ profileId: " RT_SOLUTIONS_SEND " }))
      .toEqual(RT_SOLUTIONS_SENDING_PROFILE);
    expect(getGoogleSendingProfile("rt_solutions_send")).toMatchObject({
      ...RT_SOLUTIONS_SENDING_PROFILE, accountEmail: RT_SOLUTIONS_SENDING_EMAIL,
    });
    expect(getGoogleSendingProfileEmail("rt_solutions_send")).toBe("mrosser@rt.solutions");
    expect(getGoogleSendingProfileEmail("rosser_gallery_send")).toBe("mrosser@rossergallery.com");
    expect(getGoogleSendingProfileEmail("rt_solutions_work")).toBeNull();
    expect(isGoogleSendingProfile("rt_solutions_send")).toBe(true);
    expect(isGoogleSendingProfile("rt_solutions_work")).toBe(false);
    expect(() => resolveGoogleBusinessProfileContext({
      businessId: "rosser_nft_gallery", profileId: "rt_solutions_send",
    })).toThrow("Unknown or mismatched");
  });

  it.each(["core", "drive", "calendar", "gmail", "full"])(
    "rejects the %s preset for the dedicated RT sender", (scopePreset) => {
      expect(() => assertGoogleProfileConnectionPolicy({
        profileId: "rt_solutions_send", scopePreset,
      })).toThrow("dedicated gmail_send");
    }
  );

  it("pins RT sending to its exact Google account without changing work-account policy", () => {
    expect(() => assertGoogleProfileConnectionPolicy({
      profileId: "rt_solutions_send", scopePreset: "gmail_send", accountEmail: " MROSSER@RT.SOLUTIONS ",
    })).not.toThrow();
    for (const accountEmail of ["mrosser@rossergallery.com", "mcool4444@gmail.com", "other@rt.solutions", ""]) {
      expect(() => assertGoogleProfileConnectionPolicy({
        profileId: "rt_solutions_send", scopePreset: "gmail_send", accountEmail,
      })).toThrow("mrosser@rt.solutions");
    }
    expect(() => assertGoogleProfileConnectionPolicy({
      profileId: "rt_solutions_work", scopePreset: "full", accountEmail: "existing@rt.solutions",
    })).not.toThrow();
  });

  it("requires explicit selection of the separate Gallery sending profile", () => {
    expect(resolveGoogleBusinessProfileContext({ businessId: "rosser_nft_gallery" })?.profileId)
      .toBe("rosser_gallery_work");
    expect(resolveGoogleBusinessProfileContext({
      businessId: "rosser_nft_gallery", profileId: "rosser_gallery_send",
    })?.profileId).toBe("rosser_gallery_send");
    expect(GOOGLE_BUSINESS_PROFILES.map((profile) => profile.profileId))
      .toEqual(["rt_solutions_work", "rosser_gallery_work"]);
    expect(() => resolveGoogleBusinessProfileContext({
      businessId: "rt_solutions", profileId: "rosser_gallery_send",
    })).toThrow("Unknown or mismatched");
  });
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
