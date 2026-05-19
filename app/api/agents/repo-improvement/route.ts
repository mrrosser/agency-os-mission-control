import { NextResponse } from "next/server";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import { getRepoImprovementSnapshot } from "@/lib/repo-improvement";

export const runtime = "nodejs";

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const snapshot = await getRepoImprovementSnapshot();

    log.info("agents.repo_improvement.snapshot", {
      uid: user.uid,
      status: snapshot.status,
      pendingReviewCount: snapshot.reviewSchema?.summary.pending_review_count ?? 0,
      reviewScriptAvailable: snapshot.reviewScriptAvailable,
    });

    return NextResponse.json(snapshot);
  },
  { route: "agents.repo-improvement" }
);
