import { afterEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import type { Logger } from "@/lib/logging";
import {
  WARM_RECONNECT_PROVIDER_SEND_FLAG,
  isWarmReconnectProviderSendEnabled,
} from "@/lib/crm/warm-reconnect-provider-config";
import { loadWarmReconnectActivationForUid } from "@/lib/crm/warm-reconnect-repository";
import { isWarmReconnectProviderSendEnabled as executorSendEnabled } from "@/lib/crm/warm-reconnect-executor";

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(() => { throw new Error("Unexpected real datastore access"); }),
}));
vi.mock("@/lib/crm/portfolio-registry", () => ({
  assertPortfolioRegistryAccess: vi.fn(async () => ({
    workspaceId: "workspace_default_owner-1", role: "owner",
  })),
  loadPortfolioCrmSummaryForUid: vi.fn(),
}));
vi.mock("@/lib/google/account-token-store", () => ({
  resolveGoogleAccountTokens: vi.fn(async () => ({ record: null, profileMapped: false })),
}));

function emptyReadOnlyDb(): Firestore {
  const query = {
    collection: vi.fn(), doc: vi.fn(), where: vi.fn(), limit: vi.fn(),
    get: vi.fn(async () => ({ docs: [], size: 0 })),
  };
  for (const method of [query.collection, query.doc, query.where, query.limit]) {
    method.mockReturnValue(query);
  }
  return query as unknown as Firestore;
}

const log = { info: vi.fn() } as unknown as Logger;

afterEach(() => vi.unstubAllEnvs());

describe("warm reconnect runtime provider capability", () => {
  it.each([
    [undefined, false], ["", false], ["false", false], ["0", false], ["yes", false],
    ["true", true], [" TRUE ", true],
  ])("reads %s with the unchanged executor policy", (value, expected) => {
    expect(isWarmReconnectProviderSendEnabled({ [WARM_RECONNECT_PROVIDER_SEND_FLAG]: value }))
      .toBe(expected);
    expect(executorSendEnabled).toBe(isWarmReconnectProviderSendEnabled);
  });

  it("projects the current server flag on every activation read without granting campaign authority", async () => {
    const db = emptyReadOnlyDb();
    for (const [value, expected] of [["true", true], ["false", false], [undefined, false]] as const) {
      vi.stubEnv(WARM_RECONNECT_PROVIDER_SEND_FLAG, value);
      const response = await loadWarmReconnectActivationForUid("owner-1", log, db);
      expect(response.constraints.providerExecutionEnabled).toBe(expected);
      expect(response.constraints.launchAuthorizesExactProviderExecution).toBe(true);
      expect(response.providerActions).toBe("none");
      expect(response.pilots).toEqual([]);
      expect(response.candidates).toEqual([]);
    }
  });
});
