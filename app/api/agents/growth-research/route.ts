import { NextResponse } from "next/server";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import { getGrowthResearchSnapshot } from "@/lib/growth-research";

export const runtime = "nodejs";

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const snapshot = await getGrowthResearchSnapshot();

    log.info("agents.growth_research.snapshot", {
      uid: user.uid,
      status: snapshot.status,
      pendingReviewCount: snapshot.reviewSchema?.summary.pending_review_count ?? 0,
      reviewScriptAvailable: snapshot.reviewScriptAvailable,
    });

    return NextResponse.json(snapshot);
  },
  { route: "agents.growth-research" }
);
