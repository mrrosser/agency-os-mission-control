import { beforeEach, describe, expect, it, vi } from "vitest";
import { getInboxMessages } from "@/lib/google/gmail";

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("getInboxMessages", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("fetches message metadata (not full bodies) for the inbox list", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);

      if (u.includes("/users/me/messages?")) {
        return new Response(
          JSON.stringify({
            messages: [
              { id: "m1", threadId: "t1" },
              { id: "m2", threadId: "t2" },
            ],
            nextPageToken: "next",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (u.includes("/users/me/messages/m1") || u.includes("/users/me/messages/m2")) {
        return new Response(
          JSON.stringify({
            id: u.includes("/m1") ? "m1" : "m2",
            threadId: u.includes("/m1") ? "t1" : "t2",
            snippet: "Hello",
            internalDate: String(Date.now()),
            payload: {
              headers: [
                { name: "From", value: "sender@example.com" },
                { name: "To", value: "me@example.com" },
                { name: "Subject", value: "Test" },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } });
    });

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const result = await getInboxMessages("token", 20, undefined, log);

    expect(result.nextPageToken).toBe("next");
    expect(result.messages).toHaveLength(2);

    const listCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/users/me/messages?"))?.[0];
    expect(String(listCall)).toContain("labelIds=INBOX");
    expect(String(listCall)).toContain("maxResults=20");
    expect(String(listCall)).toContain("fields=messages");

    const detailCalls = fetchMock.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.includes("/users/me/messages/m"));

    expect(detailCalls.length).toBe(2);
    for (const callUrl of detailCalls) {
      expect(callUrl).toContain("format=metadata");
      expect(callUrl).toContain("metadataHeaders=From");
      expect(callUrl).toContain("metadataHeaders=To");
      expect(callUrl).toContain("metadataHeaders=Subject");
      expect(callUrl).toContain("fields=id");
    }
  });

  it("returns an empty list when Gmail returns no messages", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    (globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const result = await getInboxMessages("token", 10, undefined, log);
    expect(result.messages).toEqual([]);
  });
});
