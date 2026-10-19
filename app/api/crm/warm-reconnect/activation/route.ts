import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { loadWarmReconnectActivationForUid } from "@/lib/crm/warm-reconnect-repository";
import { validateWarmReconnectHistoryCursor } from "@/lib/crm/warm-reconnect-history";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

const getActivation = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== "historyAfter") || params.getAll("historyAfter").length > 1) {
      throw new ApiError(400, "Warm reconnect activation accepts only one history page cursor.");
    }
    const historyAfter = validateWarmReconnectHistoryCursor(params.get("historyAfter") ?? undefined);
    return noStore(
      NextResponse.json(await loadWarmReconnectActivationForUid(user.uid, log, undefined, { historyAfter }))
    );
  },
  { route: "crm.warm_reconnect.activation.get", persistServerErrors: false }
);

export async function GET(
  request: Parameters<typeof getActivation>[0],
  context: Parameters<typeof getActivation>[1]
) {
  return noStore(await getActivation(request, context));
}
