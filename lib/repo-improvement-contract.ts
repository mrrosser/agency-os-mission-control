import { z } from "zod";

export const RepoImprovementDecisionSchema = z.enum([
  "approve",
  "reject",
  "defer",
  "needs-human",
]);

export const RepoImprovementOutcomeSchema = z.enum([
  "pending",
  "stable",
  "reverted",
  "superseded",
]);

export const RepoImprovementDecisionLabelSchema = z.object({
  id: RepoImprovementDecisionSchema,
  description: z.string(),
  counts_as_accept: z.boolean(),
  requires_reason_code: z.boolean(),
});

export const RepoImprovementReasonCodeSchema = z.object({
  id: z.string(),
  decisions: z.array(RepoImprovementDecisionSchema),
  description: z.string(),
});

export const RepoImprovementOutcomeLabelSchema = z.object({
  id: RepoImprovementOutcomeSchema,
  description: z.string(),
});

export const RepoImprovementReviewSchemaDefinitionSchema = z.object({
  schema_version: z.string(),
  decision_labels: z.array(RepoImprovementDecisionLabelSchema),
  reason_codes: z.array(RepoImprovementReasonCodeSchema),
  outcome_labels: z.array(RepoImprovementOutcomeLabelSchema),
  required_fields: z.array(z.string()),
});

export const RepoImprovementInboxItemSchema = z.object({
  review_id: z.string(),
  repo: z.string(),
  run_id: z.string(),
  generated_at: z.string(),
  overnight_decision: z.string(),
  score: z.string(),
  proposal_ready: z.boolean().default(false),
  proposal_patch_class: z.string().default(""),
  proposal_summary: z.string().default(""),
  proposal_path: z.string().default(""),
  failure_signature: z.string().default(""),
  fix_classes: z.array(z.string()).default([]),
  files_touched: z.array(z.string()).default([]),
  verifier_passed_count: z.number(),
  verifier_total_count: z.number(),
  evidence_refs: z.array(z.string()).default([]),
});

export const RepoImprovementMorningReviewSchemaSchema = z.object({
  summary: z.object({
    generated_at: z.string(),
    pending_review_count: z.number(),
    metrics_json_report_path: z.string(),
    training_dataset_path: z.string(),
  }),
  schema: RepoImprovementReviewSchemaDefinitionSchema,
  inbox_items: z.array(RepoImprovementInboxItemSchema),
});

export const RepoImprovementMetricsPayloadSchema = z.object({
  summary: z.object({
    generated_at: z.string(),
    review_entry_count: z.number(),
    pending_review_count: z.number(),
    reviewed_count: z.number(),
  }),
  rates: z.object({
    proposal_rate: z.number(),
    keep_rate: z.number(),
    morning_approval_rate: z.number(),
    revert_rate: z.number(),
    verifier_pass_rate: z.number(),
    repeat_failure_rate: z.number(),
    time_to_accept_hours: z.number().nullable(),
  }),
  promotion_policy: z.unknown().nullable().optional(),
  promotion_candidates: z.array(
    z.object({
      fix_class: z.string(),
      reviewed_runs: z.number(),
      approved_runs: z.number(),
      approval_rate: z.number(),
      verifier_pass_rate: z.number(),
      revert_count: z.number(),
      promotion_ready: z.boolean(),
      promotion_reason: z.string(),
    })
  ),
  per_repo: z.array(
    z.object({
      repo: z.string(),
      run_count: z.number(),
      pending_review_count: z.number(),
      overnight_keep_count: z.number(),
      morning_approve_count: z.number(),
      verifier_pass_rate: z.number(),
    })
  ),
});

export const RepoImprovementPathsSchema = z.object({
  reportRoot: z.string(),
  scriptRoot: z.string(),
  reviewLedgerPath: z.string(),
  morningReviewSchemaPath: z.string(),
  metricsJsonPath: z.string(),
  trainingDatasetPath: z.string(),
  reviewScriptPath: z.string(),
});

export const RepoImprovementApiStatusSchema = z.enum([
  "available",
  "degraded",
  "unavailable",
]);

export const RepoImprovementSnapshotSchema = z.object({
  generatedAt: z.string(),
  status: RepoImprovementApiStatusSchema,
  detail: z.string(),
  paths: RepoImprovementPathsSchema,
  reviewScriptAvailable: z.boolean(),
  reviewSchema: RepoImprovementMorningReviewSchemaSchema.nullable(),
  metrics: RepoImprovementMetricsPayloadSchema.nullable(),
});

export const RepoImprovementReviewRequestSchema = z.object({
  reviewId: z.string().trim().min(1).max(240),
  decision: RepoImprovementDecisionSchema,
  reasonCode: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(2000).optional(),
  outcomeAfter7d: RepoImprovementOutcomeSchema.optional(),
  outcomeNotes: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

export const RepoImprovementReviewResponseSchema = z.object({
  review_id: z.string(),
  decision: RepoImprovementDecisionSchema,
  reason_code: z.string(),
  reviewer: z.string(),
  review_ledger_path: z.string(),
  morning_review_schema_path: z.string(),
  metrics_json_report_path: z.string(),
  training_dataset_path: z.string(),
  updated_entry: z.record(z.string(), z.unknown()),
  pending_review_count: z.number(),
});

export type RepoImprovementDecision = z.infer<typeof RepoImprovementDecisionSchema>;
export type RepoImprovementOutcome = z.infer<typeof RepoImprovementOutcomeSchema>;
export type RepoImprovementMorningReviewSchema = z.infer<
  typeof RepoImprovementMorningReviewSchemaSchema
>;
export type RepoImprovementMetricsPayload = z.infer<
  typeof RepoImprovementMetricsPayloadSchema
>;
export type RepoImprovementPaths = z.infer<typeof RepoImprovementPathsSchema>;
export type RepoImprovementSnapshot = z.infer<typeof RepoImprovementSnapshotSchema>;
export type RepoImprovementReviewRequest = z.infer<
  typeof RepoImprovementReviewRequestSchema
>;
export type RepoImprovementReviewResponse = z.infer<
  typeof RepoImprovementReviewResponseSchema
>;
