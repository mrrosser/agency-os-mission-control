import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireFirebaseAuthMock, setGoogleDefaultProfileIdMock } = vi.hoisted(
  () => ({
    requireFirebaseAuthMock: vi.fn(),
    setGoogleDefaultProfileIdMock: vi.fn(),
  })
);

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: requireFirebaseAuthMock,
}));

vi.mock("@/lib/google/account-token-store", () => ({
  setGoogleDefaultProfileId: setGoogleDefaultProfileIdMock,
}));

import { POST } from "@/app/api/google/default-profile/route";

function request(body: Record<string, unknown>, query = "") {
  return new NextRequest(
    `https://leadflow-review.web.app/api/google/default-profile${query}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("Google default profile route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireFirebaseAuthMock.mockResolvedValue({ uid: "uid-123" });
    setGoogleDefaultProfileIdMock.mockResolvedValue("rosser_gallery_work");
  });

  it("selects only the exact canonical organization profile", async () => {
    const response = await POST(
      request({
        businessId: "rosser_nft_gallery",
        profileId: "rosser_gallery_work",
      }),
      {} as never
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      businessId: "rosser_nft_gallery",
      profileId: "rosser_gallery_work",
    });
    expect(setGoogleDefaultProfileIdMock).toHaveBeenCalledOnce();
    expect(setGoogleDefaultProfileIdMock).toHaveBeenCalledWith(
      "uid-123",
      "rosser_gallery_work"
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects mismatched context, extra fields, and query parameters", async () => {
    const mismatched = await POST(
      request({
        businessId: "rt_solutions",
        profileId: "rosser_gallery_work",
      }),
      {} as never
    );
    const extraField = await POST(
      request({
        businessId: "rt_solutions",
        profileId: "rt_solutions_work",
        accountId: "attacker-selected-account",
      }),
      {} as never
    );
    const withQuery = await POST(
      request(
        {
          businessId: "rt_solutions",
          profileId: "rt_solutions_work",
        },
        "?profileId=rosser_gallery_work"
      ),
      {} as never
    );

    expect(mismatched.status).toBe(400);
    expect(extraField.status).toBe(400);
    expect(withQuery.status).toBe(400);
    expect(setGoogleDefaultProfileIdMock).not.toHaveBeenCalled();
  });

  it("fails closed when the selected profile is unmapped or changing", async () => {
    setGoogleDefaultProfileIdMock.mockRejectedValue(
      new Error("Google account profile needs to be reconnected")
    );

    const response = await POST(
      request({
        businessId: "rt_solutions",
        profileId: "rt_solutions_work",
      }),
      {} as never
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "That Google organization profile is not ready.",
    });
  });
});
