import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

function readJson(pathParts: string[]) {
  const fullPath = join(process.cwd(), ...pathParts);
  const raw = readFileSync(fullPath, "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("openclaw business pack v2", () => {
  it("contains all three businesses and strict approval defaults", () => {
    const pack = readJson([
      "please-review",
      "from-root",
      "config-templates",
      "knowledge-pack.v2.json",
    ]);

    const globalPolicies = pack.globalPolicies as Record<string, unknown>;
    const approvalMatrix = globalPolicies.approvalMatrix as Record<string, unknown>;
    expect(approvalMatrix.sendEmail).toBe("manual");
    expect(approvalMatrix.createCalendarEvent).toBe("auto_strict");

    const businesses = pack.businesses as Array<Record<string, unknown>>;
    const ids = businesses.map((b) => String(b.id));
    expect(ids).toContain("ai_cofoundry");
    expect(ids).toContain("rt_solutions");
    expect(ids).toContain("rosser_nft_gallery");
    expect(ids.length).toBe(3);
  });

  it("uses suppression-aware triage and strict calendar policy", () => {
    const pack = readJson([
      "please-review",
      "from-root",
      "config-templates",
      "knowledge-pack.v2.json",
    ]);

    const triage = (pack.globalPolicies as Record<string, unknown>).triage as Record<string, unknown>;
    const searchDefaults = triage.searchDefaults as Record<string, unknown>;
    const query = String(searchDefaults.query);
    expect(query).toContain("-category:promotions");
    expect(query).toContain("-category:social");
    expect(query).toContain("-category:updates");

    const calendarPolicy = (pack.globalPolicies as Record<string, unknown>).calendarPolicy as Record<
      string,
      unknown
    >;
    expect(calendarPolicy.autoBookMode).toBe("strict");
    expect(calendarPolicy.enabled).toBe(true);
    expect(calendarPolicy.enforceBusinessBookingLink).toBe(true);

    const calendarProfiles = calendarPolicy.calendarProfiles as Array<Record<string, unknown>>;
    expect(calendarProfiles.length).toBe(3);
    const profileIds = calendarProfiles.map((p) => String(p.id));
    expect(profileIds).toContain("rts_discovery_primary");
    expect(profileIds).toContain("rng_events_primary");
    expect(profileIds).toContain("aicf_discovery_primary");

    const businessCalendarProfileMap = calendarPolicy.businessCalendarProfileMap as Record<string, unknown>;
    expect(String(businessCalendarProfileMap.rt_solutions)).toBe("rts_discovery_primary");
    expect(String(businessCalendarProfileMap.rosser_nft_gallery)).toBe("rng_events_primary");
    expect(String(businessCalendarProfileMap.ai_cofoundry)).toBe("aicf_discovery_primary");

    const rngProfile = calendarProfiles.find((p) => String(p.id) === "rng_events_primary");
    const aicfProfile = calendarProfiles.find((p) => String(p.id) === "aicf_discovery_primary");
    expect(String(rngProfile?.bookingLink)).toBe("https://calendar.app.google/d6WVsrcihD63TZZj8");
    expect(String(aicfProfile?.bookingLink)).toBe("https://calendar.app.google/LEk5GQobBpAXTfpR9");
    expect(Boolean(rngProfile?.attachGoogleMeet)).toBe(true);
    expect(Boolean(aicfProfile?.attachGoogleMeet)).toBe(true);
  });
});

describe("email triage policy v2", () => {
  it("defines suppression rules, thresholds, and strict auto-book signals", () => {
    const policy = readJson([
      "please-review",
      "from-root",
      "config-templates",
      "email-triage.policy.v2.json",
    ]);

    const mode = policy.mode as Record<string, unknown>;
    expect(mode.draftOnly).toBe(true);
    expect(mode.sendWithoutApproval).toBe(false);

    const triage = policy.triage as Record<string, unknown>;
    const suppression = triage.suppression as Record<string, unknown>;
    const skipIfFromContains = suppression.skipIfFromContains as string[];
    expect(skipIfFromContains).toContain("no-reply");
    expect(skipIfFromContains).toContain("mailer-daemon");

    const intents = triage.intents as Record<string, unknown>;
    const meetingMin = Number(intents.meetingRequestMinConfidence);
    expect(meetingMin).toBeGreaterThanOrEqual(0.8);

    const calendar = policy.calendar as Record<string, unknown>;
    expect(calendar.autoBookMode).toBe("strict");
    expect(calendar.enforceBusinessBookingLink).toBe(true);
    expect(calendar.requireGoogleMeet).toBe(true);
    const requiredSignals = calendar.requiredSignals as string[];
    expect(requiredSignals).toContain("explicit_timezone");
    expect(requiredSignals).toContain("single_confirmed_slot");

    const bookingProfiles = calendar.bookingProfiles as Array<Record<string, unknown>>;
    expect(bookingProfiles.length).toBe(3);
    const rngProfile = bookingProfiles.find((p) => String(p.id) === "rng_events_primary");
    const aicfProfile = bookingProfiles.find((p) => String(p.id) === "aicf_discovery_primary");
    expect(String(rngProfile?.verificationState)).toBe("verified");
    expect(String(rngProfile?.bookingLink)).toBe("https://calendar.app.google/d6WVsrcihD63TZZj8");
    expect(String(aicfProfile?.bookingLink)).toBe("https://calendar.app.google/LEk5GQobBpAXTfpR9");
    expect(Boolean(rngProfile?.attachMeetLink)).toBe(true);
    expect(Boolean(aicfProfile?.attachMeetLink)).toBe(true);
  });
});

describe("business reply templates", () => {
  it("defines separate template banks for all three businesses", () => {
    const templates = readJson([
      "please-review",
      "from-root",
      "config-templates",
      "email-reply-templates.v1.json",
    ]);

    const businessTemplates = templates.businessTemplates as Record<string, unknown>;
    expect(Object.keys(businessTemplates).sort()).toEqual([
      "ai_cofoundry",
      "rosser_nft_gallery",
      "rt_solutions",
    ]);

    const aiCofoundry = businessTemplates.ai_cofoundry as Record<string, unknown>;
    const rtSolutions = businessTemplates.rt_solutions as Record<string, unknown>;
    const rosserNftGallery = businessTemplates.rosser_nft_gallery as Record<string, unknown>;
    expect(typeof aiCofoundry.signature).toBe("string");
    expect(typeof rtSolutions.signature).toBe("string");
    expect(typeof rosserNftGallery.signature).toBe("string");
  });

  it("includes voice-pack settings and business-specific calendar profile mapping", () => {
    const templates = readJson([
      "please-review",
      "from-root",
      "config-templates",
      "email-reply-templates.v1.json",
    ]);

    const voicePack = templates.voicePack as Record<string, unknown>;
    expect(String(voicePack.id)).toBe("voice-pack.marcus.openclaw.v1");
    const doNotSay = voicePack.doNotSay as string[];
    expect(doNotSay).toContain("As an AI");
    expect(doNotSay).toContain("Guaranteed results");

    const businessTemplates = templates.businessTemplates as Record<string, Record<string, unknown>>;
    expect(String(businessTemplates.rt_solutions.calendarProfileId)).toBe("rts_discovery_primary");
    expect(String(businessTemplates.rosser_nft_gallery.calendarProfileId)).toBe("rng_events_primary");
    expect(String(businessTemplates.ai_cofoundry.calendarProfileId)).toBe("aicf_discovery_primary");
    expect(String(businessTemplates.rosser_nft_gallery.bookingLink)).toBe(
      "https://calendar.app.google/d6WVsrcihD63TZZj8"
    );
    expect(String(businessTemplates.ai_cofoundry.bookingLink)).toBe(
      "https://calendar.app.google/LEk5GQobBpAXTfpR9"
    );
    expect(Boolean(businessTemplates.rosser_nft_gallery.alwaysAddVideo)).toBe(true);
    expect(Boolean(businessTemplates.ai_cofoundry.alwaysAddVideo)).toBe(true);
  });
});

describe("email triage runtime v3 quality", () => {
  it("keeps thread-aware drafting enabled with enough message context", () => {
    const runtime = readJson([
      "please-review",
      "from-root",
      "config-templates",
      "email-triage.runtime.v3.json",
    ]);

    const aiDrafting = runtime.aiDrafting as Record<string, unknown>;
    expect(aiDrafting.enabled).toBe(true);
    expect(Number(aiDrafting.maxMessagesFromThread)).toBeGreaterThanOrEqual(10);
    expect(Number(aiDrafting.maxContextChars)).toBeGreaterThanOrEqual(10000);
    expect(String(aiDrafting.promptDefault).toLowerCase()).toContain("thread context");
  });

  it("uses human-readable fallback template bodies (real newlines, no literal slash-n)", () => {
    const runtime = readJson([
      "please-review",
      "from-root",
      "config-templates",
      "email-triage.runtime.v3.json",
    ]);

    const draftTemplates = runtime.draftTemplates as Record<string, Record<string, unknown>>;
    Object.values(draftTemplates).forEach((template) => {
      const body = String(template.body ?? "");
      expect(body.includes("\\n")).toBe(false);
      expect(body.split("\n").length).toBeGreaterThan(3);
      expect(body.toLowerCase()).toContain("google meet included");
    });
  });
});
