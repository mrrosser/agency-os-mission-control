import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/social/onboarding/status/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getSocialOnboardingStatus, setSocialOnboardingStepCompletion } from "@/lib/social/onboarding";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/social/onboarding", () => ({
  SOCIAL_ONBOARDING_STEP_IDS: [
    "google_workspace_connected",
    "approval_base_url_configured",
    "approval_webhook_configured",
    "worker_auth_configured",
    "smauto_connector_configured",
    "smauto_auth_configured",
    "dispatch_status_notifications_configured",
    "social_accounts_selected",
  ],
  getSocialOnboardingStatus: vi.fn(),
  setSocialOnboardingStepCompletion: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getStatusMock = vi.mocked(getSocialOnboardingStatus);
const setStepCompletionMock = vi.mocked(setSocialOnboardingStepCompletion);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("social onboarding status route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as Awaited<ReturnType<typeof requireFirebaseAuth>>);
  });

  it("returns onboarding status for authenticated users", async () => {
    getStatusMock.mockResolvedValue({
      ready: false,
      completedStepIds: [],
      steps: [
        {
          id: "google_workspace_connected",
          label: "Connect Google Workspace",
          detail: "pending",
          state: "needs_action",
          actionLabel: "Open Integrations",
          actionHref: "/dashboard/integrations",
          canToggle: false,
        },
      ],
      pipeline: {
        drafts: { pendingApproval: 1, approved: 0, rejected: 0, failed: 0 },
        dispatch: {
          pendingExternalTool: 2,
          dispatched: 0,
          failed: 0,
          lastSuccessAt: null,
          lastFailureAt: null,
        },
      },
      diagnostics: {
        status: "warn",
        generatedAt: "2026-02-26T00:00:00.000Z",
        checks: [],
      },
    });

    const req = new Request("http://localhost/api/social/onboarding/status", {
      method: "GET",
      headers: { Authorization: "Bearer token" },
    });

    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.ready).toBe(false);
    expect(getStatusMock).toHaveBeenCalledWith("user-1");
  });

  it("updates manual step completion", async () => {
    setStepCompletionMock.mockResolvedValue(["social_accounts_selected"]);

    const req = new Request("http://localhost/api/social/onboarding/status", {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        stepId: "social_accounts_selected",
        completed: true,
      }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(setStepCompletionMock).toHaveBeenCalledWith({
      uid: "user-1",
      stepId: "social_accounts_selected",
      completed: true,
    });
  });
});
