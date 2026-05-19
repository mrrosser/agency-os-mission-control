import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/agents/repo-improvement/review/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { recordRepoImprovementReview } from "@/lib/repo-improvement";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/api/idempotency", () => ({
  getIdempotencyKey: vi.fn(),
  withIdempotency: vi.fn(),
}));

vi.mock("@/lib/repo-improvement", () => ({
  recordRepoImprovementReview: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getIdempotencyKeyMock = vi.mocked(getIdempotencyKey);
const withIdempotencyMock = vi.mocked(withIdempotency);
const recordRepoImprovementReviewMock = vi.mocked(recordRepoImprovementReview);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("agents repo-improvement review route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    requireAuthMock.mockResolvedValue({
      uid: "user-1",
      email: "ops@example.com",
    } as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    getIdempotencyKeyMock.mockReturnValue("repo-review-1");
    withIdempotencyMock.mockImplementation(async (_params, executor) => ({
      data: await executor(),
      replayed: false,
    }));
    recordRepoImprovementReviewMock.mockResolvedValue({
      review_id: "run-1::agency-os-mission-control",
      decision: "approve",
      reason_code: "critical-runtime-fix",
      reviewer: "ops@example.com",
      review_ledger_path:
        "C:\\CTO Projects\\CodexSkills\\docs\\reports\\repo-improvement-review-ledger.json",
      morning_review_schema_path:
        "C:\\CTO Projects\\CodexSkills\\docs\\reports\\repo-improvement-morning-review-schema-latest.json",
      metrics_json_report_path:
        "C:\\CTO Projects\\CodexSkills\\docs\\reports\\repo-improvement-metrics-latest.json",
      training_dataset_path:
        "C:\\CTO Projects\\CodexSkills\\docs\\reports\\repo-improvement-training-dataset-latest.json",
      updated_entry: {
        review_id: "run-1::agency-os-mission-control",
      },
      pending_review_count: 0,
    });
  });

  it("records a repo-improvement review decision", async () => {
    const request = new Request(
      "http://localhost/api/agents/repo-improvement/review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId: "run-1::agency-os-mission-control",
          decision: "approve",
          reasonCode: "critical-runtime-fix",
          notes: "Approved bounded runtime fix.",
        }),
      }
    );

    const response = await POST(
      request as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.review_id).toBe("run-1::agency-os-mission-control");
    expect(payload.decision).toBe("approve");
    expect(recordRepoImprovementReviewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewId: "run-1::agency-os-mission-control",
        decision: "approve",
        reasonCode: "critical-runtime-fix",
      }),
      expect.objectContaining({
        reviewer: "ops@example.com",
      })
    );
  });

  it("rejects invalid payloads", async () => {
    const request = new Request(
      "http://localhost/api/agents/repo-improvement/review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId: "",
          decision: "approve",
        }),
      }
    );

    const response = await POST(
      request as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(String(payload.error || "")).toContain("Invalid payload");
  });

  it("enforces the optional review allowlist", async () => {
    process.env.REPO_IMPROVEMENT_REVIEW_ALLOWED_UIDS = "admin-1,admin-2";

    const request = new Request(
      "http://localhost/api/agents/repo-improvement/review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId: "run-1::agency-os-mission-control",
          decision: "approve",
          reasonCode: "critical-runtime-fix",
        }),
      }
    );

    const response = await POST(
      request as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe("Forbidden");
  });
});
