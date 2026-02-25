import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/twilio/voice-webhook/route";
import { getAdminDb } from "@/lib/firebase-admin";
import { triggerVoiceActionsWorker } from "@/lib/voice/action-jobs";
import { promises as fs } from "fs";

vi.mock("fs", () => ({
  promises: {
    readFile: vi.fn(),
  },
}));

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: vi.fn(),
}));

vi.mock("@/lib/voice/action-jobs", () => ({
  triggerVoiceActionsWorker: vi.fn(),
}));

const readFileMock = vi.mocked(fs.readFile);
const getAdminDbMock = vi.mocked(getAdminDb);
const triggerVoiceActionsWorkerMock = vi.mocked(triggerVoiceActionsWorker);

const knowledgePackPayload = {
  globalPolicies: {
    voiceOpsPolicy: {
      enabled: true,
      requireBusinessContextBeforeWrite: true,
      allowActions: ["gmail.createDraft", "calendar.createMeet", "crm.upsertLead"],
      actionPolicies: {
        gmail: { mode: "draft_first" },
        calendar: { mode: "strict_auto_book" },
        crm: { mode: "upsert_only" },
      },
      callerRouting: [
        {
          phoneNumber: "+18443169534",
          defaultBusinessId: "rosser_nft_gallery",
        },
      ],
    },
  },
  businesses: [
    {
      id: "rosser_nft_gallery",
      name: "Rosser NFT Gallery",
      serviceCatalog: ["Exhibitions", "Commissions"],
      calendarDefaults: {
        bookingLink: "https://calendar.app.google/afjkNdXsLSWYibfUA",
      },
    },
  ],
};

function createContext() {
  return { params: Promise.resolve({}) };
}

describe("twilio voice webhook route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    readFileMock.mockResolvedValue(JSON.stringify(knowledgePackPayload));
    process.env.VOICE_ACTIONS_WORKER_TOKEN = "worker-token";
    triggerVoiceActionsWorkerMock.mockResolvedValue("http");
  });

  it("returns gather twiml for initial inbound call", async () => {
    const sessionSet = vi.fn(async (_data: Record<string, unknown>, _opts?: Record<string, unknown>) => undefined);
    const actionSet = vi.fn(async (_data: Record<string, unknown>, _opts?: Record<string, unknown>) => undefined);
    getAdminDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === "voice_call_sessions") {
          return {
            doc: () => ({
              set: sessionSet,
            }),
          };
        }
        if (name === "voice_action_requests") {
          return {
            doc: () => ({
              set: actionSet,
            }),
          };
        }
        return {
          doc: () => ({
            set: vi.fn(async (_data: Record<string, unknown>, _opts?: Record<string, unknown>) => undefined),
          }),
        };
      },
    } as unknown as ReturnType<typeof getAdminDb>);

    const body = new URLSearchParams({
      CallSid: "CA123",
      From: "+17572147313",
      To: "+18443169534",
    });
    const request = new Request("http://localhost/api/twilio/voice-webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const response = await POST(
      request as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain("<Gather");
    expect(xml).toContain("Thanks for calling Rosser NFT Gallery");
    expect(sessionSet).toHaveBeenCalledOnce();
    expect(actionSet).not.toHaveBeenCalled();
    expect(triggerVoiceActionsWorkerMock).not.toHaveBeenCalled();
  });

  it("queues write action when transcript requests scheduling", async () => {
    const sessionSet = vi.fn(async (_data: Record<string, unknown>, _opts?: Record<string, unknown>) => undefined);
    const actionSet = vi.fn(async (_data: Record<string, unknown>, _opts?: Record<string, unknown>) => undefined);
    getAdminDbMock.mockReturnValue({
      collection: (name: string) => {
        if (name === "voice_call_sessions") {
          return {
            doc: () => ({
              set: sessionSet,
            }),
          };
        }
        if (name === "voice_action_requests") {
          return {
            doc: () => ({
              set: actionSet,
            }),
          };
        }
        return {
          doc: () => ({
            set: vi.fn(async (_data: Record<string, unknown>, _opts?: Record<string, unknown>) => undefined),
          }),
        };
      },
    } as unknown as ReturnType<typeof getAdminDb>);

    const body = new URLSearchParams({
      CallSid: "CA123",
      From: "+17572147313",
      To: "+18443169534",
      SpeechResult: "Can I book a meeting for next week?",
    });
    const request = new Request("http://localhost/api/twilio/voice-webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const response = await POST(
      request as unknown as Parameters<typeof POST>[0],
      createContext() as unknown as Parameters<typeof POST>[1]
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain("queued");
    expect(actionSet).toHaveBeenCalledOnce();
    const actionPayload = actionSet.mock.calls[0]?.[0];
    expect(actionPayload?.action).toBe("calendar.createMeet");
    expect(actionPayload?.mode).toBe("strict_auto_book");
    expect(sessionSet).toHaveBeenCalledOnce();
    expect(triggerVoiceActionsWorkerMock).toHaveBeenCalledOnce();
    const triggerArgs = triggerVoiceActionsWorkerMock.mock.calls[0]?.[0];
    expect(triggerArgs).toMatchObject({
      origin: "http://localhost",
      workerToken: "worker-token",
      requestId: expect.any(String),
    });
  });
});
