import "server-only";

import {
  formatCrmPipelineStageLabel,
  normalizeBusinessUnit,
  normalizeCrmPipelineStage,
  normalizeOfferCode,
  type BusinessUnitId,
  type CrmPipelineStage,
} from "@/lib/revenue/offers";

export type FollowupBranch = "standard" | "no_response" | "not_now";

export interface FollowupMessagePlan {
  subject: string;
  html: string;
  nextStep: string;
}

const OFFER_CTA_BY_CODE: Record<string, string> = {
  "RNG-MINI-REPLICA": "Reserve your selected piece directly from catalog.",
  "RNG-COMMISSION-SCULPTURE": "Reply with size, finish, budget, and deadline to issue a deposit invoice.",
  "RNG-HISTORICAL-PRESERVATION": "Book a preservation consult to confirm handling and timeline.",
  "RNG-PRIVATE-EVENT-RENTAL": "Submit date, guest count, and event type for a date-hold invoice.",
  "RTS-QUICK-WEBSITE-SPRINT": "Book sprint intake and pay deposit to lock your launch window.",
  "RTS-AI-LUNCH-LEARN": "Share audience + outcomes and reserve your date with a deposit.",
  "RTS-AI-TEAM-TRAINING": "Send team profile + goals to receive a tailored training plan.",
  "RTS-CUSTOM-BUILD-DISCOVERY": "Book paid discovery to produce a scoped implementation plan.",
  "AICF-DISCOVERY": "Book a paid discovery call to map your implementation plan.",
};

const DEFAULT_CTA_BY_BUSINESS: Record<BusinessUnitId, string> = {
  ai_cofoundry: "Book discovery and confirm your target delivery window.",
  rosser_nft_gallery: "Confirm your preferred piece or project details and reserve your slot.",
  rt_solutions: "Book your intake call and secure your project start date.",
};

const STAGE_NEXT_STEP_SCRIPT: Record<CrmPipelineStage, string> = {
  lead_capture: "Confirm fit criteria and set a 15-minute qualification call.",
  qualification: "Lock a booking slot and confirm required intake information.",
  outreach: "Send the 1-page scope summary and request a booking decision.",
  booking: "Confirm attendees, agenda, and expected implementation window.",
  proposal: "Review scope + deposit terms and secure start with payment.",
  deposit_received: "Share kickoff packet and schedule implementation handoff.",
  won: "Move to delivery checklist and onboarding milestones.",
  lost: "Route to nurture queue with updated proof points and timing trigger.",
};

const OBJECTION_PROMPTS = {
  price:
    "If price is the blocker, we can stage delivery into a smaller phase-one package, then expand after initial outcomes.",
  timing:
    "If timing is the blocker, we can reserve your slot now and set kickoff to your preferred delivery window.",
  trust:
    "If confidence is the blocker, we can share a concise proof bundle (scope examples, expected outcomes, and implementation plan).",
  technical:
    "If implementation complexity is the blocker, we can start with a low-risk discovery sprint that de-risks integration before full build.",
} as const;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDateMs(value: unknown): number | null {
  const normalized = asString(value);
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function introLineForSequence(sequence: number, branch: FollowupBranch): string {
  if (branch === "not_now") {
    return "Checking back in at the timeline you requested.";
  }
  if (branch === "no_response") {
    return "Closing the loop for now in case timing changed.";
  }
  if (sequence === 1) return "Quick follow-up in case my earlier note got buried.";
  if (sequence === 2) return "Sharing one proof-point style next step so this is easier to evaluate.";
  if (sequence === 3) return "If scope feels too large right now, we can start with a smaller first milestone.";
  if (sequence >= 4) return "If now is not the right window, we can move this into a lighter nurture cadence.";
  return "Quick follow-up.";
}

function subjectForSequence(args: {
  sequence: number;
  branch: FollowupBranch;
  companyName: string;
}): string {
  const companyName = args.companyName || "your team";
  if (args.branch === "not_now") return `Checking back in as requested - ${companyName}`;
  if (args.branch === "no_response") return `Last follow-up for now - ${companyName}`;
  if (args.sequence === 1) return `Quick follow-up - ${companyName}`;
  if (args.sequence === 2) return `Quick check-in + proof point - ${companyName}`;
  if (args.sequence === 3) return `Options for ${companyName}`;
  if (args.sequence >= 4) return `Nurture check-in - ${companyName}`;
  return `Follow-up - ${companyName}`;
}

function resolveOfferCta(offerCode: string | null, businessUnit: BusinessUnitId): string {
  if (offerCode && OFFER_CTA_BY_CODE[offerCode]) return OFFER_CTA_BY_CODE[offerCode];
  return DEFAULT_CTA_BY_BUSINESS[businessUnit];
}

export function resolveFollowupBranch(args: {
  sequence: number;
  noResponseCount?: unknown;
  disposition?: unknown;
  notNowUntil?: unknown;
  nowMs?: number;
}): { branch: FollowupBranch; notNowUntilMs: number | null } {
  const nowMs = Number.isFinite(args.nowMs || Number.NaN) ? Number(args.nowMs) : Date.now();
  const sequence = Math.max(1, asInt(args.sequence, 1));
  const noResponseCount = Math.max(0, asInt(args.noResponseCount, 0));
  const disposition = asString(args.disposition).toLowerCase().replace(/\s+/g, "_");
  const notNowUntilMs = parseDateMs(args.notNowUntil);

  if (
    disposition === "not_now" ||
    disposition === "not-now" ||
    (Number.isFinite(notNowUntilMs) && (notNowUntilMs as number) > nowMs)
  ) {
    return { branch: "not_now", notNowUntilMs };
  }

  if (
    disposition === "no_response" ||
    disposition === "no-response" ||
    sequence >= 4 ||
    noResponseCount >= 2
  ) {
    return { branch: "no_response", notNowUntilMs: null };
  }

  return { branch: "standard", notNowUntilMs: null };
}

export function buildFollowupMessagePlan(args: {
  branch: FollowupBranch;
  sequence: number;
  companyName: string;
  leadName: string;
  founderName: string;
  businessName: string;
  primaryService: string;
  businessUnit?: unknown;
  offerCode?: unknown;
  pipelineStage?: unknown;
}): FollowupMessagePlan {
  const sequence = Math.max(1, asInt(args.sequence, 1));
  const branch = args.branch;
  const companyName = args.companyName || "your team";
  const leadName = args.leadName || "there";
  const founderName = args.founderName || "Founder";
  const businessName = args.businessName || "Mission Control";
  const primaryService = args.primaryService || "growth support";
  const businessUnit = normalizeBusinessUnit(args.businessUnit);
  const offerCode = normalizeOfferCode(args.offerCode);
  const pipelineStage = normalizeCrmPipelineStage(args.pipelineStage);
  const stageLabel = formatCrmPipelineStageLabel(pipelineStage);
  const offerCta = resolveOfferCta(offerCode || null, businessUnit);
  const nextStep = STAGE_NEXT_STEP_SCRIPT[pipelineStage];

  const body = `
    <h2>Hi ${leadName},</h2>
    <p>${introLineForSequence(sequence, branch)}</p>
    <p>I can send a quick 2-3 bullet plan for <strong>${companyName}</strong> focused on ${primaryService}.</p>
    <p><strong>Offer CTA:</strong> ${offerCta}</p>
    <p><strong>Next Step (${stageLabel}):</strong> ${nextStep}</p>
    <p>If objections came up, here are practical next-step options:</p>
    <ul>
      <li><strong>Price:</strong> ${OBJECTION_PROMPTS.price}</li>
      <li><strong>Timing:</strong> ${OBJECTION_PROMPTS.timing}</li>
      <li><strong>Trust:</strong> ${OBJECTION_PROMPTS.trust}</li>
      <li><strong>Technical:</strong> ${OBJECTION_PROMPTS.technical}</li>
    </ul>
    <p>Open to a quick 15-minute call next week?</p>
    <br/>
    <p>Best regards,</p>
    <p>${founderName}<br/>${businessName}</p>
  `;

  return {
    subject: subjectForSequence({ sequence, branch, companyName }),
    html: body,
    nextStep,
  };
}
