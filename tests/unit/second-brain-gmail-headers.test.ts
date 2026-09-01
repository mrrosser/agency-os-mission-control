import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google/tokens", () => ({ callGoogleAPI: vi.fn() }));

import { sendEmail } from "@/lib/google/gmail";
import { callGoogleAPI } from "@/lib/google/tokens";

const callGoogleApiMock = vi.mocked(callGoogleAPI);

describe("Gmail custom headers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callGoogleApiMock.mockResolvedValue({ id: "message-1", threadId: "thread-1" });
  });

  it("includes deterministic second-brain idempotency headers", async () => {
    await sendEmail("token", {
      to: ["ops@example.com"],
      subject: "Review",
      body: "Review body",
      headers: {
        "Message-ID": "<second-brain-abc@mission-control.local>",
        "X-Second-Brain-Idempotency-Key": "digest:user:date",
      },
    });
    const options = callGoogleApiMock.mock.calls[0][2] as RequestInit;
    const raw = JSON.parse(String(options.body)).raw as string;
    const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(normalized, "base64").toString("utf8");
    expect(decoded).toContain("Message-ID: <second-brain-abc@mission-control.local>");
    expect(decoded).toContain("X-Second-Brain-Idempotency-Key: digest:user:date");
  });

  it("rejects header injection", async () => {
    await expect(sendEmail("token", {
      to: ["ops@example.com"],
      subject: "Review",
      body: "Review body",
      headers: { "X-Test": "safe\r\nBcc: attacker@example.com" },
    })).rejects.toThrow("Invalid custom email header");
  });
});
