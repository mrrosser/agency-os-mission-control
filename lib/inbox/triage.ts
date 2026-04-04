import type { GmailMessage } from "@/lib/google/gmail";

export type InboxTriageBucket = "hot" | "follow_up" | "nurture" | "ignore";
export type InboxSponsorBucket = "exceptional" | "high" | "medium" | "low" | "spam";
export type InboxSponsorPriority = "critical" | "high" | "normal" | "none";
export type InboxSponsorTemplate = "qualify" | "decline" | null;

export interface InboxTriageDimensions {
  fit: number;
  clarity: number;
  budget: number;
  seriousness: number;
  companyTrust: number;
  closeLikelihood: number;
}

export interface InboxTriageSuggestedAction {
  escalate: boolean;
  priority: InboxSponsorPriority;
  autoDraft: boolean;
  template: InboxSponsorTemplate;
  suppress: boolean;
}

export interface InboxTriageResult {
  rubricVersion: "v2";
  score: number;
  confidence: number;
  bucket: InboxTriageBucket;
  sponsorBucket: InboxSponsorBucket;
  confidenceThreshold: number;
  lowConfidence: boolean;
  dimensions: InboxTriageDimensions;
  suggestedAction: InboxTriageSuggestedAction;
  reasons: string[];
}

export interface InboxTriagedMessage extends GmailMessage {
  triage: InboxTriageResult;
}

export interface InboxTriageSummary {
  total: number;
  bucketCounts: Record<InboxTriageBucket, number>;
  sponsorBucketCounts: Record<InboxSponsorBucket, number>;
  averageScore: number;
  averageConfidence: number;
  lowConfidenceCount: number;
}

interface RuleSet {
  positiveIntent: string[];
  meetingIntent: string[];
  commercialIntent: string[];
  urgency: string[];
  negativeIntent: string[];
  autoReply: string[];
  budgetIntent: string[];
}

const CONFIDENCE_THRESHOLD = 0.65;
const DIMENSION_WEIGHTS: Record<keyof InboxTriageDimensions, number> = {
  fit: 0.2,
  clarity: 0.15,
  budget: 0.15,
  seriousness: 0.15,
  companyTrust: 0.2,
  closeLikelihood: 0.15,
};
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

const RULES: RuleSet = {
  positiveIntent: [
    "interested",
    "sounds good",
    "looks good",
    "lets talk",
    "let's talk",
    "happy to",
    "please share",
    "would love to",
  ],
  meetingIntent: [
    "book",
    "meeting",
    "schedule",
    "calendar",
    "call",
    "demo",
    "availability",
    "time to talk",
  ],
  commercialIntent: [
    "proposal",
    "quote",
    "pricing",
    "budget",
    "invoice",
    "deposit",
    "contract",
    "scope",
    "purchase",
  ],
  urgency: ["urgent", "asap", "today", "tomorrow", "this week", "deadline", "quick"],
  negativeIntent: [
    "unsubscribe",
    "remove me",
    "stop emailing",
    "do not contact",
    "not interested",
    "wrong person",
    "take me off",
  ],
  autoReply: [
    "out of office",
    "automatic reply",
    "auto reply",
    "delivery status notification",
    "mailer-daemon",
    "undeliverable",
  ],
  budgetIntent: ["budget", "pricing", "price", "cost", "invoice", "deposit"],
};

function sanitizeText(value: string | null | undefined): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function headerValue(message: GmailMessage, name: string): string {
  const headers = message.payload?.headers || [];
  const found = headers.find(
    (header) => String(header.name || "").toLowerCase() === name.toLowerCase()
  );
  return found?.value || "";
}

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function parseFromDomain(fromHeader: string): string | null {
  const normalized = fromHeader.toLowerCase();
  const angleMatch = normalized.match(/<([^>]+)>/);
  const email = angleMatch?.[1] || normalized;
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).replace(/[^a-z0-9.-]/g, "");
  return domain || null;
}

function mapSponsorBucketToLegacyBucket(bucket: InboxSponsorBucket): InboxTriageBucket {
  if (bucket === "exceptional" || bucket === "high") return "hot";
  if (bucket === "medium") return "follow_up";
  if (bucket === "low") return "nurture";
  return "ignore";
}

function sponsorBucketFromScore(score: number): InboxSponsorBucket {
  if (score >= 80) return "exceptional";
  if (score >= 65) return "high";
  if (score >= 45) return "medium";
  if (score >= 20) return "low";
  return "spam";
}

function actionForSponsorBucket(bucket: InboxSponsorBucket): InboxTriageSuggestedAction {
  if (bucket === "exceptional") {
    return {
      escalate: true,
      priority: "critical",
      autoDraft: false,
      template: null,
      suppress: false,
    };
  }
  if (bucket === "high") {
    return {
      escalate: true,
      priority: "high",
      autoDraft: true,
      template: "qualify",
      suppress: false,
    };
  }
  if (bucket === "medium") {
    return {
      escalate: false,
      priority: "normal",
      autoDraft: true,
      template: "qualify",
      suppress: false,
    };
  }
  if (bucket === "low") {
    return {
      escalate: false,
      priority: "normal",
      autoDraft: true,
      template: "decline",
      suppress: false,
    };
  }
  return {
    escalate: false,
    priority: "none",
    autoDraft: false,
    template: null,
    suppress: true,
  };
}

function weightedScore(dimensions: InboxTriageDimensions): number {
  const total =
    dimensions.fit * DIMENSION_WEIGHTS.fit +
    dimensions.clarity * DIMENSION_WEIGHTS.clarity +
    dimensions.budget * DIMENSION_WEIGHTS.budget +
    dimensions.seriousness * DIMENSION_WEIGHTS.seriousness +
    dimensions.companyTrust * DIMENSION_WEIGHTS.companyTrust +
    dimensions.closeLikelihood * DIMENSION_WEIGHTS.closeLikelihood;
  return round(clamp(total, 0, 100));
}

export function scoreInboxMessage(message: GmailMessage): InboxTriageResult {
  const subject = sanitizeText(headerValue(message, "Subject"));
  const from = sanitizeText(headerValue(message, "From"));
  const snippet = sanitizeText(message.snippet);
  const text = `${subject} ${snippet}`.trim();
  const fromDomain = parseFromDomain(from);

  const hasPositiveIntent = containsAny(text, RULES.positiveIntent);
  const hasMeetingIntent = containsAny(text, RULES.meetingIntent);
  const hasCommercialIntent = containsAny(text, RULES.commercialIntent);
  const hasBudgetIntent = containsAny(text, RULES.budgetIntent);
  const hasUrgency = containsAny(text, RULES.urgency);
  const hasNegativeIntent = containsAny(text, RULES.negativeIntent);
  const hasAutoReply =
    containsAny(text, RULES.autoReply) || containsAny(from, RULES.autoReply);
  const hasQuestion = text.includes("?");
  const isActiveThread = subject.startsWith("re:");
  const looksBusinessDomain =
    Boolean(fromDomain) && !FREE_EMAIL_DOMAINS.has(String(fromDomain || ""));

  const reasons: string[] = [];
  if (hasPositiveIntent) reasons.push("positive_intent");
  if (hasMeetingIntent) reasons.push("meeting_intent");
  if (hasCommercialIntent) reasons.push("commercial_intent");
  if (hasBudgetIntent) reasons.push("budget_signal");
  if (hasUrgency) reasons.push("urgency");
  if (isActiveThread) reasons.push("active_thread");
  if (hasQuestion) reasons.push("question");
  if (looksBusinessDomain) reasons.push("business_domain");
  if (hasNegativeIntent) reasons.push("negative_intent");
  if (hasAutoReply) reasons.push("auto_reply_or_bounce");

  const dimensions: InboxTriageDimensions = {
    fit: clamp(
      40 +
        (hasPositiveIntent ? 18 : 0) +
        (hasCommercialIntent ? 20 : 0) +
        (hasMeetingIntent ? 12 : 0) -
        (hasNegativeIntent ? 65 : 0) -
        (hasAutoReply ? 80 : 0),
      0,
      100
    ),
    clarity: clamp(
      45 +
        (hasQuestion ? 16 : 0) +
        (isActiveThread ? 12 : 0) +
        (hasMeetingIntent ? 8 : 0) +
        (hasAutoReply ? -40 : 0),
      0,
      100
    ),
    budget: clamp(
      35 +
        (hasBudgetIntent ? 26 : 0) +
        (hasCommercialIntent ? 18 : 0) +
        (hasNegativeIntent ? -25 : 0) +
        (hasAutoReply ? -30 : 0),
      0,
      100
    ),
    seriousness: clamp(
      35 +
        (hasUrgency ? 24 : 0) +
        (hasMeetingIntent ? 18 : 0) +
        (isActiveThread ? 10 : 0) -
        (hasNegativeIntent ? 60 : 0) -
        (hasAutoReply ? 80 : 0),
      0,
      100
    ),
    companyTrust: clamp(
      50 +
        (looksBusinessDomain ? 22 : -8) +
        (hasAutoReply ? -35 : 0) +
        (hasNegativeIntent ? -10 : 0),
      0,
      100
    ),
    closeLikelihood: clamp(
      30 +
        (hasMeetingIntent ? 20 : 0) +
        (hasCommercialIntent ? 16 : 0) +
        (hasPositiveIntent ? 12 : 0) +
        (hasUrgency ? 8 : 0) -
        (hasNegativeIntent ? 70 : 0) -
        (hasAutoReply ? 80 : 0),
      0,
      100
    ),
  };

  const score = weightedScore(dimensions);
  const sponsorBucket =
    hasNegativeIntent || hasAutoReply ? "spam" : sponsorBucketFromScore(score);
  const bucket = mapSponsorBucketToLegacyBucket(sponsorBucket);
  const suggestedAction = actionForSponsorBucket(sponsorBucket);

  const dimensionSignalCount = Object.values(dimensions).filter((value) => value >= 60).length;
  const signalStrength = Math.min(1, reasons.length / 10);
  const extremity = Math.min(1, Math.abs(score - 50) / 50);
  const confidence = round(
    clamp(0.42 + signalStrength * 0.28 + extremity * 0.2 + (dimensionSignalCount / 6) * 0.15, 0.35, 0.99)
  );

  return {
    rubricVersion: "v2",
    score,
    confidence,
    bucket,
    sponsorBucket,
    confidenceThreshold: CONFIDENCE_THRESHOLD,
    lowConfidence: confidence < CONFIDENCE_THRESHOLD,
    dimensions: {
      fit: round(dimensions.fit),
      clarity: round(dimensions.clarity),
      budget: round(dimensions.budget),
      seriousness: round(dimensions.seriousness),
      companyTrust: round(dimensions.companyTrust),
      closeLikelihood: round(dimensions.closeLikelihood),
    },
    suggestedAction,
    reasons,
  };
}

export function triageInboxMessages(messages: GmailMessage[]): InboxTriagedMessage[] {
  return messages.map((message) => ({
    ...message,
    triage: scoreInboxMessage(message),
  }));
}

export function summarizeInboxTriage(messages: InboxTriagedMessage[]): InboxTriageSummary {
  const bucketCounts: Record<InboxTriageBucket, number> = {
    hot: 0,
    follow_up: 0,
    nurture: 0,
    ignore: 0,
  };
  const sponsorBucketCounts: Record<InboxSponsorBucket, number> = {
    exceptional: 0,
    high: 0,
    medium: 0,
    low: 0,
    spam: 0,
  };
  let scoreTotal = 0;
  let confidenceTotal = 0;
  let lowConfidenceCount = 0;

  for (const message of messages) {
    const triage = message.triage;
    bucketCounts[triage.bucket] += 1;
    sponsorBucketCounts[triage.sponsorBucket] += 1;
    scoreTotal += triage.score;
    confidenceTotal += triage.confidence;
    if (triage.lowConfidence) lowConfidenceCount += 1;
  }

  const total = messages.length;
  return {
    total,
    bucketCounts,
    sponsorBucketCounts,
    averageScore: total > 0 ? round(scoreTotal / total) : 0,
    averageConfidence: total > 0 ? round(confidenceTotal / total) : 0,
    lowConfidenceCount,
  };
}
