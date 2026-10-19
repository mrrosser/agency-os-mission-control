import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/handler";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), worker: vi.fn(), workerUid: vi.fn(), prepare: vi.fn(), read: vi.fn(), send: vi.fn(), preference: vi.fn(), unsubscribe: vi.fn(),
}));
vi.mock("@/lib/api/auth", () => ({ requireFirebaseAuth: mocks.auth }));
vi.mock("@/lib/revenue/worker-auth", () => ({ authorizeRevenueAutomationWorker: mocks.worker, resolveRevenueAutomationWorkerUid: mocks.workerUid }));
vi.mock("@/lib/crm/warm-reconnect-qa-recipient", () => ({
  isWarmReconnectQaRecipient: (value: string) => typeof value === "string" && value.trim().toLowerCase() === "owner-qa@example.test",
}));
vi.mock("@/lib/crm/warm-reconnect-qa", () => ({
  prepareWarmReconnectQa: mocks.prepare,
  readWarmReconnectQaForOwner: mocks.read, sendWarmReconnectQa: mocks.send,
  processWarmReconnectQaPreference: mocks.preference, unsubscribeWarmReconnectQaToken: mocks.unsubscribe,
}));
import { GET as read, POST as prepare } from "@/app/api/crm/warm-reconnect/qa/prepare/route";
import { POST as send } from "@/app/api/crm/warm-reconnect/qa/send/route";
import { GET as revisedRead, POST as revisedPrepare } from "@/app/api/crm/warm-reconnect/qa/revised/prepare/route";
import { POST as revisedSend } from "@/app/api/crm/warm-reconnect/qa/revised/send/route";
import { GET as recoveryRead, POST as recoveryPrepare } from "@/app/api/crm/warm-reconnect/qa/recovery/prepare/route";
import { POST as recoverySend } from "@/app/api/crm/warm-reconnect/qa/recovery/send/route";
import { WARM_RECONNECT_QA_ORIGINAL_TEST_ID as ORIGINAL, WARM_RECONNECT_QA_REVISED_TEST_ID as REVISED, WARM_RECONNECT_QA_RECOVERY_TEST_ID as RECOVERY, warmReconnectQaVersion } from "@/lib/crm/warm-reconnect-qa-version";
import { GET as preferenceGet, HEAD as preferenceHead, POST as preference } from "@/app/api/crm/warm-reconnect/qa/preferences/route";
import { GET as unsubscribeGet, HEAD as unsubscribeHead, POST as unsubscribe } from "@/app/api/crm/warm-reconnect/qa/unsubscribe/[token]/route";

const fingerprint = `sha256:${"a".repeat(64)}`;
const recipient = "owner-qa@example.test";
const token = "p".repeat(43);
const nonce = "d".repeat(64);
const context = () => ({ params: Promise.resolve({}) });
const request = (path: string, body: unknown, extra: Record<string, string> = {}) => new Request(`https://leadflow-review.web.app/api/crm/warm-reconnect/qa/${path}`, {
  method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json", ...extra }, body: JSON.stringify(body),
}) as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ uid: "owner" });
  mocks.worker.mockResolvedValue({ mode: "oidc" }); mocks.workerUid.mockReturnValue("owner");
  mocks.prepare.mockResolvedValue({ replayed: false, testMode: true, artifactFingerprint: fingerprint });
  mocks.read.mockResolvedValue({ testMode: true, status: "not_prepared" });
  mocks.send.mockResolvedValue({ testMode: true, status: "sent" });
  mocks.preference.mockResolvedValue({ testMode: true, available: true });
  mocks.unsubscribe.mockResolvedValue({ testMode: true, globallyUnsubscribed: true });
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("fixed revised owner test routes", () => {
  it("reads and prepares only the server-defined revised identity", async () => {
    await revisedRead(new Request("https://leadflow-review.web.app/api/crm/warm-reconnect/qa/revised/prepare") as never, context());
    expect(mocks.read).toHaveBeenCalledWith("owner", undefined, REVISED);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect((await revisedPrepare(request("revised/prepare", { recipient, testOnly: true }), context())).status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledWith({ uid: "owner", recipient, log: expect.anything(), testId: REVISED });
  });

  it("requires the literal revised version confirmation and prevents old-page or arbitrary-body sends", async () => {
    const valid = { recipient, artifactFingerprint: fingerprint, confirmSendOneTest: true, reviewedTestId: REVISED, reviewedDesignVersion: warmReconnectQaVersion(REVISED).designVersion };
    for (const body of [
      { recipient, artifactFingerprint: fingerprint, confirmSendOneTest: true },
      { ...valid, reviewedTestId: ORIGINAL }, { ...valid, reviewedTestId: "arbitrary" },
      { ...valid, reviewedDesignVersion: "another-design" }, { ...valid, html: "<p>caller template</p>" },
      { ...valid, testId: ORIGINAL }, { ...valid, inlineAssets: [] },
    ]) expect((await revisedSend(request("revised/send", body), context())).status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
    expect((await revisedSend(request("revised/send", valid), context())).status).toBe(200);
    expect(mocks.send).toHaveBeenCalledWith({ uid: "owner", recipient, artifactFingerprint: fingerprint, confirmSendOneTest: true, testId: REVISED });
  });

  it("rejects version, HTML, account and asset overrides at revised preparation", async () => {
    for (const extra of [{ testId: ORIGINAL }, { html: "<p>override</p>" }, { from: "other@example.test" }, { inlineAssets: [] }, { designVersion: "v3" }]) {
      expect((await revisedPrepare(request("revised/prepare", { recipient, testOnly: true, ...extra }), context())).status).toBe(400);
    }
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("requires owner authentication for both revised endpoints and preserves no-query guards", async () => {
    mocks.auth.mockRejectedValue(new ApiError(401, "Missing authorization"));
    expect((await revisedPrepare(request("revised/prepare", { recipient, testOnly: true }), context())).status).toBe(401);
    expect((await revisedSend(request("revised/send", {}), context())).status).toBe(401);
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
    mocks.auth.mockResolvedValue({ uid: "owner" });
    expect((await revisedPrepare(request("revised/prepare?testId=other", { recipient, testOnly: true }), context())).status).toBe(400);
  });
});

describe("fixed recovery owner test routes", () => {
  const valid = { recipient, artifactFingerprint: fingerprint, confirmSendOneTest: true, reviewedTestId: RECOVERY, reviewedDesignVersion: "rosser-rt-library-kit-v1" };

  it("reads without preparing and binds both mutations only to the server-defined recovery version", async () => {
    const response = await recoveryRead(new Request("https://leadflow-review.web.app/api/crm/warm-reconnect/qa/recovery/prepare") as never, context());
    expect(response.status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith("owner", undefined, RECOVERY);
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
    const prepared = await recoveryPrepare(request("recovery/prepare", { recipient: "  OWNER-QA@EXAMPLE.TEST  ", testOnly: true }), context());
    expect(prepared.status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledWith({ uid: "owner", recipient, log: expect.anything(), testId: RECOVERY });
    const sent = await recoverySend(request("recovery/send", valid), context());
    expect(sent.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledWith({ uid: "owner", recipient, artifactFingerprint: fingerprint, confirmSendOneTest: true, testId: RECOVERY });
    for (const result of [response, prepared, sent]) {
      expect(result.headers.get("cache-control")).toContain("private, no-store");
      expect(result.headers.get("referrer-policy")).toBe("no-referrer");
      expect(result.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    }
  });

  it("rejects old-version, arbitrary-ID, recipient and caller-content substitutions", async () => {
    for (const body of [
      { recipient, artifactFingerprint: fingerprint, confirmSendOneTest: true },
      { ...valid, reviewedTestId: ORIGINAL }, { ...valid, reviewedTestId: REVISED }, { ...valid, reviewedTestId: "arbitrary" },
      { ...valid, reviewedDesignVersion: "another-design" }, { ...valid, confirmSendOneTest: false },
      { ...valid, recipient: "other@example.test" }, { ...valid, artifactFingerprint: "invalid" },
      { ...valid, html: "<p>override</p>" }, { ...valid, from: "other@example.test" },
      { ...valid, inlineAssets: [] }, { ...valid, testId: ORIGINAL }, { ...valid, reset: true },
    ]) expect((await recoverySend(request("recovery/send", body), context())).status).toBe(400);
    for (const body of [
      { recipient: "other@example.test", testOnly: true }, { recipient, testOnly: false },
      ...[{ testId: ORIGINAL }, { testId: REVISED }, { testId: RECOVERY }, { from: "other@example.test" }, { html: "override" }, { inlineAssets: [] }, { reset: true }]
        .map(extra => ({ recipient, testOnly: true, ...extra })),
    ]) expect((await recoveryPrepare(request("recovery/prepare", body), context())).status).toBe(400);
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });

  it("authenticates recovery reads and mutations and only admits the existing explicit OIDC mode", async () => {
    mocks.auth.mockRejectedValue(new ApiError(401, "Missing authorization"));
    expect((await recoveryRead(new Request("https://leadflow-review.web.app/api/crm/warm-reconnect/qa/recovery/prepare") as never, context())).status).toBe(401);
    expect((await recoveryPrepare(request("recovery/prepare", { recipient, testOnly: true }), context())).status).toBe(401);
    expect((await recoverySend(request("recovery/send", valid), context())).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
    const header = { "x-warm-reconnect-auth": "worker_oidc" };
    expect((await recoveryPrepare(request("recovery/prepare", { recipient, testOnly: true }, header), context())).status).toBe(200);
    expect((await recoverySend(request("recovery/send", valid, header), context())).status).toBe(200);
    expect(mocks.worker).toHaveBeenCalledTimes(2);
    mocks.prepare.mockClear(); mocks.send.mockClear(); mocks.worker.mockResolvedValue({ mode: "legacy_token" });
    expect((await recoveryPrepare(request("recovery/prepare", { recipient, testOnly: true }, header), context())).status).toBe(403);
    expect((await recoverySend(request("recovery/send", valid, header), context())).status).toBe(403);
    expect((await recoverySend(request("recovery/send", valid, { "x-warm-reconnect-auth": "anything" }), context())).status).toBe(400);
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects queries, oversized JSON and non-JSON bodies before recovery actions", async () => {
    expect((await recoveryRead(new Request("https://leadflow-review.web.app/api/crm/warm-reconnect/qa/recovery/prepare?testId=other") as never, context())).status).toBe(400);
    for (const [handler, path, body] of [[recoveryPrepare, "recovery/prepare", { recipient, testOnly: true }], [recoverySend, "recovery/send", valid]] as const) {
      expect((await handler(request(`${path}?uid=other`, body), context())).status).toBe(400);
      expect((await handler(request(path, body, { "content-type": "text/plain" }), context())).status).toBe(415);
      expect((await handler(request(path, { ...body, padding: "x".repeat(1024) }), context())).status).toBe(413);
    }
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe("owner QA API authentication and exact action boundaries", () => {
  it("requires owner authentication before preparing; GET only reads", async () => {
    mocks.auth.mockRejectedValueOnce(new ApiError(401, "Missing authorization"));
    expect((await prepare(request("prepare", { recipient, testOnly: true }), context())).status).toBe(401);
    expect(mocks.prepare).not.toHaveBeenCalled();
    const result = await read(new Request("https://leadflow-review.web.app/api/crm/warm-reconnect/qa/prepare") as never, context());
    expect(result.status).toBe(200); expect(mocks.read).toHaveBeenCalledWith("owner");
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });

  it("supports only explicit existing OIDC mode and rejects legacy worker auth", async () => {
    const header = { "x-warm-reconnect-auth": "worker_oidc" };
    expect((await prepare(request("prepare", { recipient, testOnly: true }, header), context())).status).toBe(201);
    expect(mocks.prepare).toHaveBeenCalledWith({ uid: "owner", recipient, log: expect.anything() });
    expect(mocks.worker).toHaveBeenCalledTimes(1); expect(mocks.auth).not.toHaveBeenCalled();
    mocks.worker.mockResolvedValue({ mode: "legacy_token" }); mocks.prepare.mockClear();
    expect((await prepare(request("prepare", { recipient, testOnly: true }, header), context())).status).toBe(403);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect((await prepare(request("prepare", { recipient, testOnly: true }, { "x-warm-reconnect-auth": "anything" }), context())).status).toBe(400);
  });

  it.each([
    { recipient: "another@example.com", testOnly: true },
    { recipient, testOnly: false },
    { recipient, testOnly: true, from: "another@example.com" },
    { testOnly: true },
  ])("rejects widening preparation: %j", async (body) => {
    expect((await prepare(request("prepare", body), context())).status).toBe(400); expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("passes only a normalized, digest-validated recipient to preparation and send", async () => {
    const inputRecipient = "  OWNER-QA@EXAMPLE.TEST  ";
    expect((await prepare(request("prepare", { recipient: inputRecipient, testOnly: true }), context())).status).toBe(201);
    expect(mocks.prepare).toHaveBeenCalledWith({ uid: "owner", recipient, log: expect.anything() });
    expect((await send(request("send", { recipient: inputRecipient, artifactFingerprint: fingerprint, confirmSendOneTest: true }), context())).status).toBe(200);
    expect(mocks.send).toHaveBeenCalledWith({ uid: "owner", recipient, artifactFingerprint: fingerprint, confirmSendOneTest: true });
  });

  it("requires exact send confirmation and artifact fingerprint; rejects query and extra inputs", async () => {
    for (const body of [
      { recipient, artifactFingerprint: fingerprint },
      { recipient, artifactFingerprint: fingerprint, confirmSendOneTest: false },
      { recipient: "another@example.com", artifactFingerprint: fingerprint, confirmSendOneTest: true },
      { recipient, artifactFingerprint: fingerprint, confirmSendOneTest: true, recipientIds: ["production"] },
    ]) expect((await send(request("send", body), context())).status).toBe(400);
    expect((await send(request("send?uid=another", { recipient, artifactFingerprint: fingerprint, confirmSendOneTest: true }), context())).status).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
    const response = await send(request("send", { recipient, artifactFingerprint: fingerprint, confirmSendOneTest: true }), context());
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.send).toHaveBeenCalledWith({ uid: "owner", recipient, artifactFingerprint: fingerprint, confirmSendOneTest: true });
  });
});

describe("QA public links never mutate on scans", () => {
  it("keeps GET/HEAD inert with no capability reflection", async () => {
    for (const response of await Promise.all([preferenceGet(), preferenceHead(), unsubscribeGet(), unsubscribeHead()])) {
      expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
      expect(await response.text()).not.toContain(token);
    }
    expect(mocks.preference).not.toHaveBeenCalled(); expect(mocks.unsubscribe).not.toHaveBeenCalled();
  });

  it("allows read-only inspect and requires explicit nonce/request ID for mutation", async () => {
    const inspect = { action: "inspect", token };
    await preference(request("preferences", inspect)); expect(mocks.preference).toHaveBeenLastCalledWith(inspect);
    mocks.preference.mockClear();
    for (const body of [
      { action: "unsubscribe", token },
      { action: "unsubscribe", token, confirmationNonce: nonce },
      { action: "save_preferences", token, requestId: "id", topics: { rosser_gallery: true, rt_solutions: false } },
      { action: "inspect", token, extra: true },
    ]) await preference(request("preferences", body));
    expect(mocks.preference).not.toHaveBeenCalled();
    const save = { action: "save_preferences", token, requestId: "id", confirmationNonce: nonce, topics: { rosser_gallery: true, rt_solutions: false } };
    await preference(request("preferences", save)); expect(mocks.preference).toHaveBeenLastCalledWith(save);
  });

  it("rejects query tokens, oversized requests and malformed content", async () => {
    await preference(request(`preferences?token=${token}`, { action: "inspect", token }));
    await preference(request("preferences", { action: "inspect", token: "x".repeat(5000) }));
    await preference(request("preferences", { action: "inspect", token }, { "content-type": "text/plain" }));
    expect(mocks.preference).not.toHaveBeenCalled();
  });

  it("allows only exact RFC8058 POST for unsubscribe-only token and never logs token", async () => {
    const post = (body: string) => new Request(`https://leadflow-review.web.app/api/crm/warm-reconnect/qa/unsubscribe/${token}`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
    }) as never;
    await unsubscribe(post("List-Unsubscribe=One-Click&extra=true"), { params: Promise.resolve({ token }) });
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
    await unsubscribe(post("List-Unsubscribe=One-Click"), { params: Promise.resolve({ token }) });
    expect(mocks.unsubscribe).toHaveBeenCalledWith(token);
    mocks.unsubscribe.mockRejectedValue(new Error(`do-not-log-${token}`));
    const response = await unsubscribe(post("List-Unsubscribe=One-Click"), { params: Promise.resolve({ token }) });
    expect(await response.text()).not.toContain(token);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(token);
  });
});
