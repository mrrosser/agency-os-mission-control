import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getActivation } from "@/app/api/crm/warm-reconnect/activation/route";
import { POST as postPilot } from "@/app/api/crm/warm-reconnect/pilots/route";
import { POST as postDecision } from "@/app/api/crm/warm-reconnect/pilots/[pilotId]/recipients/[recipientId]/decision/route";
import { POST as postApproval } from "@/app/api/crm/warm-reconnect/pilots/[pilotId]/approval/route";
import { POST as postLaunch } from "@/app/api/crm/warm-reconnect/pilots/[pilotId]/launch/route";
import { POST as postStop } from "@/app/api/crm/warm-reconnect/pilots/[pilotId]/stop/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
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
    expect(loadMock).toHaveBeenCalledWith("owner-1", expect.anything());
  });

  it("accepts only a strict exact-five pilot request", async () => {
    const body = {
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
        profileId: "rosser_gallery_work",
      },
      artworkEmailApproval: {
        approvedForThisEmailCampaign: true,
        evidenceNote: "Approved for this exact email campaign.",
      },
    };
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
