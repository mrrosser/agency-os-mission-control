import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Logger } from "@/lib/logging";
import { classifyWarmReconnectThread, resolveWarmReconnectReadToken } from "./warm-reconnect-response-reader";
import { assertResultsOwner, loadOwnedResultsPilot, readResultsReceipts, validBoundReceipt, resultObject, resultText, RESULTS_PILOT_COLLECTION, type ResultDocument } from "./warm-reconnect-results";
import { attributeSeparateDeliveryNotice, type VerifiedSentNoticeTarget, type SeparateNoticeMessage, type AttributedSeparateNotice } from "./separate-delivery-notice";

const API="https://gmail.googleapis.com/gmail/v1/users/me";
const ID=/^[a-f0-9]{1,64}$/;
const MAX_ORIGINALS=400, MAX_CANDIDATES=50, MAX_BYTES=256*1024;
export const SEPARATE_NOTICE_COLLECTION="separate_delivery_observations";
export interface SeparateDeliveryObservation {
  schemaVersion:"crm.separate-delivery-observation.v1";
  pilotId:string; workspaceId:string; ownerUid:string; observedAt:string;
  status:"complete"|"partial"; expectedOriginals:number; verifiedOriginals:number;
  listedCandidates:number; inspectedCandidates:number; truncated:boolean;
  scope:"google_delivery_reports_within_30_days";
  events:(AttributedSeparateNotice & {receiptId:string;recipientId:string})[];
}
/** GET-only provider adapter. No raw provider response or mail text is logged or stored. */
async function read(path:string,token:string,fetchImpl:typeof fetch,deadline:number):Promise<ResultDocument>{
  const timeout=Math.min(10_000,deadline-Date.now());
  if(timeout<=0)throw new ApiError(503,"Delivery report discovery reached its time bound.");
  const response=await fetchImpl(API+path,{method:"GET",cache:"no-store",redirect:"manual",headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(timeout)});
  if(!response.ok)throw new ApiError(response.status===401||response.status===403?403:response.status===429?429:502,"Delivery report discovery unavailable.");
  if(Number(response.headers.get("content-length"))>MAX_BYTES)throw new ApiError(502,"Delivery report exceeds read bound.");
  const reader=response.body?.getReader();if(!reader)throw new ApiError(502,"Empty delivery report response.");
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw new ApiError(502,"Delivery report exceeds read bound.");}chunks.push(value);}}finally{reader.releaseLock();}
  const buffer=new Uint8Array(size);let offset=0;for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
  const value=JSON.parse(new TextDecoder().decode(buffer));if(!value||typeof value!=="object"||Array.isArray(value))throw new ApiError(502,"Invalid delivery report response.");return value;
}
function header(message:ResultDocument,name:string):string{
  const headers=resultObject(message.payload).headers;
  const matches=Array.isArray(headers)?headers.map(resultObject).filter(h=>resultText(h.name).toLowerCase()===name.toLowerCase()):[];
  return matches.length===1?resultText(matches[0].value):"";
}
function denied(error:unknown){return error instanceof ApiError&&(error.status===403||error.status===429);}
export async function discoverSeparateDeliveryNotices(input:{pilot:ResultDocument;receipts:ResultDocument[];token:string;deadlineAt:number;fetchImpl?:typeof fetch}):Promise<Omit<SeparateDeliveryObservation,"pilotId"|"workspaceId"|"ownerUid">>{
  const fetchImpl=input.fetchImpl||fetch;
  const sent=input.receipts.filter(r=>r.status==="sent");
  const targets:{target:VerifiedSentNoticeTarget;receipt:ResultDocument}[]=[];
  let partial=sent.length>MAX_ORIGINALS,inspectedCandidates=0;
  // Original identity must be checked against frozen receipts, not inferred from a search hit.
  for(let start=0;start<Math.min(sent.length,MAX_ORIGINALS)&&Date.now()<input.deadlineAt;start+=10){
    await Promise.all(sent.slice(start,Math.min(start+10,MAX_ORIGINALS)).map(async receipt=>{
      try{
        const p=new URLSearchParams({format:"metadata",fields:"id,threadId,labelIds,internalDate,payload(headers)"});
        for(const h of ["From","To","Message-ID"])p.append("metadataHeaders",h);
        const original=await read(`/messages/${receipt.providerMessageId}?${p}`,input.token,fetchImpl,input.deadlineAt);
        classifyWarmReconnectThread({pilot:input.pilot,receipt,thread:{id:receipt.providerThreadId,messages:[original]}});
        const recipient=header(original,"To").match(/<([^<>]+)>/)?.[1]||header(original,"To");
        targets.push({receipt,target:{providerMessageId:resultText(original.id),providerThreadId:resultText(original.threadId),rfcMessageId:header(original,"Message-ID").trim(),senderEmail:resultText(resultObject(input.pilot.sender).fromEmail),recipientEmail:recipient.trim(),sentAt:new Date(Number(original.internalDate)).toISOString()}});
      }catch(error){if(denied(error))throw error;partial=true;}
    }));
  }
  if(targets.length!==sent.length)partial=true;
  let candidates:ResultDocument[]=[];let truncated=false;
  const events:SeparateDeliveryObservation["events"]=[];
  if(targets.length&&Date.now()<input.deadlineAt){
    const dates=targets.map(t=>Date.parse(t.target.sentAt));
    const query=`from:mailer-daemon@googlemail.com after:${Math.floor(Math.min(...dates)/1000)-1} before:${Math.ceil((Math.max(...dates)+30*86400000)/1000)+1}`;
    try{
      const list=await read(`/messages?${new URLSearchParams({q:query,maxResults:String(MAX_CANDIDATES),includeSpamTrash:"true",fields:"messages(id,threadId),nextPageToken"})}`,input.token,fetchImpl,input.deadlineAt);
      if(list.messages!==undefined&&!Array.isArray(list.messages))throw Error("invalid list");
      candidates=Array.isArray(list.messages)?list.messages.map(resultObject):[];
      if(candidates.length>MAX_CANDIDATES||candidates.some(m=>!ID.test(resultText(m.id))||!ID.test(resultText(m.threadId)))||new Set(candidates.map(m=>m.id)).size!==candidates.length)throw Error("invalid list");
      truncated=Boolean(list.nextPageToken);partial ||= truncated;
      for(let start=0;start<candidates.length&&Date.now()<input.deadlineAt;start+=5){
        await Promise.all(candidates.slice(start,start+5).map(async candidate=>{
          try{
            const message=await read(`/messages/${candidate.id}?${new URLSearchParams({format:"full",fields:"id,threadId,labelIds,internalDate,payload"})}`,input.token,fetchImpl,input.deadlineAt);
            if(message.id!==candidate.id||message.threadId!==candidate.threadId)throw Error("identity mismatch");
            const matches=targets.map(({target,receipt})=>({event:attributeSeparateDeliveryNotice(message as SeparateNoticeMessage,target),receipt})).filter(match=>match.event);
            if(matches.length===1){const {event,receipt}=matches[0];events.push({...event!,receiptId:resultText(receipt.receiptId),recipientId:resultText(receipt.recipientId)});}
            inspectedCandidates++;
          }catch(error){if(denied(error))throw error;partial=true;}
        }));
      }
      if(inspectedCandidates!==candidates.length)partial=true;
    }catch(error){if(denied(error))throw error;partial=true;}
  }else partial=true;
  return {schemaVersion:"crm.separate-delivery-observation.v1",observedAt:new Date().toISOString(),status:partial?"partial":"complete",scope:"google_delivery_reports_within_30_days",expectedOriginals:sent.length,verifiedOriginals:targets.length,listedCandidates:candidates.length,inspectedCandidates,truncated,events:events.sort((a,b)=>a.providerMessageId.localeCompare(b.providerMessageId))};
}
export async function refreshSeparateDeliveryNoticesForUid(input:{uid:string;pilotId:string;db?:Firestore;fetchImpl?:typeof fetch;log?:Logger}):Promise<SeparateDeliveryObservation>{
  const deadlineAt=Date.now()+60_000;
  const db=input.db||getAdminDb(),workspaceId=await assertResultsOwner(input.uid,db);
  const pilot=await loadOwnedResultsPilot(input.uid,workspaceId,input.pilotId,db),receipts=await readResultsReceipts(pilot,db);
  if(receipts.some(r=>!validBoundReceipt(pilot,r))||new Set(receipts.map(r=>r.recipientId)).size!==receipts.length)throw new ApiError(409,"Delivery receipts need reconciliation.");
  const sent=receipts.filter(r=>r.status==="sent");
  if(!sent.length||new Set(sent.map(r=>r.providerMessageId)).size!==sent.length||new Set(sent.map(r=>r.providerThreadId)).size!==sent.length)throw new ApiError(409,"Sent delivery identities need reconciliation.");
  const token=await resolveWarmReconnectReadToken(input.uid,resultText(resultObject(pilot.sender).fromEmail).toLowerCase(),{fetchImpl:input.fetchImpl,log:input.log,deadlineAt});
  const observation:SeparateDeliveryObservation={...await discoverSeparateDeliveryNotices({pilot,receipts,token,deadlineAt,fetchImpl:input.fetchImpl}),pilotId:input.pilotId,workspaceId,ownerUid:input.uid};
  // Separate immutable observation: never overwrite exact-thread metrics or contact state.
  await db.collection(RESULTS_PILOT_COLLECTION).doc(input.pilotId).collection(SEPARATE_NOTICE_COLLECTION).doc().set(observation);
  return observation;
}
