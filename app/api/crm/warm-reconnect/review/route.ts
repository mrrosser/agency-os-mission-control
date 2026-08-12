import { NextResponse } from "next/server";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { loadPortfolioCrmSummaryForUid } from "@/lib/crm/portfolio-registry";
import { buildWarmReconnectCampaignDraft } from "@/lib/crm/warm-reconnect";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const getWarmReconnectReview = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].length > 0) {
      throw new ApiError(400, "Warm reconnect review does not accept query parameters.");
    }

    const registrySummary = await loadPortfolioCrmSummaryForUid(user.uid, log);
    const response = NextResponse.json({
      schemaVersion: "crm.warm-reconnect-review.v1",
      dataClassification: "aggregate_only",
      readOnly: true,
      registrySummary,
      campaign: buildWarmReconnectCampaignDraft(registrySummary),
    });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");
    return response;
  },
  { route: "crm.warm_reconnect.review", persistServerErrors: false }
);

export async function GET(
  request: Parameters<typeof getWarmReconnectReview>[0],
  context: Parameters<typeof getWarmReconnectReview>[1]
) {
  const response = await getWarmReconnectReview(request, context);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}
