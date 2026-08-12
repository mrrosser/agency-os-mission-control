import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { loadWarmReconnectActivationForUid } from "@/lib/crm/warm-reconnect-repository";

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
    if ([...new URL(request.url).searchParams.keys()].length > 0) {
      throw new ApiError(400, "Warm reconnect activation does not accept query parameters.");
    }
    return noStore(
      NextResponse.json(await loadWarmReconnectActivationForUid(user.uid, log))
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
