import { describe, it, expect, vi } from "vitest";
import { getAgentSpaceStatus } from "@/lib/agent-status";
import { getAdminDb } from "@/lib/firebase-admin";

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
}));

const getAdminDbMock = vi.mocked(getAdminDb);

describe("agent status smoke", () => {
  it("handles missing document safely", async () => {
    getAdminDbMock.mockReturnValue({
      collection: () => ({
        doc: () => ({
          get: async () => ({
            data: () => undefined,
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getAdminDb>);

    const result = await getAgentSpaceStatus("user-1");
    expect(result).toEqual({});
  });
});
