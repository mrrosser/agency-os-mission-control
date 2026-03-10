import { describe, expect, it } from "vitest";
import {
  googleCapabilitiesFromScopeString,
  missingGoogleCapabilityMessage,
  parseGoogleScopeString,
} from "@/lib/google/oauth";

describe("google oauth capabilities", () => {
  it("parses a scope string into stable tokens", () => {
    expect(
      parseGoogleScopeString(
        " https://www.googleapis.com/auth/drive.readonly   https://www.googleapis.com/auth/gmail.send "
      )
    ).toEqual([
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ]);
  });

  it("derives drive, gmail, and calendar capabilities from granted scopes", () => {
    expect(
      googleCapabilitiesFromScopeString(
        [
          "https://www.googleapis.com/auth/drive.file",
          "https://www.googleapis.com/auth/calendar.events",
          "https://www.googleapis.com/auth/userinfo.email",
        ].join(" ")
      )
    ).toEqual({
      drive: true,
      gmail: false,
      calendar: true,
    });
  });

  it("returns actionable guidance when a capability is missing", () => {
    expect(missingGoogleCapabilityMessage("gmail")).toContain("enable Gmail");
    expect(missingGoogleCapabilityMessage("calendar")).toContain("enable Calendar");
  });
});
