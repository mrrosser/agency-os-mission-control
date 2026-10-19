import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getActivation } from "@/app/api/crm/warm-reconnect/activation/route";
import { POST as postPilot } from "@/app/api/crm/warm-reconnect/pilots/route";
import { POST as postDecision } from "@/app/api/crm/warm-reconnect/pilots/[pilotId]/recipients/[recipientId]/decision/route";
import { POST as postApproval } from "@/app/api/crm/warm-reconnect/pilots/[pilotId]/approval/route";
import { POST as postLaunch } from "@/app/api/crm/warm-reconnect/pilots/[pilotId]/launch/route";
import { POST as postStop } from "@/app/api/crm/warm-reconnect/pilots/[pilotId]/stop/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/handler";
import {
  createWarmReconnectPilotForUid,
  decideWarmReconnectPilotApprovalForUid,
  decideWarmReconnectRecipientForUid,
  loadWarmReconnectActivationForUid,
  requestWarmReconnectPilotLaunchForUid,
  stopWarmReconnectPilotForUid,
} from "@/lib/crm/warm-reconnect-repository";

vi.mock("@/lib/api/auth", () => ({ requireFirebaseAuth: vi.fn() }));
vi.mock("@/lib/crm/warm-reconnect-repository", () => ({
  loadWarmReconnectActivationForUid: vi.fn(),
  createWarmReconnectPilotForUid: vi.fn(),
  decideWarmReconnectRecipientForUid: vi.fn(),
  decideWarmReconnectPilotApprovalForUid: vi.fn(),
  requestWarmReconnectPilotLaunchForUid: vi.fn(),
  stopWarmReconnectPilotForUid: vi.fn(),
}));

const authMock = vi.mocked(requireFirebaseAuth);
const loadMock = vi.mocked(loadWarmReconnectActivationForUid);
const createMock = vi.mocked(createWarmReconnectPilotForUid);
const decisionMock = vi.mocked(decideWarmReconnectRecipientForUid);
const approvalMock = vi.mocked(decideWarmReconnectPilotApprovalForUid);
const launchMock = vi.mocked(requestWarmReconnectPilotLaunchForUid);
const stopMock = vi.mocked(stopWarmReconnectPilotForUid);
const sha = `sha256:${"a".repeat(64)}`;

function context(params: Record<string, string> = {}) {
  return { params: Promise.resolve(params) };
}

function jsonRequest(url: string, body: unknown, idempotencyKey?: string) {
  const bodyKey =
    typeof body === "object" && body !== null && "idempotencyKey" in body
      ? String((body as { idempotencyKey: unknown }).idempotencyKey)
      : null;
  return new Request(url, {
    method: "POST",
    headers: {
      authorization: "Bearer test",
      "content-type": "application/json",
      "x-correlation-id": "warm-activation-cid",
      "x-idempotency-key": idempotencyKey || bodyKey || "1",
    },
    body: JSON.stringify(body),
  });
}

const pilot = {
  pilotId: "pilot-1",
  status: "approved",
  availableActions: { canLaunch: true, launchAuthorizesExactProviderExecution: true },
};

const pilotRequest = {
  idempotencyKey: "pilot-key-1",
  campaignPreviewFingerprint: sha,
  tranche: "initial_5",
  recipientCap: 5,
  candidateRecipientIds: ["r1", "r2", "r3", "r4", "r5"],
  sender: {
    senderName: "Marcus Rosser",
    legalEntity: "Rosser Gallery LLC",
    replyTo: "marcus@example.com",
    physicalPostalAddress: "2505 N Tonti St, New Orleans, LA 70117",
    businessId: "rosser_nft_gallery",
    profileId: "rosser_gallery_send",
  },
  artworkEmailApproval: {
    approvedForThisEmailCampaign: true,
    evidenceNote: "Approved for this exact email campaign.",
  },
};

describe("warm reconnect activation routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ uid: "owner-1" } as never);
    loadMock.mockResolvedValue({ schemaVersion: "crm.warm-reconnect-activation.v1" } as never);
    createMock.mockResolvedValue({ pilot, replayed: false } as never);
    decisionMock.mockResolvedValue({ pilot, replayed: false } as never);
    approvalMock.mockResolvedValue({ pilot, replayed: false } as never);
    launchMock.mockResolvedValue({
      pilot: { ...pilot, status: "launch_requested" },
      replayed: false,
    } as never);
    stopMock.mockResolvedValue({
      pilot: { ...pilot, status: "stopped" },
      replayed: false,
    } as never);
  });

  it("requires artwork approval for the approved v2 design before preparing a pilot", async () => {
    const body = { ...pilotRequest, contentMode: "approved_design_v2" };
    const rejected = await postPilot(jsonRequest("http://localhost/api/crm/warm-reconnect/pilots", { ...body, artworkEmailApproval: undefined }) as never, context() as never);
    expect(rejected.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
    const accepted = await postPilot(jsonRequest("http://localhost/api/crm/warm-reconnect/pilots", body) as never, context() as never);
    expect(accepted.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ contentMode: "approved_design_v2", artworkEmailApproval: body.artworkEmailApproval }) }));
    expect(await accepted.json()).toMatchObject({ providerAction: false });
  });

  it("accepts preference buttons only without artwork approval", async () => {
    const body = { ...pilotRequest, contentMode: "preference_buttons", artworkEmailApproval: undefined };
    const accepted = await postPilot(jsonRequest("http://localhost/api/crm/warm-reconnect/pilots", body) as never, context() as never);
    expect(accepted.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ contentMode: "preference_buttons" }) }));
    const rejected = await postPilot(jsonRequest("http://localhost/api/crm/warm-reconnect/pilots", { ...body, artworkEmailApproval: pilotRequest.artworkEmailApproval }) as never, context() as never);
    expect(rejected.status).toBe(400);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("returns authenticated activation data with private no-store headers", async () => {
    const response = await getActivation(
      new Request("http://localhost/api/crm/warm-reconnect/activation", {
        headers: { authorization: "Bearer test", "x-correlation-id": "cid" },
      }) as never,
      context() as never
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("x-correlation-id")).toBe("cid");
    expect(loadMock).toHaveBeenCalledWith("owner-1", expect.anything(), undefined, { historyAfter: undefined });
  });

  it("passes only the authenticated owner's validated history cursor without changing execution routes", async () => {
    const cursor = "wrp_0123456789abcdef0123456789abcdef";
    const response = await getActivation(new Request(`http://localhost/api/crm/warm-reconnect/activation?historyAfter=${cursor}`) as never, context() as never);
    expect(response.status).toBe(200);
    expect(loadMock).toHaveBeenCalledExactlyOnceWith("owner-1", expect.anything(), undefined, { historyAfter: cursor });
    expect(createMock).not.toHaveBeenCalled();
    expect(launchMock).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it.each(["historyAfter=", "historyAfter=a&historyAfter=b", "historyAfter=a%2Fb", "historyAfter=..", "historyAfter=" + "x".repeat(201), "historyAfter=a&ownerUid=other", "limit=1000"])("rejects unsupported or unsafe history parameters: %s", async query => {
    const response = await getActivation(new Request(`http://localhost/api/crm/warm-reconnect/activation?${query}`) as never, context() as never);
    expect(response.status).toBe(400);
    expect(loadMock).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("requires Firebase authentication before any history read or cursor validation", async () => {
    authMock.mockRejectedValueOnce(new ApiError(401, "Authentication required"));
    const response = await getActivation(new Request("http://localhost/api/crm/warm-reconnect/activation?historyAfter=bad%2Fpath") as never, context() as never);
    expect(response.status).toBe(401);
    expect(loadMock).not.toHaveBeenCalled();
  });

  it("preserves the repository owner-role rejection for a history read", async () => {
    loadMock.mockRejectedValueOnce(new ApiError(403, "Owner access required"));
    const response = await getActivation(new Request("http://localhost/api/crm/warm-reconnect/activation?historyAfter=pilot-1") as never, context() as never);
    expect(response.status).toBe(403);
    expect(loadMock).toHaveBeenCalledExactlyOnceWith("owner-1", expect.anything(), undefined, { historyAfter: "pilot-1" });
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("accepts only a strict exact-five pilot request", async () => {
    const body = pilotRequest;
    const response = await postPilot(
      jsonRequest("http://localhost/api/crm/warm-reconnect/pilots", body) as never,
      context() as never
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ providerAction: false, replayed: false });
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ uid: "owner-1", request: body })
    );

    const invalid = await postPilot(
      jsonRequest("http://localhost/api/crm/warm-reconnect/pilots", {
        ...body,
        unexpected: true,
      }) as never,
      context() as never
    );
    expect(invalid.status).toBe(400);
    expect(createMock).toHaveBeenCalledTimes(1);

    const mismatchedKey = await postPilot(
      jsonRequest(
        "http://localhost/api/crm/warm-reconnect/pilots",
        body,
        "different-pilot-key"
      ) as never,
      context() as never
    );
    expect(mismatchedKey.status).toBe(400);

    const declaredOversize = await postPilot(
      new Request("http://localhost/api/crm/warm-reconnect/pilots", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
          "content-length": String(32 * 1024 + 1),
          "x-idempotency-key": "pilot-key-1",
        },
        body: "{}",
      }) as never,
      context() as never
    );
    expect(declaredOversize.status).toBe(413);

    const actualOversize = await postPilot(
      new Request("http://localhost/api/crm/warm-reconnect/pilots", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
          "x-idempotency-key": "pilot-key-1",
        },
        body: JSON.stringify({ ...body, oversized: "x".repeat(33 * 1024) }),
      }) as never,
      context() as never
    );
    expect(actualOversize.status).toBe(413);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("accepts explicit plain text with the RT send profile and no artwork approval", async () => {
    const body = {
      ...pilotRequest,
      contentMode: "plain_text",
      artworkEmailApproval: undefined,
      sender: {
        ...pilotRequest.sender,
        legalEntity: "RT Solutions LLC",
        businessId: "rt_solutions",
        profileId: "rt_solutions_send",
      },
    };
    const response = await postPilot(
      jsonRequest("http://localhost/api/crm/warm-reconnect/pilots", body) as never,
      context() as never
    );

    expect(response.status).toBe(201);
    expect(createMock).toHaveBeenCalledOnce();
    expect(createMock.mock.calls[0]?.[0].request).toMatchObject({
      contentMode: "plain_text",
      sender: { businessId: "rt_solutions", profileId: "rt_solutions_send" },
    });
    expect(createMock.mock.calls[0]?.[0].request).not.toHaveProperty("artworkEmailApproval");
  });

  it.each([undefined, "artwork_html"])(
    "rejects missing artwork approval in legacy or explicit artwork mode: %s",
    async (contentMode) => {
      const response = await postPilot(
        jsonRequest("http://localhost/api/crm/warm-reconnect/pilots", {
          ...pilotRequest,
          contentMode,
          artworkEmailApproval: undefined,
        }) as never,
        context() as never
      );

      expect(response.status).toBe(400);
      expect(createMock).not.toHaveBeenCalled();
    }
  );

  it("rejects an artwork approval supplied with plain-text mode", async () => {
    const response = await postPilot(
      jsonRequest("http://localhost/api/crm/warm-reconnect/pilots", {
        ...pilotRequest,
        contentMode: "plain_text",
      }) as never,
      context() as never
    );

    expect(response.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it.each(["plain", "", null])("rejects an invalid content mode: %s", async (contentMode) => {
    const response = await postPilot(
      jsonRequest("http://localhost/api/crm/warm-reconnect/pilots", {
        ...pilotRequest,
        contentMode,
      }) as never,
      context() as never
    );

    expect(response.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("passes approval without artwork confirmation to the pilot-aware domain check", async () => {
    const body = {
      decision: "approve",
      expectedArtifactFingerprint: sha,
      expectedAudienceFingerprint: sha,
      expectedActionFingerprint: sha,
      approvalScope: "exact_five_one_time_reconnection_emails",
      confirmations: {
        senderLegalIdentityVerified: true,
        physicalPostalAddressVerified: true,
        preferencesAndUnsubscribeVerified: true,
        suppressionLedgerVerified: true,
        spfDkimDmarcVerified: true,
        replyToMonitored: true,
        exactAudienceReviewed: true,
      },
      note: "Approved for this exact plain-text pilot.",
    };
    const response = await postApproval(
      jsonRequest("http://localhost/approval", body) as never,
      context({ pilotId: "pilot-1" }) as never
    );

    expect(response.status).toBe(200);
    expect(approvalMock).toHaveBeenCalledWith(
      expect.objectContaining({ uid: "owner-1", pilotId: "pilot-1", request: body })
    );
  });

  it("exposes distinct review, approval, launch-request, and stop transitions", async () => {
    const decision = await postDecision(
      jsonRequest("http://localhost/decision", {
        decision: "attest_relationship",
        expectedCandidateFingerprint: sha,
        personallyRecognizedRelationship: true,
        oneTimeReconnectionInvitationOnly: true,
        sourceEvidenceRefs: ["crm_source_records/source-1"],
        note: "Recognized relationship for one invitation.",
      }) as never,
      context({ pilotId: "pilot-1", recipientId: "recipient-1" }) as never
    );
    expect(decision.status).toBe(200);

    const approval = await postApproval(
      jsonRequest("http://localhost/approval", {
        decision: "approve",
        expectedArtifactFingerprint: sha,
        expectedAudienceFingerprint: sha,
        expectedActionFingerprint: sha,
        approvalScope: "exact_five_one_time_reconnection_emails",
        confirmations: {
          senderLegalIdentityVerified: true,
          physicalPostalAddressVerified: true,
          preferencesAndUnsubscribeVerified: true,
          suppressionLedgerVerified: true,
          spfDkimDmarcVerified: true,
          replyToMonitored: true,
          artworkApprovedForEmail: true,
          exactAudienceReviewed: true,
        },
        note: "Approved for this exact pilot.",
      }) as never,
      context({ pilotId: "pilot-1" }) as never
    );
    expect(approval.status).toBe(200);

    const launch = await postLaunch(
      jsonRequest("http://localhost/launch", {
        approvalId: "approval-1",
        expectedArtifactFingerprint: sha,
        expectedAudienceFingerprint: sha,
        expectedActionFingerprint: sha,
        acknowledgeLaunchAuthorizesExactFiveEmailSend: true,
      }) as never,
      context({ pilotId: "pilot-1" }) as never
    );
    expect(launch.status).toBe(202);
    expect(await launch.json()).toMatchObject({
      providerAction: false,
      executionState: "launch_requested",
    });

    const stop = await postStop(
      jsonRequest("http://localhost/stop", { reason: "Operator stopped the pilot." }) as never,
      context({ pilotId: "pilot-1" }) as never
    );
    expect(stop.status).toBe(200);
    expect(launchMock).toHaveBeenCalledTimes(1);
    expect(stopMock).toHaveBeenCalledTimes(1);
  });
});
