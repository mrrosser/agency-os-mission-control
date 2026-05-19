import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/agents/growth-research/review/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { recordGrowthResearchReview } from "@/lib/growth-research";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/api/idempotency", () => ({
  getIdempotencyKey: vi.fn(),
  withIdempotency: vi.fn(),
}));

vi.mock("@/lib/growth-research", () => ({
  recordGrowthResearchReview: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getIdempotencyKeyMock = vi.mocked(getIdempotencyKey);
const withIdempotencyMock = vi.mocked(withIdempotency);
const recordGrowthResearchReviewMock = vi.mocked(recordGrowthResearchReview);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("agents growth-research review route", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    requireAuthMock.mockResolvedValue({
      uid: "user-1",
      email: "ops@example.com",
    } as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    getIdempotencyKeyMock.mockReturnValue("growth-review-1");
    withIdempotencyMock.mockImplementation(async (_params, executor) => ({
      data: await executor(),
      replayed: false,
    }));
    recordGrowthResearchReviewMock.mockResolvedValue({
      review_id: "run-1::redblue",
      decision: "approve",
      reason_code: "strong-signal-win",
      reviewer: "ops@example.com",
      review_ledger_path:
        "C:\\CTO Projects\\CodexSkills\\docs\\reports\\growth-research-review-ledger.json",
      weekly_review_schema_path:
        "C:\\CTO Projects\\CodexSkills\\docs\\reports\\growth-research-weekly-review-schema-latest.json",
      metrics_json_report_path:
        "C:\\CTO Projects\\CodexSkills\\docs\\reports\\growth-research-metrics-latest.json",
      training_dataset_path:
        "C:\\CTO Projects\\CodexSkills\\docs\\reports\\growth-research-training-dataset-latest.json",
      updated_entry: {
        review_id: "run-1::redblue",
      },
      pending_review_count: 0,
    });
  });

  it("records a growth-research review decision", async () => {
    const request = new Request(
      "http://localhost/api/agents/growth-research/review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId: "run-1::redblue",
          decision: "approve",
          reasonCode: "strong-signal-win",
          notes: "Approve the security-assurance recommendation.",
        }),
      }
    );

    const response = await POST(
      request as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.review_id).toBe("run-1::redblue");
    expect(payload.decision).toBe("approve");
    expect(recordGrowthResearchReviewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewId: "run-1::redblue",
        decision: "approve",
        reasonCode: "strong-signal-win",
      }),
      expect.objectContaining({
        reviewer: "ops@example.com",
      })
    );
  });

  it("rejects invalid payloads", async () => {
    const request = new Request(
      "http://localhost/api/agents/growth-research/review",
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
    process.env.GROWTH_RESEARCH_REVIEW_ALLOWED_UIDS = "admin-1,admin-2";

    const request = new Request(
      "http://localhost/api/agents/growth-research/review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId: "run-1::redblue",
          decision: "approve",
          reasonCode: "strong-signal-win",
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
