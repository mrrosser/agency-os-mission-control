import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as send } from "@/app/api/gmail/send/route";
import { POST as draft } from "@/app/api/gmail/draft/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { resolveLeadRunOrgId } from "@/lib/lead-runs/quotas";
import { findDncMatch } from "@/lib/outreach/dnc";
import { recordLeadActionReceipt } from "@/lib/lead-runs/receipts";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/lead-runs/quotas", () => ({
  resolveLeadRunOrgId: vi.fn(),
}));

vi.mock("@/lib/outreach/dnc", () => ({
  findDncMatch: vi.fn(),
}));

vi.mock("@/lib/lead-runs/receipts", () => ({
  recordLeadActionReceipt: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const resolveOrgMock = vi.mocked(resolveLeadRunOrgId);
const findDncMock = vi.mocked(findDncMatch);
const receiptMock = vi.mocked(recordLeadActionReceipt);

function createContext(params: Record<string, string> = {}) {
  return { params: Promise.resolve(params) };
}

describe("gmail routes - DNC enforcement", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
    resolveOrgMock.mockResolvedValue("org-1");
    findDncMock.mockImplementation(async (args: unknown) => {
      const email = (args as { email?: string | null }).email;
      if (!email) return null;
      if (email !== "blocked@example.com") return null;
      return {
        entryId: "dnc1",
        type: "email",
        value: "blocked@example.com",
        normalized: "blocked@example.com",
        createdBy: "user-1",
      } as unknown as Awaited<ReturnType<typeof findDncMatch>>;
    });
  });

  it("blocks send when recipient is on DNC list and records receipt", async () => {
    const req = new Request("http://localhost/api/gmail/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dryRun: true,
        runId: "run-1",
        leadDocId: "lead-1",
        receiptActionId: "gmail.outreach",
        email: {
          to: ["blocked@example.com"],
          subject: "Hello",
          body: "<p>Hi</p>",
          isHtml: true,
        },
      }),
    });

    const res = await send(
      req as unknown as Parameters<typeof send>[0],
      createContext() as unknown as Parameters<typeof send>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(String(data.error)).toMatch(/Do Not Contact/i);
    expect(receiptMock).toHaveBeenCalledOnce();
    const input = (receiptMock.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(input.status).toBe("skipped");
  });

  it("blocks send when cc recipient is on DNC list and records receipt", async () => {
    const req = new Request("http://localhost/api/gmail/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dryRun: true,
        runId: "run-1",
        leadDocId: "lead-1",
        receiptActionId: "gmail.outreach",
        email: {
          to: ["ok@example.com"],
          cc: ["blocked@example.com"],
          subject: "Hello",
          body: "<p>Hi</p>",
          isHtml: true,
        },
      }),
    });

    const res = await send(
      req as unknown as Parameters<typeof send>[0],
      createContext() as unknown as Parameters<typeof send>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(String(data.error)).toMatch(/Do Not Contact/i);
    expect(receiptMock).toHaveBeenCalledOnce();
    const input = (receiptMock.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(input.status).toBe("skipped");
    expect(input.data).toMatchObject({ blockedRecipient: "blocked@example.com" });
  });

  it("blocks draft when recipient is on DNC list and records receipt", async () => {
    const req = new Request("http://localhost/api/gmail/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dryRun: true,
        runId: "run-1",
        leadDocId: "lead-1",
        receiptActionId: "gmail.outreach_draft",
        email: {
          to: ["blocked@example.com"],
          subject: "Hello",
          body: "<p>Hi</p>",
          isHtml: true,
        },
      }),
    });

    const res = await draft(
      req as unknown as Parameters<typeof draft>[0],
      createContext() as unknown as Parameters<typeof draft>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(String(data.error)).toMatch(/Do Not Contact/i);
    expect(receiptMock).toHaveBeenCalledOnce();
    const input = (receiptMock.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(input.status).toBe("skipped");
  });

  it("blocks draft when bcc recipient is on DNC list and records receipt", async () => {
    const req = new Request("http://localhost/api/gmail/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dryRun: true,
        runId: "run-1",
        leadDocId: "lead-1",
        receiptActionId: "gmail.outreach_draft",
        email: {
          to: ["ok@example.com"],
          bcc: ["blocked@example.com"],
          subject: "Hello",
          body: "<p>Hi</p>",
          isHtml: true,
        },
      }),
    });

    const res = await draft(
      req as unknown as Parameters<typeof draft>[0],
      createContext() as unknown as Parameters<typeof draft>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(String(data.error)).toMatch(/Do Not Contact/i);
    expect(receiptMock).toHaveBeenCalledOnce();
    const input = (receiptMock.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(input.status).toBe("skipped");
    expect(input.data).toMatchObject({ blockedRecipient: "blocked@example.com" });
  });
});
