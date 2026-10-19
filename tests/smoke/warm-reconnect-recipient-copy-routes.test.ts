import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as createPilot } from "@/app/api/crm/warm-reconnect/pilots/route";
import { POST as approvePilot } from "@/app/api/crm/warm-reconnect/pilots/[pilotId]/approval/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/handler";
import { createWarmReconnectPilotForUid, decideWarmReconnectPilotApprovalForUid } from "@/lib/crm/warm-reconnect-repository";
import { warmReconnectRecipientCopyContentFingerprint } from "@/lib/crm/warm-reconnect-recipient-copy";

vi.mock("@/lib/api/auth", () => ({ requireFirebaseAuth: vi.fn() }));
vi.mock("@/lib/crm/warm-reconnect-repository", () => ({
  createWarmReconnectPilotForUid: vi.fn(), decideWarmReconnectPilotApprovalForUid: vi.fn(),
}));
const authMock = vi.mocked(requireFirebaseAuth);
const createMock = vi.mocked(createWarmReconnectPilotForUid);
const approvalMock = vi.mocked(decideWarmReconnectPilotApprovalForUid);
const sha = `sha256:${"a".repeat(64)}`;
const pilotId = `wrp_${"a".repeat(32)}`;
const baseUrl = "http://localhost/api/crm/warm-reconnect/pilots";

function recipientCopy(index = 1) {
  const copy = {
    version: "warm-reconnect-recipient-copy.v1" as const, recipientId: `recipient-${index}`,
    personId: `person-${index}`, contactPointId: `contact-${index}`, emailKey: sha, expectedCandidateFingerprint: sha,
    greetingName: "Sky Blue", openingParagraph: "It's Marcus Rosser. We met at a community workshop in May 2025.",
  };
  return { ...copy, expectedContentFingerprint: warmReconnectRecipientCopyContentFingerprint(copy) };
}

function body(count = 20) {
  return {
    idempotencyKey: "reviewed-copy-key", campaignPreviewFingerprint: sha,
    tranche: "follow_on", parentPilotId: `wrp_${"b".repeat(32)}`, batchSequence: 1, recipientCap: count,
    candidateRecipientIds: Array.from({ length: count }, (_, index) => `recipient-${index + 1}`),
    contentMode: "approved_design_v2",
    artworkEmailApproval: { approvedForThisEmailCampaign: true, evidenceNote: "The unchanged campaign artwork is approved for email." },
    sender: {
      senderName: "Marcus Rosser", legalEntity: "Marcus Rosser / Rosser Gallery", replyTo: "mrosser@rossergallery.com",
      physicalPostalAddress: "2505 N Tonti St, New Orleans, LA 70117", businessId: "rosser_nft_gallery", profileId: "rosser_gallery_send",
    },
    recipientCopies: [recipientCopy(2), recipientCopy(17)],
  };
}

function approval() {
  return {
    decision: "approve", expectedArtifactFingerprint: sha, expectedAudienceFingerprint: sha, expectedActionFingerprint: sha,
    expectedRecipientCopyReviewFingerprint: sha, approvalScope: "exact_batch_one_time_reconnection_emails",
    note: "Exact recipient messages reviewed for the synthetic batch.",
    confirmations: {
      senderLegalIdentityVerified: true, physicalPostalAddressVerified: true, preferencesAndUnsubscribeVerified: true,
      suppressionLedgerVerified: true, spfDkimDmarcVerified: true, replyToMonitored: true,
      artworkApprovedForEmail: true, exactAudienceReviewed: true, exactRecipientCopyReviewed: true,
    },
  };
}

function request(value: unknown, path = baseUrl) {
  return new Request(path, {
    method: "POST", headers: { authorization: "Bearer synthetic", "content-type": "application/json", "x-idempotency-key": "reviewed-copy-key", "x-correlation-id": "copy-route-test" },
    body: JSON.stringify(value),
  });
}
const context = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });

beforeEach(() => {
  vi.resetAllMocks();
  authMock.mockResolvedValue({ uid: "authenticated-owner" } as never);
  createMock.mockResolvedValue({ pilot: { pilotId, tranche: "follow_on" }, replayed: false } as never);
  approvalMock.mockResolvedValue({ pilot: { pilotId, status: "approved" }, replayed: false } as never);
});

describe("recipient-specific copy route boundaries", () => {
  it("preserves the complete exact recipient copy through authenticated creation without provider authority", async () => {
    const value = body();
    const response = await createPilot(request(value) as never, context());
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toMatchObject({ providerAction: false });
    expect(createMock).toHaveBeenCalledExactlyOnceWith({ uid: "authenticated-owner", request: value, correlationId: "copy-route-test", log: expect.any(Object) });
  });

  it("accepts the maximum twenty explicit copies inside the bounded body", async () => {
    const value = { ...body(), recipientCopies: Array.from({ length: 20 }, (_, index) => recipientCopy(index + 1)) };
    expect((await createPilot(request(value) as never, context())).status).toBe(201);
    expect(createMock.mock.calls[0][0].request.recipientCopies).toHaveLength(20);
  });

  it.each([
    { subject: "An unreviewed subject" }, { html: "<p>unreviewed</p>" }, { subscribe: true }, { workspaceId: "other-workspace" },
    { version: "warm-reconnect-recipient-copy.v2" }, { expectedContentFingerprint: undefined }, { expectedCandidateFingerprint: undefined },
    { personId: undefined }, { contactPointId: undefined }, { emailKey: undefined }, { greetingName: "<b>Sky</b>" },
    { openingParagraph: "An opening\nwith another paragraph" }, { openingParagraph: "Visit https://example.test" },
    { openingParagraph: "A".repeat(601) }, { greetingName: "A".repeat(81) },
  ])("rejects malformed or expanded recipient copy before repository work: %j", patch => {
    return createPilot(request({ ...body(), recipientCopies: [{ ...recipientCopy(), ...patch }] }) as never, context()).then(response => {
      expect(response.status).toBe(400);
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  it.each([
    [], [recipientCopy(1), recipientCopy(1)], [recipientCopy(21)],
    Array.from({ length: 21 }, (_, index) => recipientCopy(index + 1)),
  ].map(recipientCopies => ({ recipientCopies })))("rejects empty, duplicate, foreign, and oversized copy lists", async ({ recipientCopies }) => {
    expect((await createPilot(request({ ...body(), recipientCopies }) as never, context())).status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects copy applied to another content mode and retains existing uncustomized creation", async () => {
    expect((await createPilot(request({ ...body(), contentMode: "artwork_html" }) as never, context())).status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
    const legacy = { ...body(), recipientCopies: undefined };
    expect((await createPilot(request(legacy) as never, context())).status).toBe(201);
    expect(createMock.mock.calls[0][0].request).not.toHaveProperty("recipientCopies");
  });

  it("passes the exact-copy approval fingerprint and explicit confirmation intact", async () => {
    const value = approval();
    const response = await approvePilot(request(value, `${baseUrl}/${pilotId}/approval`) as never, context({ pilotId }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ providerAction: false });
    expect(approvalMock).toHaveBeenCalledExactlyOnceWith({ uid: "authenticated-owner", pilotId, request: value, correlationId: "copy-route-test", idempotencyKey: "reviewed-copy-key", log: expect.any(Object) });
  });

  it("rejects a false exact-copy confirmation or malformed review fingerprint", async () => {
    const value = approval();
    for (const invalid of [
      { ...value, confirmations: { ...value.confirmations, exactRecipientCopyReviewed: false } },
      { ...value, expectedRecipientCopyReviewFingerprint: "unbound-review" },
    ]) expect((await approvePilot(request(invalid) as never, context({ pilotId }))).status).toBe(400);
    expect(approvalMock).not.toHaveBeenCalled();
  });

  it("propagates pilot-aware rejection when exact-copy authority is missing", async () => {
    approvalMock.mockRejectedValue(new ApiError(409, "Review every exact recipient copy before approval."));
    const value = approval();
    const legacy = { ...value, expectedRecipientCopyReviewFingerprint: undefined, confirmations: { ...value.confirmations, exactRecipientCopyReviewed: undefined } };
    expect((await approvePilot(request(legacy) as never, context({ pilotId }))).status).toBe(409);
    expect(approvalMock).toHaveBeenCalledOnce();
  });

  it("authenticates before parsing copy and blocks caller workspace overrides", async () => {
    authMock.mockRejectedValueOnce(new ApiError(401, "Unauthorized"));
    expect((await createPilot(request(body(), `${baseUrl}?workspaceId=foreign`) as never, context())).status).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
    expect((await createPilot(request(body(), `${baseUrl}?workspaceId=foreign`) as never, context())).status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });
});
