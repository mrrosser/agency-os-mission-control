import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { parseBoundedWarmReconnectJson } from "@/lib/crm/warm-reconnect-activation";
import { loadWarmReconnectResultsForUid } from "@/lib/crm/warm-reconnect-results";
import { refreshWarmReconnectResponsesForUid } from "@/lib/crm/warm-reconnect-response-reader";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const bodySchema=z.object({pilotId:z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/)}).strict();
function noStore(response:NextResponse){response.headers.set("Cache-Control","private, no-store, max-age=0");response.headers.set("Pragma","no-cache");return response;}
const postRefresh=withApiHandler(async({request,log,correlationId})=>{
  const user=await requireFirebaseAuth(request,log);
  if([...new URL(request.url).searchParams.keys()].length)throw new ApiError(400,"Reply refresh does not accept query parameters.");
  const body=await parseBoundedWarmReconnectJson(request,bodySchema,2048);
  await refreshWarmReconnectResponsesForUid({uid:user.uid,pilotId:body.pilotId,correlationId,log});
  return noStore(NextResponse.json(await loadWarmReconnectResultsForUid(user.uid,{pilotId:body.pilotId,log})));
},{route:"crm.warm_reconnect.results.refresh",persistServerErrors:false});
export async function POST(request:Parameters<typeof postRefresh>[0],context:Parameters<typeof postRefresh>[1]){return noStore(await postRefresh(request,context));}
