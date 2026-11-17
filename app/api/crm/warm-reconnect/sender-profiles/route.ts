import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { loadWarmReconnectSenderProfilesForUid } from "@/lib/crm/warm-reconnect-repository";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

const getProfiles = withApiHandler(async ({ request, log }) => {
  const user = await requireFirebaseAuth(request, log);
  if ([...new URL(request.url).searchParams.keys()].length) {
    throw new ApiError(400, "Sender profile status does not accept query parameters.");
  }
  return noStore(NextResponse.json(await loadWarmReconnectSenderProfilesForUid(user.uid)));
}, { route: "crm.warm_reconnect.sender_profiles", persistServerErrors: false });

export async function GET(
  request: Parameters<typeof getProfiles>[0],
  context: Parameters<typeof getProfiles>[1],
) {
  return noStore(await getProfiles(request, context));
}
