import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { assertResultsPilotId, loadWarmReconnectResultsForUid } from "@/lib/crm/warm-reconnect-results";

export const dynamic = "force-dynamic";
export const revalidate = 0;
function noStore(response: NextResponse) {
  response.headers.set("Cache-Control","private, no-store, max-age=0");
  response.headers.set("Pragma","no-cache");
  return response;
}
const getResults=withApiHandler(async({request,log})=>{
  const user=await requireFirebaseAuth(request,log);
  const params=new URL(request.url).searchParams;
  if([...params.keys()].some(key=>key!=="pilotId")||params.getAll("pilotId").length>1)throw new ApiError(400,"Only one outreach batch identifier is accepted.");
  const pilotId=params.get("pilotId")??undefined;
  if(pilotId!==undefined)assertResultsPilotId(pilotId);
  return noStore(NextResponse.json(await loadWarmReconnectResultsForUid(user.uid,{pilotId,log})));
},{route:"crm.warm_reconnect.results.get",persistServerErrors:false});
export async function GET(request:Parameters<typeof getResults>[0],context:Parameters<typeof getResults>[1]){return noStore(await getResults(request,context));}
