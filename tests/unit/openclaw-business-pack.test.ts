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

  it("defines orchestrator + sub-agents with deterministic handoff triggers", () => {
    const pack = readJson([
      "please-review",
      "from-root",
      "config-templates",
      "knowledge-pack.v2.json",
    ]);

    const globalPolicies = pack.globalPolicies as Record<string, unknown>;
    const topology = globalPolicies.agentTopology as Record<string, unknown>;
    expect(String(topology.masterAgentId)).toBe("orchestrator");
    expect(Boolean(topology.handoffEnabled)).toBe(true);

    const agents = topology.agents as Array<Record<string, unknown>>;
    const ids = agents.map((agent) => String(agent.id));
    expect(ids).toEqual(
      expect.arrayContaining([
        "orchestrator",
        "biz_aicf",
        "biz_rng",
        "biz_rts",
        "fn_marketing",
        "fn_research",
        "fn_actions",
      ])
    );

    const actionAgent = agents.find((agent) => String(agent.id) === "fn_actions");
    expect(Boolean(actionAgent?.canExecuteExternalWrites)).toBe(true);
    expect(actionAgent?.writeTools).toEqual(
      expect.arrayContaining(["gmail.createDraft", "calendar.createEvent", "crm.upsertLead"])
    );

    const handoffTriggers = topology.handoffTriggers as Array<Record<string, unknown>>;
    const handoffTargets = handoffTriggers.map((trigger) => String(trigger.handoffTo));
    expect(handoffTargets).toEqual(
      expect.arrayContaining(["biz_aicf", "biz_rng", "biz_rts", "fn_marketing", "fn_research", "fn_actions"])
    );
  });

  it("includes knowledge ingestion and voice action policies for call workflows", () => {
    const pack = readJson([
      "please-review",
      "from-root",
      "config-templates",
      "knowledge-pack.v2.json",
    ]);

    const globalPolicies = pack.globalPolicies as Record<string, unknown>;
    const ingestion = globalPolicies.knowledgeIngestionPolicy as Record<string, unknown>;
    expect(Boolean(ingestion.enabled)).toBe(true);
    expect(String(ingestion.scanMode)).toBe("metadata_delta_weekly");
    expect(String(ingestion.readMode)).toBe("metadata_plus_excerpt");

    const sources = ingestion.sources as Record<string, Record<string, unknown>>;
    const drive = sources.googleDrive as Record<string, unknown>;
    expect(Boolean(drive.enabled)).toBe(true);
    expect(Boolean(drive.allowSharedDrives)).toBe(true);

    const driveRoots = drive.rootsByAccount as Array<Record<string, unknown>>;
    const aicfRoots = driveRoots.find((entry) => String(entry.businessId) === "ai_cofoundry");
    const rngRoots = driveRoots.find((entry) => String(entry.businessId) === "rosser_nft_gallery");
    expect(aicfRoots?.roots).toEqual(expect.arrayContaining(["AICoFoundry_Doc_Pack_v1", "Meet Recordings"]));
    expect(rngRoots?.roots).toEqual(
      expect.arrayContaining(["NOTCF_Prepared_Documents_PACKET", "IG-Auto", "Meet Recordings"])
    );

    const voiceOps = globalPolicies.voiceOpsPolicy as Record<string, unknown>;
    expect(Boolean(voiceOps.enabled)).toBe(true);
    expect(String(voiceOps.entryAgentId)).toBe("orchestrator");
    expect(Boolean(voiceOps.requireBusinessContextBeforeWrite)).toBe(true);
    expect(Boolean(voiceOps.requireThreadLookupBeforeEmailDraft)).toBe(true);
    expect(voiceOps.allowActions).toEqual(
      expect.arrayContaining(["gmail.createDraft", "calendar.createEvent", "calendar.createMeet", "crm.upsertLead"])
    );

    const actionPolicies = voiceOps.actionPolicies as Record<string, Record<string, unknown>>;
    expect(Boolean(actionPolicies.gmail?.autoSend)).toBe(false);
    expect(Boolean(actionPolicies.calendar?.requireGoogleMeet)).toBe(true);
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

describe("openclaw config templates", () => {
  it("define sub-agent routing and voice runtime action guardrails", () => {
    const template = readJson([
      "please-review",
      "from-root",
      "config-templates",
      "openclaw.json.template",
    ]);

    const agents = template.agents as Record<string, unknown>;
    const list = agents.list as Array<Record<string, unknown>>;
    expect(list.map((entry) => String(entry.id))).toEqual(
      expect.arrayContaining([
        "orchestrator",
        "biz-aicf",
        "biz-rng",
        "biz-rts",
        "fn-marketing",
        "fn-research",
        "fn-actions",
      ])
    );

    const routing = agents.routing as Record<string, unknown>;
    expect(String(routing.default)).toBe("orchestrator");
    expect((routing.triggers as Array<Record<string, unknown>>).length).toBeGreaterThanOrEqual(6);

    const voiceRuntime = (
      ((template.plugins as Record<string, unknown>).entries as Record<string, unknown>)["voice-call"] as Record<
        string,
        unknown
      >
    ).config as Record<string, unknown>;
    const runtime = voiceRuntime.runtime as Record<string, unknown>;
    expect(String(runtime.conversationMode)).toBe("agentic");
    expect(String(runtime.entryAgentId)).toBe("orchestrator");

    const actionTools = runtime.actionTools as Record<string, unknown>;
    expect(String(actionTools.writeAgentId)).toBe("fn-actions");
    expect(Boolean(actionTools.emailDraftOnly)).toBe(true);
    expect(Boolean(actionTools.calendarRequireGoogleMeet)).toBe(true);
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
