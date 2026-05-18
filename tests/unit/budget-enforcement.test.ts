import { afterEach, describe, expect, it, vi } from "vitest";
import { assertProviderSpendAllowed } from "@/lib/budget/enforcement";
import { pullProviderBilling } from "@/lib/billing/provider-costs";

vi.mock("@/lib/billing/provider-costs", () => ({
  pullProviderBilling: vi.fn(),
}));

const pullProviderBillingMock = vi.mocked(pullProviderBilling);
const ORIGINAL_ENV = {
  MISSION_CONTROL_BUDGET_MODE: process.env.MISSION_CONTROL_BUDGET_MODE,
  MISSION_CONTROL_GLOBAL_KILL_SWITCH: process.env.MISSION_CONTROL_GLOBAL_KILL_SWITCH,
  MISSION_CONTROL_PROVIDER_KILL_SWITCHES: process.env.MISSION_CONTROL_PROVIDER_KILL_SWITCHES,
  MISSION_CONTROL_PROVIDER_BUDGETS_JSON: process.env.MISSION_CONTROL_PROVIDER_BUDGETS_JSON,
  MISSION_CONTROL_PROVIDER_ESTIMATES_JSON: process.env.MISSION_CONTROL_PROVIDER_ESTIMATES_JSON,
  MISSION_CONTROL_PROVIDER_UNRECONCILED_JSON: process.env.MISSION_CONTROL_PROVIDER_UNRECONCILED_JSON,
  MISSION_CONTROL_MONTHLY_BUDGET_USD: process.env.MISSION_CONTROL_MONTHLY_BUDGET_USD,
};

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as const;

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(process.env, ORIGINAL_ENV);
});

describe("budget enforcement", () => {
  it("allows requests when below provider and monthly limits", async () => {
    process.env.MISSION_CONTROL_BUDGET_MODE = "hard-stop";
    process.env.MISSION_CONTROL_PROVIDER_BUDGETS_JSON = JSON.stringify({ twilio: 100 });
    process.env.MISSION_CONTROL_MONTHLY_BUDGET_USD = "500";
    pullProviderBillingMock.mockResolvedValue({
      capturedAt: "2026-04-06T00:00:00.000Z",
      providers: [
        {
          providerId: "twilio",
          label: "Twilio",
          status: "live",
          monthlyCostUsd: 12,
          currency: "USD",
          detail: "ok",
          source: "usage.records.this_month",
        },
      ],
    });

    await expect(
      assertProviderSpendAllowed({
        uid: "user-1",
        providerId: "twilio",
        log: log as never,
        route: "twilio.send-sms",
      })
    ).resolves.toBeUndefined();
  });

  it("blocks when provider hard limit is reached", async () => {
    process.env.MISSION_CONTROL_BUDGET_MODE = "hard-stop";
    process.env.MISSION_CONTROL_PROVIDER_BUDGETS_JSON = JSON.stringify({ elevenlabs: 10 });
    pullProviderBillingMock.mockResolvedValue({
      capturedAt: "2026-04-06T00:00:00.000Z",
      providers: [
        {
          providerId: "elevenlabs",
          label: "ElevenLabs",
          status: "live",
          monthlyCostUsd: 10.5,
          currency: "USD",
          detail: "ok",
          source: "user.subscription",
        },
      ],
    });

    await expect(
      assertProviderSpendAllowed({
        uid: "user-1",
        providerId: "elevenlabs",
        log: log as never,
        route: "elevenlabs.synthesize",
      })
    ).rejects.toThrow(/provider hard limit/i);
  });

  it("blocks when global kill switch is enabled", async () => {
    process.env.MISSION_CONTROL_BUDGET_MODE = "hard-stop";
    process.env.MISSION_CONTROL_GLOBAL_KILL_SWITCH = "true";

    await expect(
      assertProviderSpendAllowed({
        uid: "user-1",
        providerId: "heygen",
        log: log as never,
        route: "heygen.create-avatar",
      })
    ).rejects.toThrow(/global kill switch/i);
  });
});
