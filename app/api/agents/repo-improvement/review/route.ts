import { NextResponse } from "next/server";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { recordRepoImprovementReview } from "@/lib/repo-improvement";
import { RepoImprovementReviewRequestSchema } from "@/lib/repo-improvement-contract";

export const runtime = "nodejs";

function parseAllowedUids(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  );
}

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const body = await request.json().catch(() => ({}));
    const parsed = RepoImprovementReviewRequestSchema.safeParse(body || {});
    if (!parsed.success) {
      throw new ApiError(400, "Invalid payload", { issues: parsed.error.issues });
    }

    const allowedUids = parseAllowedUids(
      process.env.REPO_IMPROVEMENT_REVIEW_ALLOWED_UIDS
    );
    if (allowedUids.size > 0 && !allowedUids.has(user.uid)) {
      throw new ApiError(403, "Forbidden");
    }

    const payload = parsed.data;
    const idempotencyKey = getIdempotencyKey(request, payload);
    const reviewer =
      typeof user.email === "string" && user.email.trim().length > 0
        ? user.email.trim()
        : user.uid;

    const result = await withIdempotency(
      {
        uid: user.uid,
        route: "agents.repo-improvement.review.post",
        key: idempotencyKey,
        log,
      },
      async () => {
        try {
          const response = await recordRepoImprovementReview(payload, {
            reviewer,
            correlationId,
          });

          log.info("agents.repo_improvement.review_recorded", {
            uid: user.uid,
            reviewId: payload.reviewId,
            decision: payload.decision,
            reasonCode: payload.reasonCode,
            pendingReviewCount: response.pending_review_count,
          });

          return response;
        } catch (error) {
          throw new ApiError(
            503,
            error instanceof Error
              ? error.message
              : "Repo-improvement review recorder unavailable"
          );
        }
      }
    );

    return NextResponse.json({
      ...result.data,
      replayed: result.replayed,
      correlationId,
    });
  },
  { route: "agents.repo-improvement.review.post" }
);
