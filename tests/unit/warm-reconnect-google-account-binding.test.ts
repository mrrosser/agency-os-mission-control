import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveGoogleAccountTokensMock, getAccessTokenForUserMock } = vi.hoisted(
  () => ({
    resolveGoogleAccountTokensMock: vi.fn(),
    getAccessTokenForUserMock: vi.fn(),
  })
);

vi.mock("@/lib/google/account-token-store", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/google/account-token-store")
  >("@/lib/google/account-token-store");
  return {
    ...actual,
    resolveGoogleAccountTokens: resolveGoogleAccountTokensMock,
  };
});

vi.mock("@/lib/google/oauth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/google/oauth")>(
    "@/lib/google/oauth"
  );
  return {
    ...actual,
    getAccessTokenForUser: getAccessTokenForUserMock,
  };
});

import { createWarmReconnectPilot } from "@/lib/crm/warm-reconnect-activation";
import type { WarmReconnectCandidate } from "@/lib/crm/warm-reconnect-activation-types";
import { resolveWarmReconnectGmailAccessToken } from "@/lib/crm/warm-reconnect-executor";

const PREVIEW_FINGERPRINT = `sha256:${"a".repeat(64)}`;
const EXACT_SEND_SCOPE = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.send",
].join(" ");

function candidate(index: number): WarmReconnectCandidate {
  return {
    recipientId: `recipient-${index}`,
    personId: `person-${index}`,
    contactPointId: `contact-${index}`,
    displayName: `Person ${index}`,
    email: `person${index}@example.com`,
    emailKey: `sha256:${String(index).padStart(64, "0")}`,
    permissionState: "unknown",
    permissionRemainsExplicit: true,
    sourceEvidence: [
      {
        evidenceRef: `crm_source_records/source-${index}`,
        sourceSystem: "google_people",
        permissionBasis: "none",
        observedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    candidateFingerprint: `sha256:${index.toString(16).padStart(64, "0")}`,
    reviewStatus: "requires_operator_attestation",
  };
}

function pilot() {
  return createWarmReconnectPilot({
    pilotId: "wrp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    workspaceId: "workspace-1",
    ownerUid: "owner-1",
    legacyDncOrgId: "org-1",
    request: {
      idempotencyKey: "account-binding-test",
      campaignPreviewFingerprint: PREVIEW_FINGERPRINT,
      tranche: "initial_5",
      recipientCap: 5,
      candidateRecipientIds: [
        "recipient-1",
        "recipient-2",
        "recipient-3",
        "recipient-4",
        "recipient-5",
      ],
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
    },
    candidates: [1, 2, 3, 4, 5].map(candidate),
    googleReady: true,
    fromEmail: "marcus@example.com",
    accountId: "google-account-approved",
    preferenceOrigin: "https://leadflow-review.web.app",
  });
}

function resolution(accountId: string) {
  return {
    registryFound: true,
    profileMapped: true,
    record: {
      accountId,
      profileId: "rosser_gallery_work",
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        accountEmail: "marcus@example.com",
        scope: EXACT_SEND_SCOPE,
      },
    },
  };
}

describe("warm reconnect approved Google account binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns access only when the opaque account binding remains exact", async () => {
    resolveGoogleAccountTokensMock.mockResolvedValue(
      resolution("google-account-approved")
    );
    getAccessTokenForUserMock.mockResolvedValue("provider-access-token");

    await expect(
      resolveWarmReconnectGmailAccessToken({ uid: "owner-1", pilot: pilot() })
    ).resolves.toBe("provider-access-token");
    expect(resolveGoogleAccountTokensMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a different Google subject binding even when profile and email match", async () => {
    resolveGoogleAccountTokensMock.mockResolvedValue(
      resolution("google-account-different-subject")
    );

    await expect(
      resolveWarmReconnectGmailAccessToken({ uid: "owner-1", pilot: pilot() })
    ).rejects.toThrow(/exact approved Google sending account/i);
    expect(getAccessTokenForUserMock).not.toHaveBeenCalled();
  });

  it("rechecks the binding after token refresh and rejects mid-flight account drift", async () => {
    resolveGoogleAccountTokensMock
      .mockResolvedValueOnce(resolution("google-account-approved"))
      .mockResolvedValueOnce(resolution("google-account-different-subject"));
    getAccessTokenForUserMock.mockResolvedValue("provider-access-token");

    await expect(
      resolveWarmReconnectGmailAccessToken({ uid: "owner-1", pilot: pilot() })
    ).rejects.toThrow(/exact approved Google sending account/i);
    expect(getAccessTokenForUserMock).toHaveBeenCalledOnce();
  });
});
