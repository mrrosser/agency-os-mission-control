import { z } from "zod";

export const GrowthResearchDecisionSchema = z.enum([
  "approve",
  "reject",
  "defer",
  "needs-human",
]);

export const GrowthResearchOutcomeSchema = z.enum([
  "pending",
  "stable",
  "reverted",
  "superseded",
]);

export const GrowthResearchDecisionLabelSchema = z.object({
  id: GrowthResearchDecisionSchema,
  description: z.string(),
  counts_as_accept: z.boolean(),
  requires_reason_code: z.boolean(),
});

export const GrowthResearchReasonCodeSchema = z.object({
  id: z.string(),
  decisions: z.array(GrowthResearchDecisionSchema),
  description: z.string(),
});

export const GrowthResearchOutcomeLabelSchema = z.object({
  id: GrowthResearchOutcomeSchema,
  description: z.string(),
});

export const GrowthResearchReviewSchemaDefinitionSchema = z.object({
  schema_version: z.string(),
  decision_labels: z.array(GrowthResearchDecisionLabelSchema),
  reason_codes: z.array(GrowthResearchReasonCodeSchema),
  outcome_labels: z.array(GrowthResearchOutcomeLabelSchema),
  required_fields: z.array(z.string()),
});

export const GrowthResearchProposedScaffoldSchema = z
  .object({
    shared_skill_name: z.string().optional(),
    wrapper_name: z.string().optional(),
    markdown_path: z.string().optional(),
    json_path: z.string().optional(),
  })
  .passthrough();

export const GrowthResearchGovernanceSchema = z.object({
  mode: z.string(),
  attested: z.boolean(),
  product_repo_writes_allowed: z.boolean(),
  business_actions_allowed: z.boolean(),
  shared_scaffold_only: z.boolean(),
  review_required: z.boolean(),
  scaffold_root: z.string(),
  notes: z.array(z.string()).default([]),
});

export const GrowthResearchPromotionCandidateSchema = z.object({
  recommendation_class: z.string(),
  reviewed_runs: z.number(),
  approved_runs: z.number(),
  approval_rate: z.number(),
  average_confidence: z.number(),
  revert_count: z.number(),
  promotion_ready: z.boolean(),
  promotion_reason: z.string(),
});

export const GrowthResearchInboxItemSchema = z.object({
  review_id: z.string(),
  repo_or_domain: z.string(),
  target_id: z.string(),
  run_id: z.string(),
  generated_at: z.string(),
  evaluator_class: z.string(),
  score_status: z.string(),
  objective_score: z.number(),
  priority_score: z.number(),
  confidence: z.number(),
  signal_class_summary: z.string(),
  recommended_experiment: z.string(),
  recommended_experiment_class: z.string(),
  promotion_candidate: GrowthResearchPromotionCandidateSchema.nullable().optional(),
  proposed_scaffold: GrowthResearchProposedScaffoldSchema.nullable().optional(),
  evidence_refs: z.array(z.string()).default([]),
});

export const GrowthResearchWeeklyReviewSchemaSchema = z.object({
  summary: z.object({
    generated_at: z.string(),
    pending_review_count: z.number(),
    metrics_json_report_path: z.string(),
    training_dataset_path: z.string(),
    promotion_candidate_count: z.number().optional(),
    promotion_ready_count: z.number().optional(),
  }),
  governance: GrowthResearchGovernanceSchema.optional(),
  schema: GrowthResearchReviewSchemaDefinitionSchema,
  inbox_items: z.array(GrowthResearchInboxItemSchema),
});

export const GrowthResearchMetricsPayloadSchema = z.object({
  summary: z.object({
    generated_at: z.string(),
    review_entry_count: z.number(),
    pending_review_count: z.number(),
    reviewed_count: z.number(),
  }),
  rates: z.object({
    approval_rate: z.number(),
    defer_rate: z.number(),
    needs_human_rate: z.number(),
    stable_rate: z.number(),
    high_confidence_rate: z.number(),
    average_objective_score: z.number(),
    average_priority_score: z.number(),
    time_to_accept_hours: z.number().nullable(),
  }),
  governance: GrowthResearchGovernanceSchema.optional(),
  promotion_policy: z.unknown().nullable().optional(),
  promotion_candidates: z.array(GrowthResearchPromotionCandidateSchema),
  per_target: z.array(
    z.object({
      repo_or_domain: z.string(),
      run_count: z.number(),
      pending_review_count: z.number(),
      approved_count: z.number(),
      average_objective_score: z.number(),
      average_priority_score: z.number(),
    })
  ),
});

export const GrowthResearchPathsSchema = z.object({
  reportRoot: z.string(),
  scriptRoot: z.string(),
  reviewLedgerPath: z.string(),
  weeklyReviewSchemaPath: z.string(),
  metricsJsonPath: z.string(),
  trainingDatasetPath: z.string(),
  reviewScriptPath: z.string(),
});

export const GrowthResearchApiStatusSchema = z.enum([
  "available",
  "degraded",
  "unavailable",
]);

export const GrowthResearchSnapshotSchema = z.object({
  generatedAt: z.string(),
  status: GrowthResearchApiStatusSchema,
  detail: z.string(),
  paths: GrowthResearchPathsSchema,
  reviewScriptAvailable: z.boolean(),
  reviewSchema: GrowthResearchWeeklyReviewSchemaSchema.nullable(),
  metrics: GrowthResearchMetricsPayloadSchema.nullable(),
});

export const GrowthResearchReviewRequestSchema = z.object({
  reviewId: z.string().trim().min(1).max(240),
  decision: GrowthResearchDecisionSchema,
  reasonCode: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(2000).optional(),
  outcomeAfter7d: GrowthResearchOutcomeSchema.optional(),
  outcomeNotes: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

export const GrowthResearchReviewResponseSchema = z.object({
  review_id: z.string(),
  decision: GrowthResearchDecisionSchema,
  reason_code: z.string(),
  reviewer: z.string(),
  review_ledger_path: z.string(),
  weekly_review_schema_path: z.string(),
  metrics_json_report_path: z.string(),
  training_dataset_path: z.string(),
  updated_entry: z.record(z.string(), z.unknown()),
  pending_review_count: z.number(),
});

export type GrowthResearchDecision = z.infer<
  typeof GrowthResearchDecisionSchema
>;
export type GrowthResearchOutcome = z.infer<typeof GrowthResearchOutcomeSchema>;
export type GrowthResearchWeeklyReviewSchema = z.infer<
  typeof GrowthResearchWeeklyReviewSchemaSchema
>;
export type GrowthResearchMetricsPayload = z.infer<
  typeof GrowthResearchMetricsPayloadSchema
>;
export type GrowthResearchPaths = z.infer<typeof GrowthResearchPathsSchema>;
export type GrowthResearchSnapshot = z.infer<typeof GrowthResearchSnapshotSchema>;
export type GrowthResearchReviewRequest = z.infer<
  typeof GrowthResearchReviewRequestSchema
>;
export type GrowthResearchReviewResponse = z.infer<
  typeof GrowthResearchReviewResponseSchema
>;
