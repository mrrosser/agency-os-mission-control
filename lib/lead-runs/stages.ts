import "server-only";

export type LeadRunStage = "source" | "enrich" | "score" | "outreach" | "booking";
export type LeadRunStageStatus = "pending" | "running" | "complete" | "skipped" | "error";

export interface LeadRunStageEntry {
  status: LeadRunStageStatus;
  updatedAt: string;
  detail?: string;
}

export interface LeadRunStageProgress {
  currentStage: LeadRunStage | "complete";
  updatedAt: string;
  stages: Record<LeadRunStage, LeadRunStageEntry>;
}

function nowIso(now?: Date): string {
  return (now || new Date()).toISOString();
}

export function buildInitialLeadStageProgress(options?: {
  includeEnrichment?: boolean;
  now?: Date;
}): LeadRunStageProgress {
  const ts = nowIso(options?.now);
  const enrichmentStatus: LeadRunStageStatus = options?.includeEnrichment ? "complete" : "skipped";

  return {
    currentStage: "outreach",
    updatedAt: ts,
    stages: {
      source: { status: "complete", updatedAt: ts },
      enrich: {
        status: enrichmentStatus,
        updatedAt: ts,
        detail: options?.includeEnrichment ? "firecrawl_enabled" : "firecrawl_disabled",
      },
      score: { status: "complete", updatedAt: ts },
      outreach: { status: "pending", updatedAt: ts },
      booking: { status: "pending", updatedAt: ts },
    },
  };
}

export function updateLeadStageProgress(
  input: LeadRunStageProgress | undefined,
  stage: LeadRunStage,
  status: LeadRunStageStatus,
  detail?: string
): LeadRunStageProgress {
  const ts = nowIso();
  const base = input || buildInitialLeadStageProgress();
  const nextCurrentStage: LeadRunStage | "complete" =
    status === "error" ? stage : status === "running" ? stage : base.currentStage;

  const stages: Record<LeadRunStage, LeadRunStageEntry> = {
    ...base.stages,
    [stage]: {
      status,
      updatedAt: ts,
      detail,
    },
  };

  const completeStages = (Object.keys(stages) as LeadRunStage[]).every((candidate) => {
    const value = stages[candidate].status;
    return value === "complete" || value === "skipped";
  });

  return {
    currentStage: completeStages ? "complete" : nextCurrentStage,
    updatedAt: ts,
    stages,
  };
}

