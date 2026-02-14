import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as sendSmsPost } from "@/app/api/twilio/send-sms/route";
import { POST as makeCallPost } from "@/app/api/twilio/make-call/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { resolveSecret } from "@/lib/api/secrets";
import { withIdempotency } from "@/lib/api/idempotency";
import { createHostedCallAudio } from "@/lib/voice/call-audio";
import { resolveLeadRunOrgId } from "@/lib/lead-runs/quotas";
import { findDncMatch } from "@/lib/outreach/dnc";

const twilioMocks = vi.hoisted(() => {
  const messagesCreate = vi.fn();
  const callsCreate = vi.fn();
  const factory = vi.fn(() => ({
    messages: { create: messagesCreate },
    calls: { create: callsCreate },
  }));
  return { messagesCreate, callsCreate, factory };
});

vi.mock("twilio", () => ({
  default: twilioMocks.factory,
}));

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: vi.fn(),
}));

vi.mock("@/lib/api/secrets", () => ({
  resolveSecret: vi.fn(),
}));

vi.mock("@/lib/api/idempotency", () => ({
  getIdempotencyKey: vi.fn(() => null),
  withIdempotency: vi.fn(async (_params, executor: () => Promise<unknown>) => ({
    data: await executor(),
    replayed: false,
  })),
}));

vi.mock("@/lib/voice/call-audio", () => ({
  createHostedCallAudio: vi.fn(),
}));

vi.mock("@/lib/lead-runs/quotas", () => ({
  resolveLeadRunOrgId: vi.fn(),
}));

vi.mock("@/lib/outreach/dnc", () => ({
  findDncMatch: vi.fn(),
}));

const requireAuthMock = vi.mocked(requireFirebaseAuth);
const resolveSecretMock = vi.mocked(resolveSecret);
const withIdempotencyMock = vi.mocked(withIdempotency);
const createHostedCallAudioMock = vi.mocked(createHostedCallAudio);
const resolveOrgMock = vi.mocked(resolveLeadRunOrgId);
const findDncMock = vi.mocked(findDncMatch);

function createContext() {
  return { params: Promise.resolve({}) };
}

function withDefaultSecrets() {
  resolveSecretMock.mockImplementation(async (_uid, key) => {
    if (key === "twilioSid") return "AC_test_sid";
    if (key === "twilioToken") return "test_token";
    if (key === "twilioPhoneNumber") return "+15005550006";
    if (key === "elevenLabsKey") return "eleven_test_key";
    return null;
  });
}

describe("twilio routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    requireAuthMock.mockResolvedValue({ uid: "user-1" } as unknown as { uid: string });
    resolveOrgMock.mockResolvedValue("org-1");
    findDncMock.mockResolvedValue(null);
    withIdempotencyMock.mockImplementation(async (_params, executor: () => Promise<unknown>) => ({
      data: await executor(),
      replayed: false,
    }));
    withDefaultSecrets();
    createHostedCallAudioMock.mockResolvedValue({
      clipId: "clip-123",
      audioUrl: "https://example.com/clip-123.mp3",
      voiceId: "voice-test",
      modelId: "model-test",
      bytes: 1024,
    });
    twilioMocks.messagesCreate.mockReset();
    twilioMocks.callsCreate.mockReset();
    twilioMocks.factory.mockClear();
  });

  it("send-sms uses stored Twilio phone number when request omits from", async () => {
    twilioMocks.messagesCreate.mockResolvedValue({
      sid: "SM123",
      status: "queued",
      to: "+15551230000",
      from: "+15005550006",
    });

    const req = new Request("http://localhost/api/twilio/send-sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: "+15551230000",
        message: "Hello from smoke test",
      }),
    });

    const res = await sendSmsPost(
      req as unknown as Parameters<typeof sendSmsPost>[0],
      createContext() as unknown as Parameters<typeof sendSmsPost>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(twilioMocks.messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "+15551230000",
        from: "+15005550006",
      })
    );
  });

  it("send-sms returns 400 when Twilio phone number is missing", async () => {
    resolveSecretMock.mockImplementation(async (_uid, key) => {
      if (key === "twilioSid") return "AC_test_sid";
      if (key === "twilioToken") return "test_token";
      if (key === "twilioPhoneNumber") return null;
      return null;
    });

    const req = new Request("http://localhost/api/twilio/send-sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: "+15551230000",
        message: "Missing from fallback",
      }),
    });

    const res = await sendSmsPost(
      req as unknown as Parameters<typeof sendSmsPost>[0],
      createContext() as unknown as Parameters<typeof sendSmsPost>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("Phone Number");
    expect(twilioMocks.messagesCreate).not.toHaveBeenCalled();
  });

  it("send-sms blocks when recipient is on DNC list", async () => {
    findDncMock.mockResolvedValue({
      entryId: "dnc1",
      type: "phone",
      value: "+15551230000",
      normalized: "+15551230000",
      createdBy: "user-1",
    } as unknown as Awaited<ReturnType<typeof findDncMatch>>);

    const req = new Request("http://localhost/api/twilio/send-sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: "+15551230000",
        message: "Should be blocked",
      }),
    });

    const res = await sendSmsPost(
      req as unknown as Parameters<typeof sendSmsPost>[0],
      createContext() as unknown as Parameters<typeof sendSmsPost>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(String(data.error)).toMatch(/Do Not Contact/i);
    expect(resolveSecretMock).not.toHaveBeenCalled();
    expect(twilioMocks.messagesCreate).not.toHaveBeenCalled();
    expect(twilioMocks.factory).not.toHaveBeenCalled();
  });

  it("make-call uses stored Twilio phone number when request omits from", async () => {
    twilioMocks.callsCreate.mockResolvedValue({
      sid: "CA123",
      status: "queued",
    });

    const req = new Request("http://localhost/api/twilio/make-call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: "+15551230000",
        audioUrl: "https://example.com/audio.mp3",
      }),
    });

    const res = await makeCallPost(
      req as unknown as Parameters<typeof makeCallPost>[0],
      createContext() as unknown as Parameters<typeof makeCallPost>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(twilioMocks.callsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "+15551230000",
        from: "+15005550006",
      })
    );
  });

  it("make-call blocks when recipient is on DNC list", async () => {
    findDncMock.mockResolvedValue({
      entryId: "dnc1",
      type: "phone",
      value: "+15551230000",
      normalized: "+15551230000",
      createdBy: "user-1",
    } as unknown as Awaited<ReturnType<typeof findDncMatch>>);

    const req = new Request("http://localhost/api/twilio/make-call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: "+15551230000",
        audioUrl: "https://example.com/audio.mp3",
      }),
    });

    const res = await makeCallPost(
      req as unknown as Parameters<typeof makeCallPost>[0],
      createContext() as unknown as Parameters<typeof makeCallPost>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(String(data.error)).toMatch(/Do Not Contact/i);
    expect(resolveSecretMock).not.toHaveBeenCalled();
    expect(createHostedCallAudioMock).not.toHaveBeenCalled();
    expect(twilioMocks.callsCreate).not.toHaveBeenCalled();
    expect(twilioMocks.factory).not.toHaveBeenCalled();
  });

  it("make-call synthesizes and hosts audio when text is provided", async () => {
    twilioMocks.callsCreate.mockResolvedValue({
      sid: "CA987",
      status: "queued",
    });

    const req = new Request("http://localhost/api/twilio/make-call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: "+15551239999",
        text: "Hello from AI CoFoundry",
        businessKey: "aicf",
        voiceId: "voice-test",
        modelId: "model-test",
      }),
    });

    const res = await makeCallPost(
      req as unknown as Parameters<typeof makeCallPost>[0],
      createContext() as unknown as Parameters<typeof makeCallPost>[1]
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(createHostedCallAudioMock).toHaveBeenCalledOnce();
    expect(twilioMocks.callsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "+15551239999",
        from: "+15005550006",
        twiml: "<Response><Play>https://example.com/clip-123.mp3</Play></Response>",
      })
    );
  });
});
