import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  requireFirebaseAuthMock,
  beginDisconnectMock,
  finishDisconnectMock,
} = vi.hoisted(() => ({
  requireFirebaseAuthMock: vi.fn(),
  beginDisconnectMock: vi.fn(),
  finishDisconnectMock: vi.fn(),
}));

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: requireFirebaseAuthMock,
}));
vi.mock("@/lib/google/account-token-store", () => ({
  beginGoogleAccountProfileDisconnect: beginDisconnectMock,
  finishGoogleAccountProfileDisconnect: finishDisconnectMock,
}));

import { POST } from "@/app/api/google/disconnect/route";

const OPERATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function request(body: Record<string, unknown>) {
  return new NextRequest("https://leadflow-review.web.app/api/google/disconnect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Google profile disconnect route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireFirebaseAuthMock.mockResolvedValue({ uid: "uid-123" });
    beginDisconnectMock.mockResolvedValue({
      profileId: "rt_solutions_work",
      accountId: "profile-rt_solutions_work",
      operationId: OPERATION_ID,
      localCredentialDeletionRequired: true,
    });
    finishDisconnectMock.mockResolvedValue(undefined);
  });

  it("removes only the selected local profile without provider-wide revocation", async () => {
    const response = await POST(request({
      businessId: "rt_solutions",
      profileId: "rt_solutions_work",
    }), {} as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      businessId: "rt_solutions",
      profileId: "rt_solutions_work",
      disconnectScope: "local_profile_only",
      providerRevocationAttempted: false,
    });
    expect(beginDisconnectMock).toHaveBeenCalledWith(
      "uid-123",
      "rt_solutions_work"
    );
    expect(finishDisconnectMock).toHaveBeenCalledWith(
      "uid-123",
      "rt_solutions_work",
      "profile-rt_solutions_work",
      OPERATION_ID
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("preserves a local account still shared by another legacy profile", async () => {
    beginDisconnectMock.mockResolvedValue({
      profileId: "rt_solutions_work",
      accountId: "shared-account",
      operationId: null,
      localCredentialDeletionRequired: false,
    });
    const response = await POST(request({
      businessId: "rt_solutions",
      profileId: "rt_solutions_work",
    }), {} as never);
    expect(response.status).toBe(200);
    expect(finishDisconnectMock).not.toHaveBeenCalled();
  });

  it("rejects no-context and mismatched disconnect requests", async () => {
    const missing = await POST(request({}), {} as never);
    const mismatch = await POST(request({
      businessId: "rt_solutions",
      profileId: "rosser_gallery_work",
    }), {} as never);
    expect(missing.status).toBe(400);
    expect(mismatch.status).toBe(400);
    expect(beginDisconnectMock).not.toHaveBeenCalled();
  });
});
