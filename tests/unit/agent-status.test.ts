import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAgentSpaceStatus } from "@/lib/agent-status";
import { getAdminDb } from "@/lib/firebase-admin";

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
}));

const getAdminDbMock = vi.mocked(getAdminDb);

describe("agent status", () => {
  beforeEach(() => {
    getAdminDbMock.mockReset();
  });

  it("serializes timestamps to ISO strings", async () => {
    getAdminDbMock.mockReturnValue({
      collection: () => ({
        doc: () => ({
          get: async () => ({
            data: () => ({
              spaces: {
                "spaces/AAA": {
                  agentId: "coding",
                  updatedAt: { seconds: 1700000000 },
                },
              },
            }),
          }),
        }),
      }),
    } as any);

    const result = await getAgentSpaceStatus("user-1");
    expect(result["spaces/AAA"]?.agentId).toBe("coding");
    expect(result["spaces/AAA"]?.updatedAt).toMatch(/T/);
  });

  it("returns empty object when no spaces are stored", async () => {
    getAdminDbMock.mockReturnValue({
      collection: () => ({
        doc: () => ({
          get: async () => ({
            data: () => ({}),
          }),
        }),
      }),
    } as any);

    const result = await getAgentSpaceStatus("user-1");
    expect(result).toEqual({});
  });
});
