import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSecret } from "@/lib/api/secrets";
import { clearProviderBillingCache, pullProviderBilling } from "@/lib/billing/provider-costs";

vi.mock("@/lib/api/secrets", () => ({
  resolveSecret: vi.fn(),
}));

const resolveSecretMock = vi.mocked(resolveSecret);

const TEST_LOGGER = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function responseJson(payload: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("pullProviderBilling", () => {
  beforeEach(() => {
    clearProviderBillingCache();
    vi.clearAllMocks();
    process.env.OPENAI_ADMIN_API_KEY = "";
    process.env.OPENAI_ORG_ADMIN_KEY = "";
  });

  it("pulls live month-to-date costs from OpenAI, Twilio, and ElevenLabs", async () => {
    resolveSecretMock.mockImplementation(async (_uid, key) => {
      if (key === "openaiKey") return "openai-key";
      if (key === "twilioSid") return "AC123";
      if (key === "twilioToken") return "tw-token";
      if (key === "elevenLabsKey") return "eleven-key";
      return undefined;
    });

    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("openai.com/v1/organization/costs")) {
        return responseJson({
          data: [
            { results: [{ amount: { value: 12.5, currency: "usd" } }] },
            { results: [{ amount: { value: 1.25, currency: "usd" } }] },
          ],
        });
      }
      if (url.includes("api.twilio.com")) {
        return responseJson({
          usage_records: [{ category: "totalprice", price: "-4.15", price_unit: "usd" }],
        });
      }
      if (url.includes("elevenlabs.io/v1/user/subscription")) {
        return responseJson({
          currency: "usd",
          next_invoice: { amount_due_cents: 321 },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const snapshot = await pullProviderBilling({
      uid: "user-1",
      log: TEST_LOGGER,
      now: new Date("2026-02-16T18:00:00.000Z"),
      fetchImpl,
    });

    expect(snapshot.capturedAt).toBe("2026-02-16T18:00:00.000Z");
    expect(snapshot.providers).toHaveLength(3);
    expect(snapshot.providers.find((provider) => provider.providerId === "openai")).toMatchObject({
      status: "live",
      monthlyCostUsd: 13.75,
      currency: "USD",
    });
    expect(snapshot.providers.find((provider) => provider.providerId === "twilio")).toMatchObject({
      status: "live",
      monthlyCostUsd: 4.15,
      currency: "USD",
    });
    expect(snapshot.providers.find((provider) => provider.providerId === "elevenlabs")).toMatchObject({
      status: "live",
      monthlyCostUsd: 3.21,
      currency: "USD",
    });
  });

  it("returns resilient statuses when billing endpoints are unavailable", async () => {
    resolveSecretMock.mockImplementation(async (_uid, key) => {
      if (key === "twilioSid") return "AC123";
      if (key === "twilioToken") return "tw-token";
      if (key === "elevenLabsKey") return "eleven-key";
      return undefined;
    });

    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("api.twilio.com")) {
        return responseJson({ message: "Auth failed" }, 401);
      }
      if (url.includes("elevenlabs.io/v1/user/subscription")) {
        return responseJson({ currency: "usd", character_count: 1234 }, 200);
      }
      if (url.includes("elevenlabs.io/v1/usage/character-stats")) {
        return responseJson({ data: [{ characters: 50 }] }, 200);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const snapshot = await pullProviderBilling({
      uid: "user-1",
      log: TEST_LOGGER,
      now: new Date("2026-02-16T18:00:00.000Z"),
      fetchImpl,
    });

    const openai = snapshot.providers.find((provider) => provider.providerId === "openai");
    const twilio = snapshot.providers.find((provider) => provider.providerId === "twilio");
    const elevenlabs = snapshot.providers.find((provider) => provider.providerId === "elevenlabs");

    expect(openai?.status).toBe("missing_credentials");
    expect(twilio?.status).toBe("unauthorized");
    expect(elevenlabs?.status).toBe("unavailable");
    expect(elevenlabs?.monthlyCostUsd).toBeNull();
  });

  it("reuses cached billing snapshots and supports bypassing cache", async () => {
    resolveSecretMock.mockImplementation(async (_uid, key) => {
      if (key === "openaiKey") return "openai-key";
      if (key === "twilioSid") return "AC123";
      if (key === "twilioToken") return "tw-token";
      if (key === "elevenLabsKey") return "eleven-key";
      return undefined;
    });

    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("openai.com/v1/organization/costs")) {
        return responseJson({
          data: [{ results: [{ amount: { value: 5, currency: "usd" } }] }],
        });
      }
      if (url.includes("api.twilio.com")) {
        return responseJson({
          usage_records: [{ category: "totalprice", price: "-2.1", price_unit: "usd" }],
        });
      }
      if (url.includes("elevenlabs.io/v1/user/subscription")) {
        return responseJson({
          currency: "usd",
          next_invoice: { amount_due_cents: 140 },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const first = await pullProviderBilling({
      uid: "cache-user",
      log: TEST_LOGGER,
      now: new Date("2026-02-16T18:00:00.000Z"),
      fetchImpl,
    });
    const second = await pullProviderBilling({
      uid: "cache-user",
      log: TEST_LOGGER,
      now: new Date("2026-02-16T18:00:10.000Z"),
      fetchImpl,
    });

    expect(first).toEqual(second);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    await pullProviderBilling({
      uid: "cache-user",
      log: TEST_LOGGER,
      now: new Date("2026-02-16T18:00:20.000Z"),
      fetchImpl,
      bypassCache: true,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });
});
