import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/agents/repo-improvement/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getRepoImprovementSnapshot } from "@/lib/repo-improvement";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/repo-improvement", () => ({
  getRepoImprovementSnapshot: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getRepoImprovementSnapshotMock = vi.mocked(getRepoImprovementSnapshot);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("agents repo-improvement route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({
      uid: "user-1",
    } as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    getRepoImprovementSnapshotMock.mockResolvedValue({
      generatedAt: "2026-04-03T12:00:00.000Z",
      status: "available",
      detail: "Repo-improvement inbox and review recorder are available.",
      paths: {
        reportRoot: "C:\\CTO Projects\\CodexSkills\\docs\\reports",
        scriptRoot:
          "C:\\CTO Projects\\CodexSkills\\.codex\\skills\\automation-control-plane\\scripts",
        reviewLedgerPath:
          "C:\\CTO Projects\\CodexSkills\\docs\\reports\\repo-improvement-review-ledger.json",
        morningReviewSchemaPath:
          "C:\\CTO Projects\\CodexSkills\\docs\\reports\\repo-improvement-morning-review-schema-latest.json",
        metricsJsonPath:
          "C:\\CTO Projects\\CodexSkills\\docs\\reports\\repo-improvement-metrics-latest.json",
        trainingDatasetPath:
          "C:\\CTO Projects\\CodexSkills\\docs\\reports\\repo-improvement-training-dataset-latest.json",
        reviewScriptPath:
          "C:\\CTO Projects\\CodexSkills\\.codex\\skills\\automation-control-plane\\scripts\\record_repo_improvement_review.ps1",
      },
      reviewScriptAvailable: true,
      reviewSchema: {
        summary: {
          generated_at: "2026-04-03T12:00:00.000Z",
          pending_review_count: 1,
          metrics_json_report_path:
            "C:\\CTO Projects\\CodexSkills\\docs\\reports\\repo-improvement-metrics-latest.json",
          training_dataset_path:
            "C:\\CTO Projects\\CodexSkills\\docs\\reports\\repo-improvement-training-dataset-latest.json",
        },
        schema: {
          schema_version: "2026-04-02",
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
              id: "critical-runtime-fix",
              decisions: ["approve"],
              description: "Keeps the app running.",
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
            "repo",
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
          generated_at: "2026-04-03T12:00:00.000Z",
          review_entry_count: 4,
          pending_review_count: 1,
          reviewed_count: 3,
        },
        rates: {
          proposal_rate: 1,
          keep_rate: 0.5,
          morning_approval_rate: 0.75,
          revert_rate: 0,
          verifier_pass_rate: 0.9,
          repeat_failure_rate: 0.25,
          time_to_accept_hours: 2.1,
        },
        promotion_policy: null,
        promotion_candidates: [],
        per_repo: [],
      },
    });
  });

  it("returns repo-improvement snapshot payload", async () => {
    const request = new Request("http://localhost/api/agents/repo-improvement", {
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
    expect(payload.metrics.rates.verifier_pass_rate).toBe(0.9);
  });
});
