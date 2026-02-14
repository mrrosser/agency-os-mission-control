import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/lead-runs/[runId]/jobs/worker/route";
import { getAdminDb } from "@/lib/firebase-admin";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { resolveSecret } from "@/lib/api/secrets";
import { recordLeadActionReceipt } from "@/lib/lead-runs/receipts";
import { recordLeadRunOutcome, releaseLeadRunConcurrencySlot } from "@/lib/lead-runs/quotas";
import { triggerLeadRunWorker } from "@/lib/lead-runs/jobs";
import { findDncMatch } from "@/lib/outreach/dnc";

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
}));

vi.mock("@/lib/google/oauth", () => ({
  getAccessTokenForUser: vi.fn(),
}));

vi.mock("@/lib/api/secrets", () => ({
  resolveSecret: vi.fn(),
}));

vi.mock("@/lib/lead-runs/receipts", () => ({
  recordLeadActionReceipt: vi.fn(async () => undefined),
}));

vi.mock("@/lib/lead-runs/quotas", () => ({
  recordLeadRunOutcome: vi.fn(async () => undefined),
  releaseLeadRunConcurrencySlot: vi.fn(async () => undefined),
}));

vi.mock("@/lib/lead-runs/jobs", async () => {
  const actual = await vi.importActual<typeof import("@/lib/lead-runs/jobs")>("@/lib/lead-runs/jobs");
  return {
    ...actual,
    triggerLeadRunWorker: vi.fn(async () => undefined),
  };
});

vi.mock("@/lib/outreach/dnc", () => ({
  findDncMatch: vi.fn(),
}));

const getAdminDbMock = vi.mocked(getAdminDb);
const getAccessTokenMock = vi.mocked(getAccessTokenForUser);
const resolveSecretMock = vi.mocked(resolveSecret);
const recordLeadActionReceiptMock = vi.mocked(recordLeadActionReceipt);
const recordLeadRunOutcomeMock = vi.mocked(recordLeadRunOutcome);
const releaseLeadRunConcurrencySlotMock = vi.mocked(releaseLeadRunConcurrencySlot);
const triggerLeadRunWorkerMock = vi.mocked(triggerLeadRunWorker);
const findDncMatchMock = vi.mocked(findDncMatch);

function createContext(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}

describe("lead run worker SMS handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    getAccessTokenMock.mockResolvedValue("access-token");
    findDncMatchMock.mockResolvedValue(null);
    resolveSecretMock.mockImplementation(async (_uid, key) => {
      if (key === "twilioSid") return "sid";
      if (key === "twilioToken") return "token";
      if (key === "twilioPhoneNumber") return "+15550001111";
      return undefined;
    });
  });

  it("does not require ElevenLabs when only SMS is enabled (dry run)", async () => {
    const jobSet = vi.fn(async () => undefined);
    const lead = {
      companyName: "ACME Co",
      founderName: "Sam",
      email: "sam@acme.co",
      phone: "+15551230000",
      industry: "Roofing",
      score: 90,
    };

    const jobDoc = {
      runId: "run-1",
      userId: "user-1",
      orgId: "org-1",
      status: "queued",
      config: {
        dryRun: true,
        draftFirst: true,
        timeZone: "UTC",
        useSMS: true,
        useAvatar: false,
        useOutboundCall: false,
      },
      workerToken: "worker-1",
      leadDocIds: ["lead-1"],
      nextIndex: 0,
      totalLeads: 1,
      diagnostics: {
        sourceFetched: 0,
        sourceScored: 0,
        sourceFilteredByScore: 0,
        sourceWithEmail: 0,
        sourceWithoutEmail: 0,
        processedLeads: 0,
        failedLeads: 0,
        calendarRetries: 0,
        noEmail: 0,
        noSlot: 0,
        meetingsScheduled: 0,
        meetingsDrafted: 0,
        emailsSent: 0,
        emailsDrafted: 0,
        smsSent: 0,
        callsPlaced: 0,
        avatarsQueued: 0,
        channelFailures: 0,
      },
      attemptsByLead: {},
    };

    const leadRef = {
      get: vi.fn(async () => ({ exists: true, data: () => lead })),
      set: vi.fn(async () => undefined),
    };

    const jobRef = {
      set: jobSet,
    };

    const runRef = {
      collection: vi.fn((name: string) => {
        if (name === "jobs") {
          return { doc: vi.fn(() => jobRef) };
        }
        if (name === "leads") {
          return { doc: vi.fn(() => leadRef) };
        }
        throw new Error(`unexpected run subcollection: ${name}`);
      }),
    };

    const identityRef = {
      get: vi.fn(async () => ({
        exists: true,
        data: () => ({ founderName: "Marcus", businessName: "AgencyOS", primaryService: "lead gen" }),
      })),
    };

    const tx = {
      get: vi.fn(async (ref: unknown) => {
        if (ref === runRef) return { exists: true, data: () => ({}) };
        if (ref === jobRef) return { exists: true, data: () => jobDoc };
        throw new Error("unexpected transaction ref");
      }),
      set: vi.fn(async () => undefined),
    };

    getAdminDbMock.mockReturnValue({
      runTransaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(tx)),
      collection: vi.fn((name: string) => {
        if (name === "lead_runs") {
          return { doc: vi.fn(() => runRef) };
        }
        if (name === "identities") {
          return { doc: vi.fn(() => identityRef) };
        }
        throw new Error(`unexpected collection: ${name}`);
      }),
    } as unknown as ReturnType<typeof getAdminDb>);

    const req = new Request("http://localhost/api/lead-runs/run-1/jobs/worker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workerToken: "worker-1" }),
    });

    const res = await POST(
      req as unknown as Parameters<typeof POST>[0],
      createContext({ runId: "run-1" }) as unknown as Parameters<typeof POST>[1]
    );

    expect(res.status).toBe(200);

    const actionIds = recordLeadActionReceiptMock.mock.calls.map(([input]) => String(input.actionId));
    expect(actionIds).toContain("twilio.sms");
    expect(actionIds).not.toContain("twilio.call");

    expect(
      recordLeadActionReceiptMock.mock.calls.some(
        ([input]) => input.actionId === "twilio.sms" && input.status === "simulated"
      )
    ).toBe(true);

    expect(recordLeadRunOutcomeMock).toHaveBeenCalled();
    expect(releaseLeadRunConcurrencySlotMock).toHaveBeenCalled();
    expect(triggerLeadRunWorkerMock).not.toHaveBeenCalled();
  });
});
