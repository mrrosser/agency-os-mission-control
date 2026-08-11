import { NextResponse } from "next/server";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { loadPortfolioCrmSummaryForUid } from "@/lib/crm/portfolio-registry";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const getPortfolioRegistrySummary = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].length > 0) {
      throw new ApiError(400, "Portfolio CRM summary does not accept query parameters.");
    }

    const summary = await loadPortfolioCrmSummaryForUid(user.uid, log);
    const response = NextResponse.json(summary);
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");
    return response;
  },
  { route: "crm.portfolio_registry.summary" }
);

export async function GET(
  request: Parameters<typeof getPortfolioRegistrySummary>[0],
  context: Parameters<typeof getPortfolioRegistrySummary>[1]
) {
  const response = await getPortfolioRegistrySummary(request, context);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}
