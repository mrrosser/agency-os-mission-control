import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as POST_DIGEST } from "@/app/api/agents/second-brain/notifications/digest/route";
import { POST as POST_URGENT } from "@/app/api/agents/second-brain/notifications/urgent/route";
import { withIdempotency } from "@/lib/api/idempotency";
import { assertSecondBrainOperatorUid, authorizeSecondBrainService } from "@/lib/second-brain-auth";
import { dispatchSecondBrainDigest, dispatchSecondBrainUrgent } from "@/lib/second-brain-email";

vi.mock("@/lib/api/idempotency", () => ({ withIdempotency: vi.fn() }));
vi.mock("@/lib/second-brain-auth", () => ({
  assertSecondBrainOperatorUid: vi.fn(),
  authorizeSecondBrainService: vi.fn(),
}));
vi.mock("@/lib/second-brain-email", () => ({ dispatchSecondBrainDigest: vi.fn(), dispatchSecondBrainUrgent: vi.fn() }));

const withIdempotencyMock = vi.mocked(withIdempotency);
const assertOperatorUidMock = vi.mocked(assertSecondBrainOperatorUid);
const digestMock = vi.mocked(dispatchSecondBrainDigest);
const urgentMock = vi.mocked(dispatchSecondBrainUrgent);

function context() {
  return { params: Promise.resolve({}) };
}

describe("second-brain notification routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertOperatorUidMock.mockReturnValue("operator-1");
    withIdempotencyMock.mockImplementation(async (_params, executor) => ({ data: await executor(), replayed: false }));
    digestMock.mockResolvedValue({ status: "dry-run", recipientCount: 1, candidateCount: 2, messageIds: [] });
    urgentMock.mockResolvedValue({ status: "dry-run", recipientCount: 1, messageIds: [] });
  });

  it("requires service authorization before a daily digest", async () => {
    const request = new Request("http://localhost/api/agents/second-brain/notifications/digest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uid: "operator-1", digestDate: "2026-08-30", dryRun: true }),
    });
    const response = await POST_DIGEST(request as Parameters<typeof POST_DIGEST>[0], context() as Parameters<typeof POST_DIGEST>[1]);
    expect(response.status).toBe(200);
    expect(authorizeSecondBrainService).toHaveBeenCalled();
    expect(assertOperatorUidMock).toHaveBeenCalledWith("operator-1");
    expect(digestMock).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      request: expect.objectContaining({ uid: "operator-1" }),
    }));
  });

  it("validates and dispatches an urgent rollback alert", async () => {
    const request = new Request("http://localhost/api/agents/second-brain/notifications/urgent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uid: "operator-1",
        eventId: "rollback-1",
        eventType: "automatic-rollback",
        severity: "critical",
        summary: "Restored the prior version.",
        detectedAt: "2026-08-30T12:00:00Z",
        dryRun: true,
      }),
    });
    const response = await POST_URGENT(request as Parameters<typeof POST_URGENT>[0], context() as Parameters<typeof POST_URGENT>[1]);
    expect(response.status).toBe(200);
    expect(assertOperatorUidMock).toHaveBeenCalledWith("operator-1");
    expect(urgentMock).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ uid: "operator-1" }),
    }));
  });
});
