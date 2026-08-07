import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultAutonomyPolicy } from "@/lib/agents/autonomy-policy";
import { getAutonomyPolicy } from "@/lib/agents/autonomy-policy-store";
import {
  resolveAutonomyBusinessId,
  resolveRuntimePause,
} from "@/lib/agents/autonomy-runtime";
import type { Logger } from "@/lib/logging";

vi.mock("@/lib/agents/autonomy-policy-store", () => ({
  getAutonomyPolicy: vi.fn(),
}));

const getAutonomyPolicyMock = vi.mocked(getAutonomyPolicy);
const log: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("autonomy runtime pause", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.MISSION_CONTROL_GLOBAL_KILL_SWITCH;
    getAutonomyPolicyMock.mockResolvedValue(createDefaultAutonomyPolicy("owner-1"));
  });

  it("adapts scheduler, UI, and canonical Rosser identifiers", () => {
    expect(resolveAutonomyBusinessId("rts")).toBe("rt_solutions");
    expect(resolveAutonomyBusinessId("rng")).toBe("rosser_gallery");
    expect(resolveAutonomyBusinessId("rosser_nft_gallery")).toBe("rosser_gallery");
    expect(resolveAutonomyBusinessId("aicf")).toBeNull();
  });

  it("honors the persisted operator global pause", async () => {
    getAutonomyPolicyMock.mockResolvedValue({
      ...createDefaultAutonomyPolicy("owner-1"),
      globalKillSwitch: true,
    });

    await expect(
      resolveRuntimePause({ uid: "owner-1", businessKey: "rng", log })
    ).resolves.toMatchObject({
      paused: true,
      reason: "operator_global_pause",
      businessId: "rosser_gallery",
    });
  });

  it("applies the global pause to legacy or unknown job scopes", async () => {
    getAutonomyPolicyMock.mockResolvedValue({
      ...createDefaultAutonomyPolicy("owner-1"),
      globalKillSwitch: true,
    });

    await expect(resolveRuntimePause({ uid: "owner-1", log })).resolves.toMatchObject({
      paused: true,
      reason: "operator_global_pause",
      businessId: null,
    });
    await expect(
      resolveRuntimePause({ uid: "owner-1", businessKey: "legacy-unknown", log })
    ).resolves.toMatchObject({ paused: true, reason: "operator_global_pause", businessId: null });
  });

  it("keeps explicitly scoped AI CoFoundry work outside the stored two-business pause", async () => {
    getAutonomyPolicyMock.mockResolvedValue({
      ...createDefaultAutonomyPolicy("owner-1"),
      globalKillSwitch: true,
    });

    await expect(
      resolveRuntimePause({ uid: "owner-1", businessKey: "aicf", log })
    ).resolves.toMatchObject({ paused: false, reason: "not_paused", businessId: null });
    expect(getAutonomyPolicyMock).not.toHaveBeenCalled();
  });

  it("fails closed when the policy cannot be read", async () => {
    getAutonomyPolicyMock.mockRejectedValue(new Error("firestore unavailable"));

    await expect(
      resolveRuntimePause({ uid: "owner-1", businessKey: "rts", log })
    ).resolves.toMatchObject({ paused: true, reason: "policy_read_failed" });
    expect(log.error).toHaveBeenCalledWith(
      "agents.autonomy_runtime.policy_read_failed",
      expect.objectContaining({ uid: "owner-1", businessId: "rt_solutions" })
    );

    await expect(resolveRuntimePause({ uid: "owner-1", log })).resolves.toMatchObject({
      paused: true,
      reason: "policy_read_failed",
      businessId: null,
    });
  });
});
