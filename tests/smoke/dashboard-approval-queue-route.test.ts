import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/dashboard/approval-queue/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { listApprovalQueueForUser } from "@/lib/lead-runs/approval-queue";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/lead-runs/approval-queue", () => ({
  listApprovalQueueForUser: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const listApprovalQueueMock = vi.mocked(listApprovalQueueForUser);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("dashboard approval queue route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    listApprovalQueueMock.mockResolvedValue({
      email: [
        {
          kind: "email",
          key: "k-1",
          runId: "run-1",
          leadDocId: "lead-1",
          companyName: "ACME",
          founderName: "Ava",
          leadEmail: "ava@acme.com",
          website: null,
          location: null,
          status: "complete",
          createdAt: "2026-03-09T10:00:00.000Z",
          updatedAt: "2026-03-09T10:05:00.000Z",
          actionId: "gmail.outreach_draft",
          queueLabel: "Outreach Draft",
          subject: "Quick question",
          recipients: ["ava@acme.com"],
          draftId: "draft-1",
          messageId: "msg-1",
          threadId: "thread-1",
        },
      ],
      calendar: [],
    });
  });

  it("returns the approval queue for the signed-in user", async () => {
    const request = new Request("http://localhost/api/dashboard/approval-queue?emailLimit=12&calendarLimit=6");

    const response = await GET(
      request as Parameters<typeof GET>[0],
      createContext() as Parameters<typeof GET>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(listApprovalQueueMock).toHaveBeenCalledWith("user-1", {
      emailLimit: 12,
      calendarLimit: 6,
    });
    expect(payload.email).toHaveLength(1);
    expect(payload.email[0].draftId).toBe("draft-1");
  });
});
