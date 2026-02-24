import "server-only";

export type VoiceActionName = "calendar.createMeet" | "gmail.createDraft" | "crm.upsertLead";

export interface VoiceBusinessProfile {
  id: string;
  name: string;
  serviceCatalog: string[];
  bookingLink: string | null;
  primaryEmail: string | null;
  timeZone: string | null;
}

export interface VoiceWebhookPolicy {
  enabled: boolean;
  requireBusinessContextBeforeWrite: boolean;
  allowActions: VoiceActionName[];
  actionModes: Record<VoiceActionName, string>;
  callerRouting: Array<{
    phoneNumber: string;
    defaultBusinessId: string;
  }>;
}

export interface VoiceKnowledgeContext {
  policy: VoiceWebhookPolicy;
  businesses: VoiceBusinessProfile[];
}

export interface PlannedVoiceAction {
  action: VoiceActionName;
  mode: string;
}

export interface PlannedVoiceTurn {
  responseText: string;
  queuedAction: PlannedVoiceAction | null;
  businessId: string | null;
}

const DEFAULT_POLICY: VoiceWebhookPolicy = {
  enabled: false,
  requireBusinessContextBeforeWrite: true,
  allowActions: ["gmail.createDraft", "calendar.createMeet", "crm.upsertLead"],
  actionModes: {
    "gmail.createDraft": "draft_first",
    "calendar.createMeet": "strict_auto_book",
    "crm.upsertLead": "upsert_only",
  },
  callerRouting: [],
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isExplicitTrue(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
}

function normalizePhone(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return `+${digits.slice(1).replace(/[^\d]/g, "")}`;
  return digits.replace(/[^\d]/g, "");
}

export function extractVoiceKnowledgeContext(payload: unknown): VoiceKnowledgeContext {
  const root = asObject(payload) || {};
  const policyRoot = asObject(asObject(root.globalPolicies)?.voiceOpsPolicy) || {};

  const allowActions = (Array.isArray(policyRoot.allowActions) ? policyRoot.allowActions : [])
    .map((value) => asString(value).trim())
    .filter(
      (value): value is VoiceActionName =>
        value === "gmail.createDraft" || value === "calendar.createMeet" || value === "crm.upsertLead"
    );

  const actionPolicies = asObject(policyRoot.actionPolicies) || {};
  const gmailPolicy = asObject(actionPolicies.gmail) || {};
  const calendarPolicy = asObject(actionPolicies.calendar) || {};
  const crmPolicy = asObject(actionPolicies.crm) || {};

  const policy: VoiceWebhookPolicy = {
    enabled: isExplicitTrue(policyRoot.enabled),
    requireBusinessContextBeforeWrite: policyRoot.requireBusinessContextBeforeWrite !== false,
    allowActions: allowActions.length > 0 ? allowActions : DEFAULT_POLICY.allowActions,
    actionModes: {
      "gmail.createDraft": asString(gmailPolicy.mode) || DEFAULT_POLICY.actionModes["gmail.createDraft"],
      "calendar.createMeet":
        asString(calendarPolicy.mode) || DEFAULT_POLICY.actionModes["calendar.createMeet"],
      "crm.upsertLead": asString(crmPolicy.mode) || DEFAULT_POLICY.actionModes["crm.upsertLead"],
    },
    callerRouting: (Array.isArray(policyRoot.callerRouting) ? policyRoot.callerRouting : [])
      .map((value) => {
        const row = asObject(value) || {};
        return {
          phoneNumber: normalizePhone(asString(row.phoneNumber)),
          defaultBusinessId: asString(row.defaultBusinessId).trim(),
        };
      })
      .filter((row) => row.phoneNumber && row.defaultBusinessId),
  };

  const businesses = (Array.isArray(root.businesses) ? root.businesses : [])
    .map((value) => {
      const row = asObject(value) || {};
      const calendarDefaults = asObject(row.calendarDefaults) || {};
      return {
        id: asString(row.id).trim(),
        name: asString(row.name).trim(),
        serviceCatalog: (Array.isArray(row.serviceCatalog) ? row.serviceCatalog : [])
          .map((service) => asString(service).trim())
          .filter(Boolean)
          .slice(0, 5),
        bookingLink: asString(calendarDefaults.bookingLink).trim() || null,
        primaryEmail: asString(asObject(row.contacts)?.primaryEmail).trim() || null,
        timeZone:
          asString(calendarDefaults.timeZone).trim() ||
          asString(calendarDefaults.timezone).trim() ||
          null,
      } satisfies VoiceBusinessProfile;
    })
    .filter((business) => business.id && business.name);

  return { policy, businesses };
}

export function resolveBusinessIdForCall(
  context: VoiceKnowledgeContext,
  toPhone: string,
  fromPhone: string
): string | null {
  const normalizedTo = normalizePhone(toPhone);
  const normalizedFrom = normalizePhone(fromPhone);

  for (const route of context.policy.callerRouting) {
    if (route.phoneNumber === normalizedTo || route.phoneNumber === normalizedFrom) {
      return route.defaultBusinessId;
    }
  }
  return null;
}

export function detectVoiceAction(transcript: string): VoiceActionName | null {
  const lower = transcript.toLowerCase();
  if (/\b(book|schedule|meeting|calendar|appointment)\b/.test(lower)) {
    return "calendar.createMeet";
  }
  if (/\b(email|draft|follow[\s-]?up|send a message|reply)\b/.test(lower)) {
    return "gmail.createDraft";
  }
  if (/\b(crm|lead|contact record|pipeline)\b/.test(lower)) {
    return "crm.upsertLead";
  }
  return null;
}

function businessById(context: VoiceKnowledgeContext, businessId: string | null): VoiceBusinessProfile | null {
  if (!businessId) return null;
  return context.businesses.find((business) => business.id === businessId) || null;
}

function trimForVoice(value: string, maxChars: number = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3)}...`;
}

function fallbackBusinessPrompt(context: VoiceKnowledgeContext): string {
  if (context.businesses.length === 0) {
    return "Please tell me which business this is for: AI CoFoundry, Rosser NFT Gallery, or RT Solutions.";
  }
  const names = context.businesses.map((business) => business.name).join(", ");
  return `Please tell me which business this is for: ${names}.`;
}

function generalKnowledgeResponse(context: VoiceKnowledgeContext, businessId: string | null): string {
  const business = businessById(context, businessId);
  if (business) {
    const services =
      business.serviceCatalog.length > 0
        ? `We can help with ${business.serviceCatalog.slice(0, 3).join(", ")}.`
        : "We can help with consulting, automation, and delivery support.";
    const booking = business.bookingLink ? ` You can also book here: ${business.bookingLink}.` : "";
    return trimForVoice(`${business.name} here. ${services}${booking}`);
  }

  return trimForVoice(
    "I can help with scheduling, drafting follow up emails, and answering business questions. Say schedule a meeting, draft an email, or ask a question."
  );
}

export function planVoiceTurn(args: {
  context: VoiceKnowledgeContext;
  transcript: string;
  inferredBusinessId: string | null;
}): PlannedVoiceTurn {
  const transcript = args.transcript.trim();
  const businessId = args.inferredBusinessId;

  if (!transcript) {
    return {
      responseText: generalKnowledgeResponse(args.context, businessId),
      queuedAction: null,
      businessId,
    };
  }

  const action = detectVoiceAction(transcript);
  if (!action) {
    return {
      responseText: generalKnowledgeResponse(args.context, businessId),
      queuedAction: null,
      businessId,
    };
  }

  if (!args.context.policy.enabled) {
    return {
      responseText:
        "Voice actions are currently disabled. I can capture your request for manual follow-up.",
      queuedAction: null,
      businessId,
    };
  }

  if (!args.context.policy.allowActions.includes(action)) {
    return {
      responseText: "That action is not enabled right now. I can still answer questions and route follow up.",
      queuedAction: null,
      businessId,
    };
  }

  if (!businessId && args.context.policy.requireBusinessContextBeforeWrite) {
    return {
      responseText: fallbackBusinessPrompt(args.context),
      queuedAction: null,
      businessId: null,
    };
  }

  const actionLabel =
    action === "calendar.createMeet"
      ? "meeting request"
      : action === "gmail.createDraft"
        ? "email draft"
        : "CRM lead update";

  const business = businessById(args.context, businessId);
  const owner = business?.name || "the team";
  const mode = args.context.policy.actionModes[action] || "queued";

  return {
    responseText: trimForVoice(
      `Got it. I queued a ${actionLabel} for ${owner} in ${mode} mode. A team member will review and execute the next step.`
    ),
    queuedAction: {
      action,
      mode,
    },
    businessId,
  };
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
