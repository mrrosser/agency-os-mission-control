import { describe, expect, it } from "vitest";
import {
  detectVoiceAction,
  extractVoiceKnowledgeContext,
  planVoiceTurn,
  resolveBusinessIdForCall,
} from "@/lib/voice/inbound-webhook";

const knowledgePayload = {
  globalPolicies: {
    voiceOpsPolicy: {
      enabled: true,
      requireBusinessContextBeforeWrite: true,
      allowActions: ["gmail.createDraft", "calendar.createMeet", "crm.upsertLead"],
      actionPolicies: {
        gmail: { mode: "draft_first" },
        calendar: { mode: "strict_auto_book" },
        crm: { mode: "upsert_only" },
      },
      callerRouting: [
        {
          phoneNumber: "+18443169534",
          defaultBusinessId: "rosser_nft_gallery",
        },
      ],
    },
  },
  businesses: [
    {
      id: "rosser_nft_gallery",
      name: "Rosser NFT Gallery",
      serviceCatalog: ["Exhibitions", "Commissions"],
      calendarDefaults: {
        bookingLink: "https://calendar.app.google/afjkNdXsLSWYibfUA",
      },
    },
  ],
};

describe("inbound voice webhook helpers", () => {
  it("detects action intents from transcript", () => {
    expect(detectVoiceAction("Can we book a meeting tomorrow?")).toBe("calendar.createMeet");
    expect(detectVoiceAction("Please draft an email follow up")).toBe("gmail.createDraft");
    expect(detectVoiceAction("Update the CRM lead record")).toBe("crm.upsertLead");
    expect(detectVoiceAction("What services do you offer?")).toBeNull();
  });

  it("maps caller routing and queues allowed write actions", () => {
    const context = extractVoiceKnowledgeContext(knowledgePayload);
    const businessId = resolveBusinessIdForCall(context, "+18443169534", "+17572147313");
    expect(businessId).toBe("rosser_nft_gallery");

    const planned = planVoiceTurn({
      context,
      transcript: "Book me a meeting next week",
      inferredBusinessId: businessId,
    });

    expect(planned.businessId).toBe("rosser_nft_gallery");
    expect(planned.queuedAction?.action).toBe("calendar.createMeet");
    expect(planned.queuedAction?.mode).toBe("strict_auto_book");
    expect(planned.responseText).toContain("queued");
  });

  it("routes a legacy AICF inbound number into RT.Solutions without loading its old profile", () => {
    const context = extractVoiceKnowledgeContext({
      globalPolicies: {
        voiceOpsPolicy: {
          enabled: true,
          requireBusinessContextBeforeWrite: true,
          allowActions: ["gmail.createDraft"],
          callerRouting: [
            { phoneNumber: "+15045550100", defaultBusinessId: "ai_cofoundry" },
          ],
        },
      },
      businesses: [
        {
          id: "ai_cofoundry",
          name: "Historical AI Co-Foundry",
          serviceCatalog: ["Legacy service"],
        },
        {
          id: "rt_solutions",
          name: "RT.Solutions",
          serviceCatalog: ["Automation delivery"],
        },
      ],
    });

    const businessId = resolveBusinessIdForCall(context, "+15045550100", "+15045550999");
    const planned = planVoiceTurn({
      context,
      transcript: "Draft an email follow up",
      inferredBusinessId: businessId,
    });

    expect(context.businesses.map((business) => business.id)).toEqual(["rt_solutions"]);
    expect(businessId).toBe("rt_solutions");
    expect(planned.businessId).toBe("rt_solutions");
    expect(planned.queuedAction?.action).toBe("gmail.createDraft");
    expect(planned.responseText).toContain("RT.Solutions");
  });

  it("fails closed for unknown inbound business routes", () => {
    const context = extractVoiceKnowledgeContext({
      globalPolicies: {
        voiceOpsPolicy: {
          callerRouting: [
            { phoneNumber: "+15045550101", defaultBusinessId: "unknown-business" },
          ],
        },
      },
    });

    expect(resolveBusinessIdForCall(context, "+15045550101", "+15045550999")).toBeNull();
  });

  it("asks for business context before write actions when missing", () => {
    const context = extractVoiceKnowledgeContext(knowledgePayload);
    const planned = planVoiceTurn({
      context,
      transcript: "Please send an email to the client",
      inferredBusinessId: null,
    });

    expect(planned.queuedAction).toBeNull();
    expect(planned.responseText).toMatch(/which business/i);
  });

  it("defaults voice write actions to disabled unless explicitly enabled", () => {
    const context = extractVoiceKnowledgeContext({
      globalPolicies: {
        voiceOpsPolicy: {
          allowActions: ["gmail.createDraft", "calendar.createMeet", "crm.upsertLead"],
        },
      },
      businesses: knowledgePayload.businesses,
    });

    const planned = planVoiceTurn({
      context,
      transcript: "Schedule a meeting with client@example.com tomorrow at 2pm",
      inferredBusinessId: "rosser_nft_gallery",
    });

    expect(context.policy.enabled).toBe(false);
    expect(planned.queuedAction).toBeNull();
    expect(planned.responseText).toMatch(/disabled/i);
  });
});
