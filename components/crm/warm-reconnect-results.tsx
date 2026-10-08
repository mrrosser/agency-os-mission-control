"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders, getResponseCorrelationId } from "@/lib/api/client";
import type { WarmReconnectOutcomeMetric, WarmReconnectResultsResponse } from "@/lib/crm/warm-reconnect-results-types";

type Props={pilotId?:string;refreshKey?:string|number;onLoaded?:(response:WarmReconnectResultsResponse)=>void};
const metricText=(metric:WarmReconnectOutcomeMetric)=>metric.status==="observed"?String(metric.value):"Not observed";
function dateText(value:string|null){return value?new Date(value).toLocaleString():"Not observed";}

export function WarmReconnectResults({pilotId,refreshKey,onLoaded}:Props){
  const {user}=useAuth();
  const owner=useRef<string|null>(null);const epoch=useRef(0);const requestSequence=useRef(0);
  if(owner.current!==(user?.uid||null)){owner.current=user?.uid||null;epoch.current++;}
  const callback=useRef(onLoaded);callback.current=onLoaded;
  const [saved,setSaved]=useState<{uid:string;data:WarmReconnectResultsResponse}|null>(null);
  const [selectedId,setSelectedId]=useState<string|undefined>();
  const [pending,setPending]=useState(false);const [error,setError]=useState<string|null>(null);
  const data=saved?.uid===user?.uid?saved?.data:null;
  const selected=data?.selectedPilot;
  const load=useCallback(async(refreshReplies=false,targetOverride?:string)=>{
    if(!user)return;
    const uid=user.uid;const startedEpoch=epoch.current;const sequence=++requestSequence.current;
    const isCurrent=()=>owner.current===uid&&epoch.current===startedEpoch&&requestSequence.current===sequence;
    const target=targetOverride||pilotId||selectedId;
    if(refreshReplies&&!target)return;
    setPending(true);setError(null);
    try{
      const headers=await buildAuthHeaders(user);if(!isCurrent())return;
      const path=refreshReplies?"/api/crm/warm-reconnect/results/refresh":`/api/crm/warm-reconnect/results${target?`?pilotId=${encodeURIComponent(target)}`:""}`;
      const response=await fetch(path,{method:refreshReplies?"POST":"GET",headers,cache:"no-store",signal:AbortSignal.timeout(90_000),...(refreshReplies?{body:JSON.stringify({pilotId:target})}:{})});
      const result=await response.json();if(!isCurrent())return;
      if(!response.ok||result.schemaVersion!=="crm.warm-reconnect-results.v1"||!Array.isArray(result.pilots)){
        const cid=getResponseCorrelationId(response);throw new Error(`${typeof result.error==="string"?result.error:"Outreach results are unavailable."}${cid?` Reference: ${cid}`:""}`);
      }
      setSaved({uid,data:result});callback.current?.(result);
    }catch(caught){if(isCurrent())setError(caught instanceof Error?caught.message:"Outreach results are unavailable.");}
    finally{if(isCurrent())setPending(false);}
  },[user,pilotId,selectedId]);
  useEffect(()=>{setSaved(null);setSelectedId(undefined);setError(null);setPending(false);},[user?.uid]);
  useEffect(()=>{void load();},[load,refreshKey]);
  async function refreshReplies(){
    if(!selected||pending||!user)return;
    await load(true,selected.pilotId);
  }
  return <section className="mt-6 rounded-xl border border-white/15 bg-white/[0.03] p-5" aria-labelledby="outreach-results-heading" data-testid="warm-reconnect-results">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="outreach-results-heading" className="font-semibold text-zinc-100">Outreach results</h2><button type="button" disabled={!user||pending} onClick={()=>void load()} className="rounded-md border border-white/20 px-3 py-2 text-sm disabled:opacity-40">{pending?"Loading…":"Refresh results"}</button></div>
    <p className="mt-2 text-sm text-zinc-400">Confirmed sends and recipient choices for each reviewed batch. Sent means accepted by Gmail; it does not confirm an opening or a sale.</p>
    {error&&<p role="alert" className="mt-3 text-sm text-amber-200">{error}</p>}
    {data&&data.pilots.length===0&&<p className="mt-3 text-sm text-zinc-300">No outreach batches yet.</p>}
    {data&&data.pilots.length>0&&<>
      {!pilotId&&<label className="mt-4 block text-sm text-zinc-300">Batch<select value={selected?.pilotId||""} disabled={pending} onChange={event=>setSelectedId(event.target.value)} className="ml-3 max-w-full rounded-md border border-white/20 bg-zinc-900 p-2">{data.pilots.map(pilot=><option key={pilot.pilotId} value={pilot.pilotId}>{pilot.batchSequence?`Batch ${pilot.batchSequence}`:"First pilot"} · {dateText(pilot.createdAt)} · {pilot.complete?"Complete":pilot.status.replaceAll("_"," ")} · {metricText(pilot.sent)}/{pilot.recipientCount} sent</option>)}</select></label>}
      {data.pilotsTruncated&&<p className="mt-2 text-sm text-amber-200">The batch list reached its reporting limit. Select a known batch to inspect it directly.</p>}
      {selected&&<>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">{([
          ["Sent",selected.sent],["Stopped before send",selected.stoppedBeforeProvider],["Uncertain delivery",selected.deliveryUnknown],["Confirmed choices",selected.confirmedChoices.any],
          ["Gallery updates",selected.confirmedChoices.rosserGallery],["RT.Solutions updates",selected.confirmedChoices.rtSolutions],["Unsubscribed",selected.unsubscribed],["Replies in sent threads",selected.replies],
        ] as const).map(([label,metric])=><div key={label} className="rounded-lg border border-white/10 p-3" title={metric.reason}><p className="text-xs text-zinc-400">{label}</p><p className="mt-1 text-lg text-zinc-100">{metricText(metric)}</p></div>)}</div>
        <p className="mt-3 text-xs text-zinc-400">Choices and unsubscribes were confirmed through this batch’s preference links. Reply check: {dateText(selected.replyObservation.observedAt)} · {selected.replyObservation.inspectedThreads}/{selected.replyObservation.expectedThreads} exact sent threads. Automatic responses: {metricText(selected.automaticResponses)}. Delivery notices in these threads: {metricText(selected.deliveryNotices)}.</p>
        <button type="button" disabled={pending||!user||selected.sent.status!=="observed"||!selected.sent.value} onClick={()=>void refreshReplies()} className="mt-3 rounded-md border border-white/20 px-3 py-2 text-sm disabled:opacity-40">Check replies in sent threads</button>
        <p className="mt-2 text-xs text-zinc-400">The reply check reads the existing Gallery mailbox. Total bounces, opens, ordinary clicks and sales conversions are not collected.</p>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-zinc-400"><tr><th className="py-2">Recipient</th><th>Delivery</th><th>Sent at</th><th>Confirmed choices</th></tr></thead><tbody>{selected.recipients.map(recipient=><tr key={recipient.recipientId} className="border-t border-white/10"><td className="py-2 pr-3">{recipient.greetingName}</td><td className="pr-3" title={recipient.terminalReason||undefined}>{recipient.deliveryStatus.replaceAll("_"," ")}</td><td className="pr-3">{recipient.sentAt?dateText(recipient.sentAt):"—"}</td><td>{recipient.unsubscribedThroughBatch?"Unsubscribed":recipient.topics===null?"Not observed":[recipient.topics.rosser_gallery?"Gallery":null,recipient.topics.rt_solutions?"RT.Solutions":null].filter(Boolean).join(", ")||"None confirmed"}</td></tr>)}</tbody></table></div>
      </>}
    </>}
  </section>;
}
