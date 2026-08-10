export type ApplicationApplicantTrack =
  | "marcus_artist"
  | "rosser_gallery"
  | "rt_solutions"
  | "marcus_personal_job"
  | "needs_owner_assignment";

export type ApplicationReviewDecisionKind =
  | "approve_for_preparation"
  | "request_changes"
  | "defer"
  | "reject";

export type ApplicationReviewStatus =
  | "needs_review"
  | "approved_for_preparation"
  | "changes_requested"
  | "deferred"
  | "rejected"
  | "stale"
  | "expired";

export type ArtistOpportunityLane =
  | "artist_call"
  | "grant"
  | "residency"
  | "fellowship"
  | "workshop"
  | "speaking"
  | "contract"
  | "job"
  | "education"
  | "governance"
  | "collector"
  | "gallery";

export interface ApplicationDeskWorkspace {
  id: string;
  slug: string;
  name: string;
  status: "active" | "archived";
  defaultProfileVersion: string;
}

export interface OpportunityRequirement {
  key: string;
  label: string;
  required: boolean;
}

export interface ApplicationReviewOpportunity {
  id: string;
  workspaceId: string;
  lane: ArtistOpportunityLane;
  sourceDomain: string;
  title: string;
  organization: string;
  summary: string;
  url: string;
  location: string;
  deadline: string | null;
  feeUsd: number | null;
  requirements: OpportunityRequirement[];
  sourceOfficial?: boolean;
  fitScore: number;
  fitLabel: string;
  rationale: string[];
  missingRequirementKeys: string[];
  executionPolicy: "auto_run" | "review_required" | "blocked";
  requirementsVerified: boolean;
  applicationReady: boolean;
  workflowStatus: "ready" | "review_required" | "blocked";
}

export interface ApplicationReviewItem {
  schemaVersion: "artist-manager.application-review-item.v1";
  reviewId: string;
  workspaceId: string;
  opportunityId: string;
  applicantTrack: ApplicationApplicantTrack;
  reviewRoundId: string;
  actionFingerprint: string;
  artifactFingerprint: string;
  stateRef: string;
  status: ApplicationReviewStatus;
  opportunity: ApplicationReviewOpportunity;
  approvalScope: string[];
  excludedScope: string[];
  preparationBlockers: string[];
  reviewBlockers: string[];
  approvalEligible: boolean;
  driftReasons: string[];
  latestDecisionId: string | null;
  latestDecisionKind: ApplicationReviewDecisionKind | null;
  decisionNote: string;
  deferUntil: string | null;
  decidedAt: string | null;
}

export const PREPARED_APPLICATION_WORKSPACE_ID = "ws_cd43331c4b1648d0";

export const RT_SOLUTIONS_APPLICATION_WORKSPACE_ID = "ws_ee1735c095774325";

export function canRecordApplicationDeskDecisions(workspaceId: string): boolean {
  return workspaceId !== RT_SOLUTIONS_APPLICATION_WORKSPACE_ID;
}

export function isApplicationDeskWorkspace(
  workspace: ApplicationDeskWorkspace,
): boolean {
  if (workspace.status !== "active") return false;
  return (
    workspace.defaultProfileVersion.startsWith("artist-manager-default@") ||
    (workspace.id === RT_SOLUTIONS_APPLICATION_WORKSPACE_ID && workspace.slug === "rt-solutions")
  );
}

export function normalizeApplicationDeskWorkspaces(
  value: unknown,
): ApplicationDeskWorkspace[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const workspaces: ApplicationDeskWorkspace[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const slug = typeof record.slug === "string" ? record.slug.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const status = record.status;
    const defaultProfileVersion =
      typeof record.defaultProfileVersion === "string"
        ? record.defaultProfileVersion.trim()
        : "";
    if (
      !/^[A-Za-z0-9_-]{1,120}$/.test(id) ||
      !/^[a-z0-9-]{1,80}$/.test(slug) ||
      !name ||
      name.length > 120 ||
      (status !== "active" && status !== "archived") ||
      defaultProfileVersion.length > 120 ||
      seen.has(id)
    ) {
      continue;
    }
    seen.add(id);
    workspaces.push({ id, slug, name, status, defaultProfileVersion });
  }
  return workspaces;
}
