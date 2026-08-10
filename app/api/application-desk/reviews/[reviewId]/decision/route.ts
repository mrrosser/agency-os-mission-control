import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { forwardApplicationDeskRequest } from "@/lib/application-desk-proxy";
import { canRecordApplicationDeskDecisions } from "@/lib/application-desk";

export const dynamic = "force-dynamic";

const REVIEW_ID_PATTERN = /^application_review_[a-f0-9]{24}$/;

export const POST = withApiHandler(
  async ({ request, params, correlationId, log }) => {
    await requireFirebaseAuth(request, log);
    const workspaceId = request.headers.get("x-workspace-id")?.trim() || "";
    if (!canRecordApplicationDeskDecisions(workspaceId)) {
      throw new ApiError(
        403,
        "RT Solutions application reviews are read-only until workspace access is reconciled.",
      );
    }
    const reviewId = String(params?.reviewId || "");
    if (!REVIEW_ID_PATTERN.test(reviewId)) {
      throw new ApiError(404, "Application review not found.");
    }
    return forwardApplicationDeskRequest({
      request,
      path: `/api/artist-manager/application-reviews/${reviewId}/decision`,
      method: "POST",
      correlationId,
      log,
      maxRequestBytes: 12 * 1024,
      requireWorkspace: true,
    });
  },
  { route: "application-desk.decision" },
);
