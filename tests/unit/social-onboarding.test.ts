import { describe, expect, it } from "vitest";
import { buildSocialOnboardingSteps, type SocialOnboardingStepId } from "@/lib/social/onboarding";
import type { RuntimePreflightReport } from "@/lib/runtime/preflight";

function buildPreflight(checkStates: Record<string, "ok" | "warning" | "missing">): RuntimePreflightReport {
  return {
    status: "warn",
    generatedAt: "2026-02-26T00:00:00.000Z",
    checks: [
      {
        id: "social-draft-approval-base-url",
        label: "approval base",
        level: "recommended",
        state: checkStates["social-draft-approval-base-url"] || "warning",
        detail: "approval base",
      },
      {
        id: "social-draft-webhook",
        label: "approval webhook",
        level: "recommended",
        state: checkStates["social-draft-webhook"] || "warning",
        detail: "approval webhook",
      },
      {
        id: "social-draft-worker-token",
        label: "worker token",
        level: "recommended",
        state: checkStates["social-draft-worker-token"] || "warning",
        detail: "worker token",
      },
      {
        id: "smauto-mcp-connector",
        label: "smauto connector",
        level: "recommended",
        state: checkStates["smauto-mcp-connector"] || "warning",
        detail: "smauto connector",
      },
      {
        id: "smauto-mcp-auth",
        label: "smauto auth",
        level: "recommended",
        state: checkStates["smauto-mcp-auth"] || "warning",
        detail: "smauto auth",
      },
      {
        id: "social-dispatch-status-webhook",
        label: "dispatch webhook",
        level: "recommended",
        state: checkStates["social-dispatch-status-webhook"] || "warning",
        detail: "dispatch webhook",
      },
    ],
  };
}

describe("social onboarding helpers", () => {
  it("marks all steps ready when requirements and manual completion are satisfied", () => {
    const preflight = buildPreflight({
      "social-draft-approval-base-url": "ok",
      "social-draft-webhook": "ok",
      "social-draft-worker-token": "ok",
      "smauto-mcp-connector": "ok",
      "smauto-mcp-auth": "ok",
      "social-dispatch-status-webhook": "ok",
    });
    const steps = buildSocialOnboardingSteps({
      googleConnected: true,
      preflight,
      completedStepIds: ["social_accounts_selected"],
      socialConnectionsUrl: "https://social.example/connections",
    });

    expect(steps.every((step) => step.state === "ready")).toBe(true);
    const manual = steps.find((step) => step.id === "social_accounts_selected");
    expect(manual?.actionHref).toBe("https://social.example/connections");
  });

  it("keeps manual social account selection step pending until explicitly marked complete", () => {
    const preflight = buildPreflight({
      "social-draft-approval-base-url": "ok",
      "social-draft-webhook": "ok",
      "social-draft-worker-token": "ok",
      "smauto-mcp-connector": "ok",
      "smauto-mcp-auth": "ok",
      "social-dispatch-status-webhook": "ok",
    });
    const steps = buildSocialOnboardingSteps({
      googleConnected: true,
      preflight,
      completedStepIds: [] as SocialOnboardingStepId[],
      socialConnectionsUrl: null,
    });
    const manual = steps.find((step) => step.id === "social_accounts_selected");
    expect(manual?.state).toBe("needs_action");
    expect(manual?.canToggle).toBe(true);
  });

  it("marks runtime-backed steps as needs_action when diagnostics are missing", () => {
    const preflight = buildPreflight({
      "social-draft-approval-base-url": "warning",
      "social-draft-webhook": "missing",
      "social-draft-worker-token": "warning",
      "smauto-mcp-connector": "missing",
      "smauto-mcp-auth": "warning",
      "social-dispatch-status-webhook": "warning",
    });

    const steps = buildSocialOnboardingSteps({
      googleConnected: false,
      preflight,
      completedStepIds: [],
      socialConnectionsUrl: "https://social.example/connections",
    });

    expect(steps.find((step) => step.id === "google_workspace_connected")?.state).toBe("needs_action");
    expect(steps.find((step) => step.id === "approval_webhook_configured")?.state).toBe("needs_action");
    expect(steps.find((step) => step.id === "smauto_connector_configured")?.state).toBe("needs_action");
    expect(
      steps.find((step) => step.id === "dispatch_status_notifications_configured")?.state
    ).toBe("needs_action");
  });
});
