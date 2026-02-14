import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/lead-runs/alerts/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import {
  acknowledgeLeadRunAlert,
  escalateOpenLeadRunAlerts,
  listLeadRunAlerts,
  resolveLeadRunOrgId,
} from "@/lib/lead-runs/quotas";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/lead-runs/quotas", () => ({
  acknowledgeLeadRunAlert: vi.fn(async () => undefined),
  escalateOpenLeadRunAlerts: vi.fn(async () => ({ escalated: 0 })),
  listLeadRunAlerts: vi.fn(async () => []),
  resolveLeadRunOrgId: vi.fn(async () => "org-1"),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const resolveOrgMock = vi.mocked(resolveLeadRunOrgId);
const listAlertsMock = vi.mocked(listLeadRunAlerts);
const escalateAlertsMock = vi.mocked(escalateOpenLeadRunAlerts);
const acknowledgeAlertMock = vi.mocked(acknowledgeLeadRunAlert);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("lead run alerts route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
    resolveOrgMock.mockResolvedValue("org-1");
    escalateAlertsMock.mockResolvedValue({ escalated: 0 });
  });

  it("lists alerts for current org", async () => {
    listAlertsMock.mockResolvedValue([
      {
        alertId: "org-1_run-1",
        orgId: "org-1",
        runId: "run-1",
        uid: "user-1",
        severity: "error",
        title: "Lead run failures exceeded threshold",
        message: "One or more lead runs failed repeatedly.",
        failureStreak: 2,
        status: "open",
        acknowledgedBy: null,
        acknowledgedAt: null,
        createdAt: "2026-02-12T00:00:00.000Z",
      },
    ]);

    const req = new Request("http://localhost/api/lead-runs/alerts?limit=5", { method: "GET" });
    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(data.alerts)).toBe(true);
    expect(data.alerts[0].alertId).toBe("org-1_run-1");
    expect(listAlertsMock).toHaveBeenCalledWith("org-1", 5);
    expect(escalateAlertsMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", limit: 5 })
    );
  });

  it("acknowledges an alert", async () => {
    const req = new Request("http://localhost/api/lead-runs/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "acknowledge",
        alertId: "org-1_run-1",
      }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(acknowledgeAlertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        alertId: "org-1_run-1",
        uid: "user-1",
      })
    );
  });
});
