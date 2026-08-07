import { NextResponse } from "next/server";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { withApiHandler } from "@/lib/api/handler";
import {
  DAILY_OUTCOME_TIME_ZONE,
  getDailyOutcomeDashboard,
} from "@/lib/revenue/daily-outcome";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(
  async ({ request, correlationId, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const dashboard = await getDailyOutcomeDashboard({
      uid: user.uid,
      asOf: new Date(),
      timeZone: DAILY_OUTCOME_TIME_ZONE,
      correlationId,
      log,
    });
    return NextResponse.json({
      ok: true,
      ...dashboard,
      correlationId,
    });
  },
  { route: "revenue.daily_outcomes.get" }
);
