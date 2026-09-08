import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/agents/second-brain/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import {
  assertSecondBrainReviewerAllowed,
  requireSecondBrainOperatorUid,
} from "@/lib/second-brain-auth";
import { getSecondBrainSnapshot } from "@/lib/second-brain";

vi.mock("@/lib/api/auth", () => ({ requireFirebaseAuth: vi.fn() }));
vi.mock("@/lib/second-brain-auth", () => ({
  assertSecondBrainReviewerAllowed: vi.fn(),
  requireSecondBrainOperatorUid: vi.fn(),
}));
vi.mock("@/lib/second-brain", () => ({ getSecondBrainSnapshot: vi.fn() }));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const requireOperatorUidMock = vi.mocked(requireSecondBrainOperatorUid);
const getSnapshotMock = vi.mocked(getSecondBrainSnapshot);

function context() {
  return { params: Promise.resolve({}) };
}

describe("second-brain snapshot route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue({
      uid: "reviewer-2",
      email: "reviewer@example.com",
    } as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    requireOperatorUidMock.mockReturnValue("operator-1");
    getSnapshotMock.mockResolvedValue({
      generatedAt: "2026-09-01T12:00:00Z",
      health: null,
      candidates: [],
      decisions: [],
      notifications: [],
    });
  });

  it("reads the configured operator subtree for an allowlisted reviewer", async () => {
    const request = new Request("http://localhost/api/agents/second-brain");
    const response = await GET(
      request as Parameters<typeof GET>[0],
      context() as Parameters<typeof GET>[1]
    );

    expect(response.status).toBe(200);
    expect(assertSecondBrainReviewerAllowed).toHaveBeenCalledWith({
      uid: "reviewer-2",
      email: "reviewer@example.com",
    });
    expect(requireOperatorUidMock).toHaveBeenCalled();
    expect(getSnapshotMock).toHaveBeenCalledWith("operator-1");
  });
});
