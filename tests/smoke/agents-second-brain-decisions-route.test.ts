import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/agents/second-brain/decisions/route";
import { ApiError } from "@/lib/api/handler";
import {
  assertSecondBrainOperatorUid,
  authorizeSecondBrainService,
} from "@/lib/second-brain-auth";
import { listSecondBrainDecisions } from "@/lib/second-brain";

vi.mock("@/lib/second-brain-auth", () => ({
  assertSecondBrainOperatorUid: vi.fn(),
  authorizeSecondBrainService: vi.fn(),
}));
vi.mock("@/lib/second-brain", () => ({ listSecondBrainDecisions: vi.fn() }));

const assertOperatorUidMock = vi.mocked(assertSecondBrainOperatorUid);
const listDecisionsMock = vi.mocked(listSecondBrainDecisions);

function context() {
  return { params: Promise.resolve({}) };
}

describe("second-brain decisions route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertOperatorUidMock.mockImplementation((uid) => {
      if (uid !== "operator-1") throw new ApiError(403, "Second-brain operator UID mismatch");
      return "operator-1";
    });
    listDecisionsMock.mockResolvedValue({ decisions: [], nextCursor: null });
  });

  it("binds decision reads to the configured operator UID", async () => {
    const request = new Request(
      "http://localhost/api/agents/second-brain/decisions?uid=operator-1&limit=25"
    );
    const response = await GET(
      request as Parameters<typeof GET>[0],
      context() as Parameters<typeof GET>[1]
    );

    expect(response.status).toBe(200);
    expect(authorizeSecondBrainService).toHaveBeenCalled();
    expect(assertOperatorUidMock).toHaveBeenCalledWith("operator-1");
    expect(listDecisionsMock).toHaveBeenCalledWith({
      uid: "operator-1",
      cursor: undefined,
      after: undefined,
      limit: 25,
    });
  });

  it("rejects a service request for another operator subtree", async () => {
    const request = new Request(
      "http://localhost/api/agents/second-brain/decisions?uid=other-operator"
    );
    const response = await GET(
      request as Parameters<typeof GET>[0],
      context() as Parameters<typeof GET>[1]
    );

    expect(response.status).toBe(403);
    expect(listDecisionsMock).not.toHaveBeenCalled();
  });
});
