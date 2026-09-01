import { z } from "zod";

const SECOND_BRAIN_SENSITIVE_TEXT = /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b\d{3}-\d{2}-\d{4}\b|\b(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}\b|\bsk-[A-Za-z0-9_-]{20,}\b|\bAIza[0-9A-Za-z_-]{30,}\b|\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}\b|\bAKIA[0-9A-Z]{16}\b|\bBearer\s+[A-Za-z0-9._~+\/-]{20,}={0,2}\b|\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*\S{4,})/i;

function containsLikelyPaymentCard(value: string): boolean {
  const candidates = value.match(/\b(?:\d[ -]?){13,19}\b/g) || [];
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let doubleDigit = false;
    for (let index = digits.length - 1; index >= 0; index -= 1) {
      let digit = Number(digits[index]);
      if (doubleDigit) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      doubleDigit = !doubleDigit;
    }
    return sum % 10 === 0;
  });
}

export function containsSecondBrainSensitiveText(value: unknown): boolean {
  const text = String(value ?? "");
  return SECOND_BRAIN_SENSITIVE_TEXT.test(text) || containsLikelyPaymentCard(text);
}

function safeText(minimum: number, maximum: number) {
  return z.string().trim().min(minimum).max(maximum).refine(
    (value) => !containsSecondBrainSensitiveText(value),
    "Sensitive or personally identifying text is not allowed"
  );
}

export const SecondBrainCandidateStatusSchema = z.enum([
  "proposed",
  "rejected",
  "reviewable",
  "approved",
  "defer",
  "needs-human",
  "promoted",
  "reverted",
]);

export const SecondBrainDecisionSchema = z.enum([
  "approve",
  "reject",
  "defer",
  "needs-human",
]);

const SecondBrainCandidateIdSchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    "Candidate IDs must be safe Firestore document IDs"
  );

export const SecondBrainCandidateSchema = z.object({
  candidateId: SecondBrainCandidateIdSchema,
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/i),
  skillName: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  purpose: safeText(1, 1200),
  status: SecondBrainCandidateStatusSchema,
  generatedAt: z.string().datetime({ offset: true }),
  evaluatorVersion: safeText(1, 120),
  caseCount: z.number().int().nonnegative().max(100_000).default(0),
  qualityDeltaPoints: z.number().finite().min(-100).max(100).default(0),
  efficiencyImprovement: z.number().finite().min(-10).max(10).default(0),
  evidenceCount: z.number().int().nonnegative().max(100_000),
  riskFlags: z.array(safeText(1, 120)).max(24).default([]),
  safeDiffSummary: safeText(0, 4000).default(""),
  correlationId: safeText(1, 160),
}).strict();

export const SecondBrainHealthSchema = z.object({
  generatedAt: z.string().datetime({ offset: true }),
  sourceCount: z.number().int().nonnegative(),
  healthySourceCount: z.number().int().nonnegative(),
  traceCount: z.number().int().nonnegative(),
  patternCount: z.number().int().nonnegative(),
  pendingReviewCount: z.number().int().nonnegative(),
  storageStatus: z.enum(["healthy", "warning", "paused"]),
  keyReady: z.boolean(),
  qmdReady: z.boolean(),
  shadowCyclesPassed: z.number().int().nonnegative().default(0),
  lastCaptureAt: z.string().datetime({ offset: true }).nullable().default(null),
  lastConsolidationAt: z.string().datetime({ offset: true }).nullable().default(null),
}).strict();

export const SecondBrainCandidateSyncRequestSchema = z.object({
  uid: z.string().trim().min(1).max(128),
  generatedAt: z.string().datetime({ offset: true }),
  candidates: z.array(SecondBrainCandidateSchema).max(25),
  health: SecondBrainHealthSchema.optional(),
  idempotencyKey: safeText(1, 200).optional(),
}).strict().superRefine((payload, context) => {
  const seen = new Set<string>();
  payload.candidates.forEach((candidate, index) => {
    if (seen.has(candidate.candidateId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["candidates", index, "candidateId"],
        message: "Candidate IDs must be unique within a sync request",
      });
    }
    seen.add(candidate.candidateId);
  });
});

export const SecondBrainReviewRequestSchema = z.object({
  candidateId: safeText(1, 160),
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/i),
  decision: SecondBrainDecisionSchema,
  reasonCode: safeText(1, 120),
  notes: safeText(0, 2000).optional(),
  idempotencyKey: safeText(1, 200).optional(),
});

export const SecondBrainReviewRecordSchema = z.object({
  candidateId: z.string(),
  candidateHash: z.string(),
  decision: SecondBrainDecisionSchema,
  reasonCode: z.string(),
  notes: z.string().default(""),
  reviewerUid: z.string(),
  reviewerEmail: z.string().email().nullable(),
  reviewedAt: z.string().datetime({ offset: true }),
  correlationId: z.string(),
  idempotencyKey: z.string(),
  source: z.enum(["mission-control", "email-action"]),
});

export const SecondBrainDigestRequestSchema = z.object({
  uid: z.string().trim().min(1).max(128),
  digestDate: z.string().date().optional(),
  candidateIds: z.array(safeText(1, 160)).max(10).optional(),
  dryRun: z.boolean().default(true),
  idempotencyKey: safeText(1, 200).optional(),
});

export const SecondBrainUrgentRequestSchema = z.object({
  uid: z.string().trim().min(1).max(128),
  eventId: safeText(1, 160),
  eventType: z.enum([
    "secret-redaction-failure",
    "encryption-failure",
    "storage-paused",
    "control-plane-failure",
    "promotion-failure",
    "rollback-failure",
    "automatic-rollback",
  ]),
  severity: z.enum(["warning", "critical"]),
  summary: safeText(1, 2000),
  candidateId: safeText(1, 160).optional(),
  detectedAt: z.string().datetime({ offset: true }),
  dryRun: z.boolean().default(true),
  idempotencyKey: safeText(1, 200).optional(),
});

export const SecondBrainEmailActionConfirmSchema = z.object({
  token: z.string().trim().min(32).max(512),
  reasonCode: safeText(1, 120),
  notes: safeText(0, 2000).optional(),
  idempotencyKey: safeText(1, 200).optional(),
});

export const SecondBrainSnapshotSchema = z.object({
  generatedAt: z.string().datetime({ offset: true }),
  health: SecondBrainHealthSchema.nullable(),
  candidates: z.array(SecondBrainCandidateSchema.extend({
    review: SecondBrainReviewRecordSchema.nullable().optional(),
  })),
  decisions: z.array(SecondBrainReviewRecordSchema),
  notifications: z.array(z.object({
    notificationId: z.string(),
    kind: z.enum(["digest", "urgent"]),
    status: z.enum(["dry-run", "delivered", "dead-letter"]),
    createdAt: z.string(),
    recipientCount: z.number().int().nonnegative(),
    correlationId: z.string(),
    detail: z.string().default(""),
  })),
});

export type SecondBrainCandidate = z.infer<typeof SecondBrainCandidateSchema>;
export type SecondBrainCandidateSyncRequest = z.infer<typeof SecondBrainCandidateSyncRequestSchema>;
export type SecondBrainDecision = z.infer<typeof SecondBrainDecisionSchema>;
export type SecondBrainDigestRequest = z.infer<typeof SecondBrainDigestRequestSchema>;
export type SecondBrainEmailActionConfirm = z.infer<typeof SecondBrainEmailActionConfirmSchema>;
export type SecondBrainHealth = z.infer<typeof SecondBrainHealthSchema>;
export type SecondBrainReviewRecord = z.infer<typeof SecondBrainReviewRecordSchema>;
export type SecondBrainSnapshot = z.infer<typeof SecondBrainSnapshotSchema>;
export type SecondBrainUrgentRequest = z.infer<typeof SecondBrainUrgentRequestSchema>;
