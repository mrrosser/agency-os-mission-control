import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { ApiError } from "@/lib/api/handler";
import { GET as getWorkspaces } from "@/app/api/application-desk/workspaces/route";
import { GET as getReviews } from "@/app/api/application-desk/reviews/route";
import { POST as importPrepared } from "@/app/api/application-desk/import-prepared/route";
import { POST as recordDecision } from "@/app/api/application-desk/reviews/[reviewId]/decision/route";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  forward: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/api/auth", () => ({
  requireFirebaseAuth: (...args: unknown[]) => mocks.requireAuth(...args),
}));

vi.mock("@/lib/application-desk-proxy", () => ({
  forwardApplicationDeskRequest: (...args: unknown[]) => mocks.forward(...args),
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => mocks.log,
  getCorrelationId: (request: NextRequest) =>
    request.headers.get("x-correlation-id") || "corr-generated",
  sanitizeError: (error: unknown) => ({
    name: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : "Unknown error",
  }),
}));

function context(params: Record<string, string> = {}) {
  return { params: Promise.resolve(params) };
}

interface TestRequestInit {
  method?: string;
  body?: BodyInit | null;
  headers?: Record<string, string>;
}

function request(path: string, init: TestRequestInit = {}): NextRequest {
  const { headers, ...requestInit } = init;
  return new NextRequest(`http://localhost${path}`, {
    ...requestInit,
    headers: {
      authorization: "Bearer firebase-id-token",
      "x-correlation-id": "corr-route",
      "x-workspace-id": "ws_cd43331c4b1648d0",
      ...(headers || {}),
    },
  });
}

describe("Application Desk same-origin adapter routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({
      uid: "DM5ZZngePXXhNgN85Afi7W4Knoz2",
      email: "owner@example.com",
    });
    mocks.forward.mockResolvedValue(
      NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } }),
    );
  });

  it("fails closed locally when Firebase authentication rejects", async () => {
    mocks.requireAuth.mockRejectedValueOnce(new ApiError(401, "Invalid ID token"));
    const response = await getWorkspaces(
      request("/api/application-desk/workspaces"),
      context() as never,
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe("Invalid ID token");
    expect(mocks.forward).not.toHaveBeenCalled();
  });

  it("maps the workspace and review list routes to fixed read-only upstream paths", async () => {
    const workspaceRequest = request("/api/application-desk/workspaces");
    expect(
      (
        await getWorkspaces(workspaceRequest, context() as never)
      ).status,
    ).toBe(200);
    expect(mocks.forward).toHaveBeenLastCalledWith({
      request: workspaceRequest,
      path: "/api/workspaces",
      method: "GET",
      correlationId: "corr-route",
      log: mocks.log,
    });

    const reviewRequest = request("/api/application-desk/reviews");
    expect((await getReviews(reviewRequest, context() as never)).status).toBe(200);
    expect(mocks.forward).toHaveBeenLastCalledWith({
      request: reviewRequest,
      path: "/api/artist-manager/application-reviews",
      method: "GET",
      correlationId: "corr-route",
      log: mocks.log,
      requireWorkspace: true,
    });
  });

  it("maps only the bounded prepared-import POST", async () => {
    const importRequest = request("/api/application-desk/import-prepared", {
      method: "POST",
      body: JSON.stringify({ dryRun: true }),
    });
    expect((await importPrepared(importRequest, context() as never)).status).toBe(200);
    expect(mocks.forward).toHaveBeenLastCalledWith({
      request: importRequest,
      path: "/api/artist-manager/application-reviews/import-prepared",
      method: "POST",
      correlationId: "corr-route",
      log: mocks.log,
      maxRequestBytes: 256,
      requireWorkspace: true,
    });

    mocks.forward.mockClear();
    const rtImport = request("/api/application-desk/import-prepared", {
      method: "POST",
      headers: { "x-workspace-id": "ws_ee1735c095774325" },
      body: JSON.stringify({ dryRun: true }),
    });
    expect((await importPrepared(rtImport, context() as never)).status).toBe(403);
    expect(mocks.forward).not.toHaveBeenCalled();
  });

  it("validates the review id and maps a fingerprint-bound decision POST", async () => {
    const reviewId = "application_review_aaaaaaaaaaaaaaaaaaaaaaaa";
    const decisionRequest = request(
      `/api/application-desk/reviews/${reviewId}/decision`,
      {
        method: "POST",
        body: JSON.stringify({
          opportunityId: "opp_water_connects_us",
          decisionId: "decision_unique_1234",
          decisionKind: "approve_for_preparation",
          expectedReviewRoundId: "review_round_bbbbbbbbbbbbbbbbbbbbbbbb",
          expectedActionFingerprint: `sha256:${"c".repeat(64)}`,
          expectedArtifactFingerprint: `sha256:${"d".repeat(64)}`,
          expectedLatestDecisionId: null,
        }),
      },
    );

    expect(
      (
        await recordDecision(
          decisionRequest,
          context({ reviewId }) as never,
        )
      ).status,
    ).toBe(200);
    expect(mocks.forward).toHaveBeenLastCalledWith({
      request: decisionRequest,
      path: `/api/artist-manager/application-reviews/${reviewId}/decision`,
      method: "POST",
      correlationId: "corr-route",
      log: mocks.log,
      maxRequestBytes: 12 * 1024,
      requireWorkspace: true,
    });

    mocks.forward.mockClear();
    const rtDecision = request(
      `/api/application-desk/reviews/${reviewId}/decision`,
      {
        method: "POST",
        headers: { "x-workspace-id": "ws_ee1735c095774325" },
        body: "{}",
      },
    );
    expect(
      (
        await recordDecision(rtDecision, context({ reviewId }) as never)
      ).status,
    ).toBe(200);
    expect(mocks.forward).toHaveBeenLastCalledWith({
      request: rtDecision,
      path: `/api/artist-manager/application-reviews/${reviewId}/decision`,
      method: "POST",
      correlationId: "corr-route",
      log: mocks.log,
      maxRequestBytes: 12 * 1024,
      requireWorkspace: true,
    });

    mocks.forward.mockClear();
    const malformed = await recordDecision(
      decisionRequest,
      context({ reviewId: "../../foreign-review" }) as never,
    );
    expect(malformed.status).toBe(404);
    expect(mocks.forward).not.toHaveBeenCalled();
  });
});
