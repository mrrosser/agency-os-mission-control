import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getLeadRunQuotaSummary, resolveLeadRunOrgId } from "@/lib/lead-runs/quotas";

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const orgId = await resolveLeadRunOrgId(user.uid, log);
    const quota = await getLeadRunQuotaSummary(orgId);
    return NextResponse.json({ quota });
  },
  { route: "lead-runs.quota.get" }
);
