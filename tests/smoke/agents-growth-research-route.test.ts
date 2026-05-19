import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/agents/growth-research/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getGrowthResearchSnapshot } from "@/lib/growth-research";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/growth-research", () => ({
  getGrowthResearchSnapshot: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getGrowthResearchSnapshotMock = vi.mocked(getGrowthResearchSnapshot);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("agents growth-research route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({
      uid: "user-1",
    } as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    getGrowthResearchSnapshotMock.mockResolvedValue({
      generatedAt: "2026-04-06T12:00:00.000Z",
      status: "available",
      detail: "Growth-research inbox and review recorder are available.",
      paths: {
        reportRoot: "C:\\CTO Projects\\CodexSkills\\docs\\reports",
        scriptRoot:
          "C:\\CTO Projects\\CodexSkills\\.codex\\skills\\automation-control-plane\\scripts",
        reviewLedgerPath:
          "C:\\CTO Projects\\CodexSkills\\docs\\reports\\growth-research-review-ledger.json",
        weeklyReviewSchemaPath:
          "C:\\CTO Projects\\CodexSkills\\docs\\reports\\growth-research-weekly-review-schema-latest.json",
        metricsJsonPath:
          "C:\\CTO Projects\\CodexSkills\\docs\\reports\\growth-research-metrics-latest.json",
        trainingDatasetPath:
          "C:\\CTO Projects\\CodexSkills\\docs\\reports\\growth-research-training-dataset-latest.json",
        reviewScriptPath:
          "C:\\CTO Projects\\CodexSkills\\.codex\\skills\\automation-control-plane\\scripts\\record_growth_research_review.ps1",
      },
      reviewScriptAvailable: true,
      reviewSchema: {
        summary: {
          generated_at: "2026-04-06T12:00:00.000Z",
          pending_review_count: 1,
          metrics_json_report_path:
            "C:\\CTO Projects\\CodexSkills\\docs\\reports\\growth-research-metrics-latest.json",
          training_dataset_path:
            "C:\\CTO Projects\\CodexSkills\\docs\\reports\\growth-research-training-dataset-latest.json",
        },
        schema: {
          schema_version: "2026-04-06",
          decision_labels: [
            {
              id: "approve",
              description: "Approve",
              counts_as_accept: true,
              requires_reason_code: true,
            },
          ],
          reason_codes: [
            {
              id: "strong-signal-win",
              decisions: ["approve"],
              description: "Objective signal supports approval.",
            },
          ],
          outcome_labels: [
            { id: "pending", description: "Pending" },
            { id: "stable", description: "Stable" },
            { id: "reverted", description: "Reverted" },
            { id: "superseded", description: "Superseded" },
          ],
          required_fields: [
            "review_id",
            "repo_or_domain",
            "run_id",
            "decision",
            "reason_code",
            "reviewer",
            "decision_recorded_at",
          ],
        },
        inbox_items: [],
      },
      metrics: {
        summary: {
          generated_at: "2026-04-06T12:00:00.000Z",
          review_entry_count: 4,
          pending_review_count: 1,
          reviewed_count: 3,
        },
        rates: {
          approval_rate: 0.67,
          defer_rate: 0.33,
          needs_human_rate: 0,
          stable_rate: 1,
          high_confidence_rate: 0.75,
          average_objective_score: 79.5,
          average_priority_score: 84.25,
          time_to_accept_hours: 5.5,
        },
        promotion_policy: null,
        promotion_candidates: [],
        per_target: [],
      },
    });
  });

  it("returns growth-research snapshot payload", async () => {
    const request = new Request("http://localhost/api/agents/growth-research", {
      method: "GET",
    });

    const response = await GET(
      request as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.status).toBe("available");
    expect(payload.reviewScriptAvailable).toBe(true);
    expect(payload.reviewSchema.summary.pending_review_count).toBe(1);
    expect(payload.metrics.rates.average_priority_score).toBe(84.25);
  });
});
