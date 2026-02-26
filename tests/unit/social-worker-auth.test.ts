import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyIdTokenMock } = vi.hoisted(() => ({
  verifyIdTokenMock: vi.fn(),
}));

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken = verifyIdTokenMock;
  },
}));

import { authorizeSocialDraftWorker } from "@/lib/social/worker-auth";

function makeRequest(authorization?: string): Request {
  const headers = new Headers();
  if (authorization) headers.set("Authorization", authorization);
  return new Request("https://leadflow-review.web.app/api/social/drafts/rng-weekly/worker-task", {
    method: "POST",
    headers,
  });
}

describe("social draft worker auth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SOCIAL_DRAFT_WORKER_TOKEN;
    delete process.env.SOCIAL_DRAFT_WORKER_OIDC_SERVICE_ACCOUNT_EMAILS;
    delete process.env.SOCIAL_DRAFT_WORKER_OIDC_AUDIENCES;
    delete process.env.REVENUE_DAY30_WORKER_TOKEN;
    delete process.env.REVENUE_DAY2_WORKER_TOKEN;
    delete process.env.REVENUE_DAY1_WORKER_TOKEN;
    verifyIdTokenMock.mockReset();
  });

  it("allows matching worker token", async () => {
    process.env.SOCIAL_DRAFT_WORKER_TOKEN = "worker-token";
    await expect(
      authorizeSocialDraftWorker({
        request: makeRequest("Bearer worker-token"),
      })
    ).resolves.toBeUndefined();
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
  });

  it("allows valid scheduler OIDC token when service account allowlist is configured", async () => {
    process.env.SOCIAL_DRAFT_WORKER_OIDC_SERVICE_ACCOUNT_EMAILS =
      "social-drafts-scheduler@leadflow-review.iam.gserviceaccount.com";

    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        iss: "https://accounts.google.com",
        email: "social-drafts-scheduler@leadflow-review.iam.gserviceaccount.com",
      }),
    });

    await expect(
      authorizeSocialDraftWorker({
        request: makeRequest("Bearer oidc-token"),
      })
    ).resolves.toBeUndefined();
    expect(verifyIdTokenMock).toHaveBeenCalledOnce();
  });

  it("rejects invalid scheduler OIDC email", async () => {
    process.env.SOCIAL_DRAFT_WORKER_OIDC_SERVICE_ACCOUNT_EMAILS =
      "social-drafts-scheduler@leadflow-review.iam.gserviceaccount.com";

    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        iss: "https://accounts.google.com",
        email: "other-service@leadflow-review.iam.gserviceaccount.com",
      }),
    });

    await expect(
      authorizeSocialDraftWorker({
        request: makeRequest("Bearer oidc-token"),
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("fails closed when no worker auth is configured", async () => {
    await expect(
      authorizeSocialDraftWorker({
        request: makeRequest(),
      })
    ).rejects.toMatchObject({ status: 503 });
  });
});
