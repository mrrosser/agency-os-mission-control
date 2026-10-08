import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createPilot } from "@/app/api/crm/warm-reconnect/pilots/route";
import { POST as approvePilot } from "@/app/api/crm/warm-reconnect/pilots/[pilotId]/approval/route";
import { POST as launchPilot } from "@/app/api/crm/warm-reconnect/pilots/[pilotId]/launch/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/handler";
import {
  createWarmReconnectPilotForUid,
  decideWarmReconnectPilotApprovalForUid,
  requestWarmReconnectPilotLaunchForUid,
} from "@/lib/crm/warm-reconnect-repository";

vi.mock("@/lib/api/auth", () => ({ requireFirebaseAuth: vi.fn() }));
vi.mock("@/lib/crm/warm-reconnect-repository", () => ({
  createWarmReconnectPilotForUid: vi.fn(),
  decideWarmReconnectPilotApprovalForUid: vi.fn(),
  requestWarmReconnectPilotLaunchForUid: vi.fn(),
}));

const authMock = vi.mocked(requireFirebaseAuth);
const createMock = vi.mocked(createWarmReconnectPilotForUid);
const approvalMock = vi.mocked(decideWarmReconnectPilotApprovalForUid);
const launchMock = vi.mocked(requestWarmReconnectPilotLaunchForUid);
const sha = `sha256:${"a".repeat(64)}`;
const pilotId = `wrp_${"a".repeat(32)}`;
const parentPilotId = `wrp_${"b".repeat(32)}`;
const baseUrl = "http://localhost/api/crm/warm-reconnect/pilots";

function followOnRequest(count = 2) {
  return {
    idempotencyKey: "follow-on-key-1",
    campaignPreviewFingerprint: sha,
    tranche: "follow_on",
    parentPilotId,
    batchSequence: 1,
    recipientCap: count,
    candidateRecipientIds: Array.from({ length: count }, (_, i) => `recipient-${i + 1}`),
    sender: {
      senderName: "Marcus Rosser", legalEntity: "Marcus Rosser / Rosser Gallery",
      replyTo: "mrosser@rossergallery.com", physicalPostalAddress: "2505 N Tonti St, New Orleans, LA 70117",
      businessId: "rosser_nft_gallery", profileId: "rosser_gallery_send",
    },
    contentMode: "approved_design_v2",
    artworkEmailApproval: { approvedForThisEmailCampaign: true, evidenceNote: "The same approved campaign artwork." },
  };
}

function approvalRequest() {
  return {
    decision: "approve",
    expectedArtifactFingerprint: sha, expectedAudienceFingerprint: sha, expectedActionFingerprint: sha,
    approvalScope: "exact_batch_one_time_reconnection_emails",
    confirmations: {
      senderLegalIdentityVerified: true, physicalPostalAddressVerified: true,
      preferencesAndUnsubscribeVerified: true, suppressionLedgerVerified: true,
      spfDkimDmarcVerified: true, replyToMonitored: true, artworkApprovedForEmail: true,
      exactAudienceReviewed: true,
    },
    note: "Approved for this exact follow-on batch.",
  };
}

function launchRequest() {
  return {
    approvalId: "approval-1", expectedArtifactFingerprint: sha,
    expectedAudienceFingerprint: sha, expectedActionFingerprint: sha,
    acknowledgeLaunchAuthorizesExactBatchEmailSend: true,
  };
}

function request(body: unknown, path = baseUrl, key = "follow-on-key-1") {
  return new Request(path, {
    method: "POST",
    headers: {
      authorization: "Bearer test", "content-type": "application/json",
      "x-idempotency-key": key, "x-correlation-id": "follow-on-correlation-1",
    },
    body: JSON.stringify(body),
  });
}

function context(params: Record<string, string> = { pilotId }) {
  return { params: Promise.resolve(params) };
}

describe("warm reconnect follow-on route contracts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    authMock.mockResolvedValue({ uid: "authenticated-owner" } as never);
    createMock.mockResolvedValue({ pilot: { pilotId, tranche: "follow_on" }, replayed: false } as never);
    approvalMock.mockResolvedValue({ pilot: { pilotId, status: "approved" }, replayed: false } as never);
    launchMock.mockResolvedValue({ pilot: { pilotId, status: "launch_requested" }, replayed: false } as never);
  });

  it.each(Array.from({ length: 10 }, (_, i) => i + 1))("accepts a distinct exact %i-recipient batch with predecessor binding", async (count) => {
    const body = followOnRequest(count);
    const response = await createPilot(request(body) as never, context({}));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toMatchObject({ providerAction: false, replayed: false });
    expect(createMock).toHaveBeenCalledExactlyOnceWith({
      uid: "authenticated-owner", request: body, correlationId: "follow-on-correlation-1", log: expect.any(Object),
    });
  });

  it.each([
    { candidateRecipientIds: ["recipient-1", "recipient-1"] },
    { candidateRecipientIds: ["recipient-1", " recipient-1 "] },
    { recipientCap: 3 }, { recipientCap: 0 }, { recipientCap: 11 }, { recipientCap: 1.5 },
    { parentPilotId: undefined }, { parentPilotId: "../other-pilot" },
    { batchSequence: undefined }, { batchSequence: 0 }, { batchSequence: 1.5 },
    { batchSequence: Number.MAX_SAFE_INTEGER + 1 },
    { workspaceId: "foreign-workspace" }, { uid: "foreign-owner" }, { unexpected: true },
  ])("rejects invalid or caller-expanded follow-on create fields %j", async (patch) => {
    const response = await createPilot(request({ ...followOnRequest(), ...patch }) as never, context({}));
    expect(response.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it.each([0, 11])("rejects %i distinct recipients beyond the follow-on bounds", async (count) => {
    const response = await createPilot(request(followOnRequest(count)) as never, context({}));
    expect(response.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("does not let initial-five creation carry follow-on authority fields", async () => {
    const response = await createPilot(request({ ...followOnRequest(5), tranche: "initial_5" }) as never, context({}));
    expect(response.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("preserves the create idempotency header binding", async () => {
    const response = await createPilot(request(followOnRequest(), baseUrl, "other-key") as never, context({}));
    expect(response.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("passes the exact batch approval scope to the pilot-aware domain check", async () => {
    const body = approvalRequest();
    const response = await approvePilot(request(body, `${baseUrl}/${pilotId}/approval`) as never, context());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ providerAction: false });
    expect(approvalMock).toHaveBeenCalledExactlyOnceWith({
      uid: "authenticated-owner", pilotId, request: body,
      correlationId: "follow-on-correlation-1", idempotencyKey: "follow-on-key-1", log: expect.any(Object),
    });
  });

  it("does not convert an initial-five approval scope into follow-on approval", async () => {
    approvalMock.mockRejectedValue(new ApiError(409, "The approval scope does not match the exact batch."));
    const body = { ...approvalRequest(), approvalScope: "exact_five_one_time_reconnection_emails" };
    const response = await approvePilot(request(body) as never, context());
    expect(response.status).toBe(409);
    expect(approvalMock).toHaveBeenCalledOnce();
    expect(approvalMock.mock.calls[0]?.[0].request).toEqual(body);
    expect(launchMock).not.toHaveBeenCalled();
  });

  it("rejects unknown approval scope or unreviewed audiences before domain work", async () => {
    const invalidScope = { ...approvalRequest(), approvalScope: "all_future_batches" };
    const invalidAudience = { ...approvalRequest(), confirmations: { ...approvalRequest().confirmations, exactAudienceReviewed: false } };
    for (const body of [invalidScope, invalidAudience]) {
      expect((await approvePilot(request(body) as never, context())).status).toBe(400);
    }
    expect(approvalMock).not.toHaveBeenCalled();
  });

  it("authorizes exactly the batch acknowledgement and retains the separate launch transition", async () => {
    const body = launchRequest();
    const response = await launchPilot(request(body, `${baseUrl}/${pilotId}/launch`) as never, context());
    expect(response.status).toBe(202);
    const result = await response.json();
    expect(result).toMatchObject({ providerAction: false, executionState: "launch_requested", exactBatchEmailExecutionAuthorized: true });
    expect(result).not.toHaveProperty("exactFiveEmailExecutionAuthorized");
    expect(launchMock).toHaveBeenCalledExactlyOnceWith({
      uid: "authenticated-owner", pilotId, request: body,
      correlationId: "follow-on-correlation-1", idempotencyKey: "follow-on-key-1", log: expect.any(Object),
    });
  });

  it("propagates the domain rejection of a legacy launch acknowledgement for a follow-on pilot", async () => {
    const { acknowledgeLaunchAuthorizesExactBatchEmailSend: _batchAcknowledgement, ...common } = launchRequest();
    const body = { ...common, acknowledgeLaunchAuthorizesExactFiveEmailSend: true };
    launchMock.mockRejectedValue(new ApiError(409, "The launch acknowledgement does not match this batch."));
    const response = await launchPilot(request(body) as never, context());
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("exactFiveEmailExecutionAuthorized");
    expect(launchMock).toHaveBeenCalledOnce();
    expect(launchMock.mock.calls[0]?.[0].request).toEqual(body);
  });

  it.each([
    { acknowledgeLaunchAuthorizesExactFiveEmailSend: true },
    { acknowledgeLaunchAuthorizesExactBatchEmailSend: false },
    { acknowledgeLaunchAuthorizesExactBatchEmailSend: undefined },
    { force: true }, { workspaceId: "foreign-workspace" }, { uid: "foreign-owner" },
  ])("rejects ambiguous, missing, or expanded launch authority %j", async (patch) => {
    expect((await launchPilot(request({ ...launchRequest(), ...patch }) as never, context())).status).toBe(400);
    expect(launchMock).not.toHaveBeenCalled();
  });

  it.each([
    { label: "create", route: createPilot, body: followOnRequest(), mock: createMock },
    { label: "approval", route: approvePilot, body: approvalRequest(), mock: approvalMock },
    { label: "launch", route: launchPilot, body: launchRequest(), mock: launchMock },
  ])("$label authenticates before interpreting caller state and rejects query workspace overrides", async ({ route, body, mock }) => {
    authMock.mockRejectedValueOnce(new ApiError(401, "Unauthorized"));
    expect((await route(request(body, `${baseUrl}?workspaceId=foreign-workspace`) as never, context())).status).toBe(401);
    expect(mock).not.toHaveBeenCalled();
    expect((await route(request(body, `${baseUrl}?workspaceId=foreign-workspace`) as never, context())).status).toBe(400);
    expect(mock).not.toHaveBeenCalled();
  });

  it.each([
    { label: "approval", route: approvePilot, body: approvalRequest(), mock: approvalMock },
    { label: "launch", route: launchPilot, body: launchRequest(), mock: launchMock },
  ])("$label rejects a caller-specified workspace route parameter", async ({ route, body, mock }) => {
    expect((await route(request(body) as never, context({ pilotId, workspaceId: "foreign-workspace" }))).status).toBe(400);
    expect(mock).not.toHaveBeenCalled();
  });
});
