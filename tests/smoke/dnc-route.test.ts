import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST, DELETE } from "@/app/api/outreach/dnc/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { resolveLeadRunOrgId } from "@/lib/lead-runs/quotas";
import { deleteDncEntry, listDncEntries, normalizeDncValue, upsertDncEntry } from "@/lib/outreach/dnc";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/lead-runs/quotas", () => ({
  resolveLeadRunOrgId: vi.fn(),
}));

vi.mock("@/lib/outreach/dnc", () => ({
  deleteDncEntry: vi.fn(),
  listDncEntries: vi.fn(),
  normalizeDncValue: vi.fn(),
  upsertDncEntry: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const resolveOrgMock = vi.mocked(resolveLeadRunOrgId);
const listMock = vi.mocked(listDncEntries);
const upsertMock = vi.mocked(upsertDncEntry);
const deleteMock = vi.mocked(deleteDncEntry);
const normalizeMock = vi.mocked(normalizeDncValue);

function createContext(params: Record<string, string> = {}) {
  return { params: Promise.resolve(params) };
}

describe("DNC routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
    resolveOrgMock.mockResolvedValue("org-1");
    normalizeMock.mockImplementation((_type: unknown, value: string) => value.trim().toLowerCase());
  });

  it("lists entries", async () => {
    listMock.mockResolvedValue([
      {
        entryId: "e1",
        type: "email",
        value: "blocked@example.com",
        normalized: "blocked@example.com",
        reason: "unsubscribe",
        createdBy: "user-1",
      },
    ]);

    const req = new Request("http://localhost/api/outreach/dnc", { method: "GET" });
    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.orgId).toBe("org-1");
    expect(Array.isArray(data.entries)).toBe(true);
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].entryId).toBe("e1");
  });

  it("upserts an entry", async () => {
    upsertMock.mockResolvedValue({
      entryId: "e2",
      type: "domain",
      value: "example.com",
      normalized: "example.com",
      reason: null,
      createdBy: "user-1",
    });

    const req = new Request("http://localhost/api/outreach/dnc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "domain", value: "example.com" }),
    });
    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.orgId).toBe("org-1");
    expect(data.entry.entryId).toBe("e2");
    expect(upsertMock).toHaveBeenCalledOnce();
  });

  it("deletes an entry", async () => {
    deleteMock.mockResolvedValue(undefined);

    const req = new Request("http://localhost/api/outreach/dnc", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId: "e1" }),
    });
    const res = await DELETE(
      req as unknown as Parameters<typeof DELETE>[0],
      createContext() as unknown as Parameters<typeof DELETE>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(deleteMock).toHaveBeenCalledWith("org-1", "e1");
  });
});

