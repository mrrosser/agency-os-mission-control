import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import { resolveGoogleAccountTokens } from "@/lib/google/account-token-store";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { warmReconnectEmailKey } from "@/lib/crm/warm-reconnect-dedupe";
import type { Logger } from "@/lib/logging";
import {
  assertResultsOwner, loadOwnedResultsPilot, readResultsReceipts, validBoundReceipt,
  resultObject, resultText, resultIso, RESULTS_OBSERVATION_COLLECTION, RESULTS_PILOT_COLLECTION,
  type ResultDocument, type WarmReconnectReplyEvent, type WarmReconnectReplyObservation,
} from "./warm-reconnect-results";

const READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const PROFILE = "rosser_gallery_work";
const GALLERY_EMAIL = "mrosser@rossergallery.com";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGES = 100;
const MAX_EVENTS = 200;
const PROVIDER_ID = /^[a-f0-9]{1,64}$/;
const HEADERS = ["From","To","Message-ID","In-Reply-To","References","Auto-Submitted","Content-Type"];

function scopes(value: unknown) { return [...new Set(resultText(value).split(/\s+/).filter(Boolean))].sort(); }
function mailbox(value: string): string | null {
  // A single mailbox only. A malformed/multiple address header cannot attribute a reply.
  if (/[,;\r\n]/.test(value)) return null;
  const candidate=(value.match(/<([^<>]+)>/)?.[1]||value).trim().toLowerCase();
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(candidate)?candidate:null;
}
function header(message: ResultDocument, name: string): string {
  const headers=resultObject(message.payload).headers;
  if(!Array.isArray(headers))return "";
  const found=headers.map(resultObject).filter(row=>resultText(row.name).toLowerCase()===name.toLowerCase());
  return found.length===1?resultText(found[0].value):"";
}
function messageDate(message: ResultDocument): string | null {
  const value=Number(message.internalDate);return Number.isSafeInteger(value)?resultIso(value):null;
}

/** Metadata only; never returns or persists raw headers or message bodies. */
export function classifyWarmReconnectThread(input: {pilot:ResultDocument;receipt:ResultDocument;thread:ResultDocument}): WarmReconnectReplyEvent[] {
  const {pilot,receipt,thread}=input;
  const messages=Array.isArray(thread.messages)?thread.messages.map(resultObject):null;
  if(thread.id!==receipt.providerThreadId||!messages||messages.length<1||messages.length>MAX_MESSAGES||new Set(messages.map(row=>row.id)).size!==messages.length)throw new ApiError(502,"The exact sent thread could not be reconciled.");
  const original=messages.find(row=>row.id===receipt.providerMessageId);
  const expectedSender=resultText(resultObject(pilot.sender).fromEmail).toLowerCase();
  const originalId=original?header(original,"Message-ID").trim():"";
  const recipientEmail=original?mailbox(header(original,"To")):null;
  const sentDate=original?messageDate(original):null;
  if(!original||!Array.isArray(original.labelIds)||!original.labelIds.includes("SENT")||original.threadId!==receipt.providerThreadId||!/^<[^\s<>]{1,500}>$/.test(originalId)||
    mailbox(header(original,"From"))!==expectedSender||!recipientEmail||warmReconnectEmailKey(resultText(pilot.workspaceId),recipientEmail)!==receipt.emailKey||!sentDate)throw new ApiError(502,"The original sent message does not match its delivery receipt.");
  const events:WarmReconnectReplyEvent[]=[];
  for(const message of messages){
    if(message.id===original.id)continue;
    if(!PROVIDER_ID.test(resultText(message.id))||message.threadId!==receipt.providerThreadId)throw new ApiError(502,"Unexpected message in the exact sent thread.");
    if(Array.isArray(message.labelIds)&&message.labelIds.includes("SENT"))continue;
    const from=mailbox(header(message,"From"));
    if(from===expectedSender)continue;
    const occurredAt=messageDate(message);
    if(!occurredAt||occurredAt<sentDate)throw new ApiError(502,"Thread timestamps could not be reconciled.");
    const referenced=[header(message,"In-Reply-To"),header(message,"References")].some(value=>(value.match(/<[^\s<>]+>/g)||[]).some(id=>id===originalId));
    const auto=header(message,"Auto-Submitted").trim().toLowerCase();
    const contentType=header(message,"Content-Type").toLowerCase();
    let kind:WarmReconnectReplyEvent["kind"]="unattributed";
    if(referenced&&contentType.includes("multipart/report")&&/report-type\s*=\s*"?delivery-status/.test(contentType))kind="delivery_notice";
    else if(referenced&&from===recipientEmail&&auto&&auto!=="no")kind="automatic_response";
    else if(referenced&&from===recipientEmail)kind="reply";
    events.push({providerMessageId:resultText(message.id),providerThreadId:resultText(receipt.providerThreadId),receiptId:resultText(receipt.receiptId),recipientId:resultText(receipt.recipientId),kind,occurredAt});
  }
  return events;
}

async function metadataRequest(path:string,token:string,fetchImpl:typeof fetch,log?:Logger):Promise<ResultDocument>{
  let response:Response;
  try{response=await fetchImpl(API+path,{method:"GET",cache:"no-store",redirect:"manual",signal:AbortSignal.timeout(20_000),headers:{Authorization:`Bearer ${token}`}});}catch{throw new ApiError(503,"Gmail metadata could not be read.");}
  log?.info("warm_reconnect.results.gmail_read",{operation:path.startsWith("/profile")?"profile":"exact_thread",status:response.status});
  if(!response.ok)throw new ApiError(response.status===401||response.status===403?403:502,"Gmail metadata is unavailable for the selected read connection.");
  const length=Number(response.headers.get("content-length"));
  if(length>MAX_BYTES)throw new ApiError(502,"Gmail metadata exceeds the reporting bound.");
  const reader=response.body?.getReader();if(!reader)throw new ApiError(502,"Gmail returned empty metadata.");
  const chunks:Uint8Array[]=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw new ApiError(502,"Gmail metadata exceeds the reporting bound.");}chunks.push(value);}}finally{reader.releaseLock();}
  const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}
  try{const parsed=JSON.parse(new TextDecoder().decode(joined));if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))throw Error();return parsed;}catch{throw new ApiError(502,"Gmail returned invalid metadata.");}
}

export async function resolveWarmReconnectReadToken(uid:string,expectedEmail:string,options:{fetchImpl?:typeof fetch;log?:Logger}={}):Promise<string>{
  if(expectedEmail!==GALLERY_EMAIL)throw new ApiError(409,"Reply refresh currently supports the existing Gallery read connection only.");
  const before=await resolveGoogleAccountTokens(uid,PROFILE);
  const record=before.record;const beforeScopes=scopes(record?.tokens?.scope);
  if(!before.registryFound||!before.profileMapped||!record?.accountId||record.profileId!==PROFILE||!beforeScopes.includes(READ_SCOPE))throw new ApiError(403,"The existing Gallery work connection needs Gmail read permission.");
  if(record.tokens?.accountEmail&&record.tokens.accountEmail.trim().toLowerCase()!==expectedEmail)throw new ApiError(409,"The Gallery read connection belongs to a different mailbox.");
  const token=await getAccessTokenForUser(uid,options.log,{profileId:PROFILE});
  const profile=await metadataRequest("/profile?fields=emailAddress",token,options.fetchImpl||fetch,options.log);
  if(resultText(profile.emailAddress).trim().toLowerCase()!==expectedEmail)throw new ApiError(409,"The Gallery read connection belongs to a different mailbox.");
  const after=await resolveGoogleAccountTokens(uid,PROFILE);
  if(!after.registryFound||!after.profileMapped||after.record?.accountId!==record.accountId||after.record?.profileId!==PROFILE||JSON.stringify(scopes(after.record?.tokens?.scope))!==JSON.stringify(beforeScopes)||
    (after.record?.tokens?.accountEmail&&after.record.tokens.accountEmail.trim().toLowerCase()!==expectedEmail))throw new ApiError(409,"The Gallery read connection changed during verification.");
  return token;
}

export async function refreshWarmReconnectResponsesForUid(input:{uid:string;pilotId:string;correlationId:string;db?:Firestore;log?:Logger;fetchImpl?:typeof fetch}):Promise<void>{
  const db=input.db||getAdminDb();const workspaceId=await assertResultsOwner(input.uid,db);
  const pilot=await loadOwnedResultsPilot(input.uid,workspaceId,input.pilotId,db);
  const receipts=await readResultsReceipts(input.pilotId,db);
  if(receipts.some(receipt=>!validBoundReceipt(pilot,receipt))||new Set(receipts.map(row=>row.recipientId)).size!==receipts.length)throw new ApiError(409,"Delivery receipts need reconciliation before refreshing replies.");
  const sent=receipts.filter(receipt=>receipt.status==="sent");
  if(!sent.length)throw new ApiError(409,"This batch has no confirmed sent messages to inspect.");
  if(new Set(sent.map(row=>row.providerMessageId)).size!==sent.length||new Set(sent.map(row=>row.providerThreadId)).size!==sent.length)throw new ApiError(409,"Delivery provider identifiers need reconciliation.");
  const fetchImpl=input.fetchImpl||fetch;
  const expectedEmail=resultText(resultObject(pilot.sender).fromEmail).toLowerCase();
  const token=await resolveWarmReconnectReadToken(input.uid,expectedEmail,{fetchImpl,log:input.log});
  const observedAt=new Date().toISOString();
  const events:WarmReconnectReplyEvent[]=[];let inspectedThreads=0;
  for(let start=0;start<sent.length;start+=5){
    await Promise.all(sent.slice(start,start+5).map(async receipt=>{
      const params=new URLSearchParams({format:"metadata",fields:"id,messages(id,threadId,labelIds,internalDate,payload(headers))"});
      for(const name of HEADERS)params.append("metadataHeaders",name);
      try{const thread=await metadataRequest(`/threads/${receipt.providerThreadId}?${params}`,token,fetchImpl,input.log);events.push(...classifyWarmReconnectThread({pilot,receipt,thread}));inspectedThreads++;}
      catch{input.log?.warn("warm_reconnect.results.thread_unavailable",{pilotId:input.pilotId,receiptId:receipt.receiptId});}
    }));
  }
  const observation:WarmReconnectReplyObservation={schemaVersion:"crm.warm-reconnect-response-observation.v1",pilotId:input.pilotId,workspaceId,ownerUid:input.uid,accountEmail:expectedEmail,status:inspectedThreads===sent.length?"complete":"partial",observedAt,inspectedThreads,expectedThreads:sent.length,sentMessageIds:sent.map(row=>resultText(row.providerMessageId)).sort(),events:[...new Map(events.map(event=>[event.providerMessageId,event])).values()]};
  const ref=db.collection(RESULTS_PILOT_COLLECTION).doc(input.pilotId).collection(RESULTS_OBSERVATION_COLLECTION).doc("latest");
  await db.runTransaction(async transaction=>{
    const old=(await transaction.get(ref)).data();
    if(old&&resultIso(old.observedAt)&&resultIso(old.observedAt)!>observedAt)return;
    const previous=old&&old.schemaVersion===observation.schemaVersion&&old.workspaceId===workspaceId&&old.ownerUid===input.uid&&old.pilotId===input.pilotId&&old.accountEmail===expectedEmail&&Array.isArray(old.events)?old.events.map(resultObject):[];
    const merged=new Map<string,WarmReconnectReplyEvent>();
    for(const raw of previous){
      const matching=sent.find(row=>row.receiptId===raw.receiptId&&row.recipientId===raw.recipientId&&row.providerThreadId===raw.providerThreadId);
      if(matching&&PROVIDER_ID.test(resultText(raw.providerMessageId))&&["reply","automatic_response","delivery_notice","unattributed"].includes(resultText(raw.kind))&&resultIso(raw.occurredAt))merged.set(resultText(raw.providerMessageId),{providerMessageId:resultText(raw.providerMessageId),providerThreadId:resultText(raw.providerThreadId),recipientId:resultText(raw.recipientId),receiptId:resultText(raw.receiptId),kind:raw.kind as WarmReconnectReplyEvent["kind"],occurredAt:resultIso(raw.occurredAt)!});
    }
    for(const event of observation.events)merged.set(event.providerMessageId,event);
    if(merged.size>MAX_EVENTS)throw new ApiError(409,"Response history exceeds the bounded batch report.");
    transaction.set(ref,{...observation,events:[...merged.values()],correlationId:input.correlationId});
  });
  input.log?.info("warm_reconnect.results.responses_observed",{pilotId:input.pilotId,inspectedThreads,expectedThreads:sent.length,status:observation.status});
}
