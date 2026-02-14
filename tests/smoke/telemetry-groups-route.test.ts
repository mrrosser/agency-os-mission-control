import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/telemetry/groups/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAdminDb } from "@/lib/firebase-admin";

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const getAdminDbMock = vi.mocked(getAdminDb);

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("telemetry groups route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
  });

  it("returns triage groups for a run correlation id", async () => {
    const eventDocs = [
      { data: () => ({ fingerprint: "fp-a" }) },
      { data: () => ({ fingerprint: "fp-b" }) },
    ];

    const groupsById: Record<string, Record<string, unknown>> = {
      "fp-a": {
        kind: "client",
        count: 5,
        sample: { message: "Inbox failed", route: "/dashboard/inbox", correlationId: "run-1" },
        triage: { status: "issued", issueNumber: 42, issueUrl: "https://github.com/acme/repo/issues/42" },
      },
      "fp-b": {
        kind: "server",
        count: 2,
        sample: { message: "Calendar 500", route: "/dashboard/calendar", correlationId: "run-1" },
        triage: { status: "new" },
      },
    };

    const eventsQuery = {
      where: vi.fn(() => ({
        limit: vi.fn(() => ({
          get: vi.fn(async () => ({ docs: eventDocs })),
        })),
      })),
      limit: vi.fn(() => ({
        get: vi.fn(async () => ({ docs: eventDocs })),
      })),
    };

    getAdminDbMock.mockReturnValue({
      collection: vi.fn((name: string) => {
        if (name === "telemetry_error_events") {
          return {
            where: vi.fn(() => eventsQuery),
          };
        }
        if (name === "telemetry_error_groups") {
          return {
            doc: vi.fn((fingerprint: string) => ({
              get: vi.fn(async () => ({
                exists: Boolean(groupsById[fingerprint]),
                data: () => groupsById[fingerprint] || {},
              })),
            })),
          };
        }
        throw new Error(`unexpected collection ${name}`);
      }),
    } as unknown as ReturnType<typeof getAdminDb>);

    const req = new Request("http://localhost/api/telemetry/groups?runId=run-1&limit=6", {
      method: "GET",
    });
    const res = await GET(
      req as unknown as Parameters<typeof GET>[0],
      createContext() as unknown as Parameters<typeof GET>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(data.groups)).toBe(true);
    expect(data.groups).toHaveLength(2);
    expect(data.groups[0].fingerprint).toBe("fp-a");
    expect(data.groups[0].triage.issueUrl).toContain("/issues/42");
  });
});
