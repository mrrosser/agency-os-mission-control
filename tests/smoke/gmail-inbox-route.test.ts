import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/gmail/inbox/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { getInboxMessages } from "@/lib/google/gmail";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/google/oauth", () => ({
  getAccessTokenForUser: vi.fn(),
}));

vi.mock("@/lib/google/gmail", () => ({
  getInboxMessages: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getAccessTokenMock = vi.mocked(getAccessTokenForUser);
const getInboxMessagesMock = vi.mocked(getInboxMessages);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("gmail inbox route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as Awaited<ReturnType<typeof requireFirebaseAuth>>);
    getAccessTokenMock.mockResolvedValue("access-token");
    getInboxMessagesMock.mockResolvedValue({
      nextPageToken: "next-page",
      messages: [
        {
          id: "m1",
          threadId: "t1",
          snippet: "Interested in pricing. Can we schedule a call?",
          payload: {
            headers: [
              { name: "Subject", value: "Re: proposal" },
              { name: "From", value: "lead@example.com" },
            ],
          },
        },
        {
          id: "m2",
          threadId: "t2",
          snippet: "Please remove me from this list.",
          payload: {
            headers: [
              { name: "Subject", value: "Unsubscribe" },
              { name: "From", value: "contact@example.com" },
            ],
          },
        },
      ],
    });
  });

  it("returns triage scores and aggregate triage summary", async () => {
    const request = new Request("http://localhost/api/gmail/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxResults: 10 }),
    });

    const response = await POST(
      request as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.nextPageToken).toBe("next-page");
    expect(Array.isArray(payload.messages)).toBe(true);
    expect(payload.messages).toHaveLength(2);
    expect(payload.messages[0]?.triage?.bucket).toBeDefined();
    expect(payload.messages[0]?.triage?.rubricVersion).toBe("v2");
    expect(payload.messages[0]?.triage?.sponsorBucket).toBeDefined();
    expect(payload.messages[0]?.triage?.dimensions).toBeDefined();
    expect(typeof payload.messages[0]?.triage?.lowConfidence).toBe("boolean");
    expect(payload.messages[0]?.triage?.suggestedAction).toBeDefined();
    expect(payload.triage?.rubricVersion).toBe("v2");
    expect(payload.triage?.total).toBe(2);
    expect(payload.triage?.bucketCounts?.hot + payload.triage?.bucketCounts?.follow_up + payload.triage?.bucketCounts?.nurture + payload.triage?.bucketCounts?.ignore).toBe(2);
    expect(
      payload.triage?.sponsorBucketCounts?.exceptional +
        payload.triage?.sponsorBucketCounts?.high +
        payload.triage?.sponsorBucketCounts?.medium +
        payload.triage?.sponsorBucketCounts?.low +
        payload.triage?.sponsorBucketCounts?.spam
    ).toBe(2);
    expect(typeof payload.triage?.lowConfidenceCount).toBe("number");
    expect(typeof payload.triage?.averageConfidence).toBe("number");
  });
});
