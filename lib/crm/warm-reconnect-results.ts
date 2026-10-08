import "server-only";

import type { Firestore } from "firebase-admin/firestore";
import { ApiError } from "@/lib/api/handler";
import { getAdminDb } from "@/lib/firebase-admin";
import { assertPortfolioRegistryAccess } from "@/lib/crm/portfolio-registry";
import type { Logger } from "@/lib/logging";
import type { WarmReconnectOutcomeMetric, WarmReconnectPilotResult, WarmReconnectResultsResponse } from "./warm-reconnect-results-types";

export const RESULTS_PILOT_COLLECTION = "crm_warm_reconnect_pilots";
export const RESULTS_OBSERVATION_COLLECTION = "response_observations";
const MAX_PILOTS = 100;
const MAX_EVENTS = 100;
const MAX_RECIPIENTS = 10;
const RECEIPT_STATUSES = new Set(["claimed", "capabilities_prepared", "provider_inflight", "sent", "delivery_unknown", "stopped_before_provider"]);
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,160}$/;
const PROVIDER_ID = /^[a-f0-9]{1,64}$/;

export type ResultDocument = Record<string, unknown>;
export type ResultRead<T> = { status: "observed"; value: T } | { status: "unknown"; reason: string };
export interface WarmReconnectReplyEvent {
  providerMessageId: string;
  providerThreadId: string;
  recipientId: string;
  receiptId: string;
  kind: "reply" | "automatic_response" | "delivery_notice" | "unattributed";
  occurredAt: string;
}
export interface WarmReconnectReplyObservation {
  schemaVersion: "crm.warm-reconnect-response-observation.v1";
  pilotId: string;
  workspaceId: string;
  ownerUid: string;
  accountEmail: string;
  status: "complete" | "partial";
  observedAt: string;
  inspectedThreads: number;
  expectedThreads: number;
  sentMessageIds: string[];
  events: WarmReconnectReplyEvent[];
}

export function resultObject(value: unknown): ResultDocument {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ResultDocument : {};
}
export function resultText(value: unknown): string { return typeof value === "string" ? value : ""; }
export function resultIso(value: unknown): string | null {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    try { return resultIso(value.toDate()); } catch { return null; }
  }
  const milliseconds = value instanceof Date ? value.getTime() : typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(milliseconds) && milliseconds > 0 ? new Date(milliseconds).toISOString() : null;
}
export function assertResultsPilotId(pilotId: string): void {
  if (!SAFE_ID.test(pilotId)) throw new ApiError(400, "Invalid outreach batch identifier.");
}
function unknown(reason: string): WarmReconnectOutcomeMetric { return { status: "unknown", value: null, observedAt: null, reason }; }
function observed(value: number, observedAt: string): WarmReconnectOutcomeMetric { return { status: "observed", value, observedAt }; }
function metric(read: ResultRead<unknown>, count: number, observedAt: string) { return read.status === "observed" ? observed(count, observedAt) : unknown(read.reason); }

export function validBoundReceipt(pilot: ResultDocument, receipt: ResultDocument): boolean {
  const recipients = Array.isArray(pilot.recipients) ? pilot.recipients.map(resultObject) : [];
  const recipient = recipients.find(row => row.recipientId === receipt.recipientId);
  const fingerprints = resultObject(pilot.fingerprints);
  return Boolean(recipient && SAFE_ID.test(resultText(receipt.receiptId)) && receipt.pilotId === pilot.pilotId && receipt.workspaceId === pilot.workspaceId && receipt.ownerUid === pilot.ownerUid &&
    receipt.personId === recipient.personId && receipt.contactPointId === recipient.contactPointId && receipt.emailKey === recipient.emailKey &&
    SAFE_ID.test(resultText(receipt.approvalId)) && receipt.approvalId === resultObject(pilot.approval).approvalId &&
    ["artifactFingerprint", "audienceFingerprint", "actionFingerprint"].every(key => typeof fingerprints[key] === "string" && receipt[key] === fingerprints[key]) &&
    RECEIPT_STATUSES.has(resultText(receipt.status)) &&
    (receipt.status !== "sent" || (PROVIDER_ID.test(resultText(receipt.providerMessageId)) && PROVIDER_ID.test(resultText(receipt.providerThreadId)) && resultIso(receipt.sentAtMs))));
}

/** Pure projection: malformed, failed or capped reads remain unknown, never zero. */
export function buildWarmReconnectPilotResult(input: {
  pilot: ResultDocument;
  receipts: ResultRead<ResultDocument[]>;
  events: ResultRead<ResultDocument[]>;
  executor: ResultRead<ResultDocument | null>;
  observation: ResultRead<ResultDocument | null>;
  observedAt: string;
}): WarmReconnectPilotResult {
  const { pilot, observedAt } = input;
  const recipients = Array.isArray(pilot.recipients) ? pilot.recipients.map(resultObject) : [];
  const recipientIds = recipients.map(row => resultText(row.recipientId));
  let receiptRead = input.receipts;
  if (recipientIds.length < 1 || recipientIds.length > MAX_RECIPIENTS || recipientIds.some(id => !SAFE_ID.test(id)) || new Set(recipientIds).size !== recipientIds.length ||
    (receiptRead.status === "observed" && (receiptRead.value.some(receipt => !validBoundReceipt(pilot, receipt)) || new Set(receiptRead.value.map(row => row.recipientId)).size !== receiptRead.value.length))) {
    receiptRead = { status: "unknown", reason: "Delivery records need reconciliation." };
  }
  const receipts = receiptRead.status === "observed" ? receiptRead.value : [];
  const sent = receipts.filter(row => row.status === "sent");
  let eventRead = input.events;
  if (eventRead.status === "observed" && eventRead.value.some(event => event.workspaceId !== pilot.workspaceId || event.pilotId !== pilot.pilotId || !recipientIds.includes(resultText(event.recipientId)) ||
    !["preferences_updated", "unsubscribed"].includes(resultText(event.eventType)) || !resultIso(event.occurredAt) ||
    event.campaignApprovalId !== resultObject(pilot.approval).approvalId || ["artifactFingerprint", "audienceFingerprint", "actionFingerprint"].some(key => event[key] !== resultObject(pilot.fingerprints)[key]) ||
    (event.eventType === "preferences_updated" && ["rosser_gallery","rt_solutions"].some(key=>typeof resultObject(event.topics)[key]!=="boolean")))) {
    eventRead = { status: "unknown", reason: "Preference records need reconciliation." };
  }
  const events = eventRead.status === "observed" ? eventRead.value : [];
  const choices = new Map<string, { rosser_gallery: boolean; rt_solutions: boolean }>();
  const unsubscribed = new Set<string>();
  for (const event of [...events].sort((a,b) => resultIso(a.occurredAt)!.localeCompare(resultIso(b.occurredAt)!))) {
    const id = resultText(event.recipientId);
    if (event.eventType === "unsubscribed") unsubscribed.add(id);
    else { const topics = resultObject(event.topics); choices.set(id, {rosser_gallery: topics.rosser_gallery === true, rt_solutions: topics.rt_solutions === true}); }
  }
  for (const id of unsubscribed) choices.set(id, {rosser_gallery:false,rt_solutions:false});
  const state = input.executor.status === "observed" ? input.executor.value : null;
  const complete = receiptRead.status === "observed" && state !== null && state.pilotId === pilot.pilotId && state.workspaceId === pilot.workspaceId && state.complete === true && state.halted === false && state.activeReceiptId === null &&
    state.sentCount === recipients.length && state.claimedCount === recipients.length && sent.length === recipients.length && new Set(sent.map(row=>row.providerMessageId)).size === sent.length;
  const observation = input.observation.status === "observed" ? input.observation.value : null;
  const observationEvents = observation && Array.isArray(observation.events) ? observation.events.map(resultObject) : [];
  const observationDate = resultIso(observation?.observedAt);
  const sentIds = sent.map(row=>resultText(row.providerMessageId)).sort();
  const observedIds = Array.isArray(observation?.sentMessageIds) ? [...observation.sentMessageIds].sort() : [];
  const validObservation = Boolean(receiptRead.status === "observed" && observation && observation.schemaVersion === "crm.warm-reconnect-response-observation.v1" && observation.pilotId === pilot.pilotId && observation.workspaceId === pilot.workspaceId && observation.ownerUid === pilot.ownerUid &&
    observation.accountEmail === resultObject(pilot.sender).fromEmail && observationDate && observationEvents.length <= 200 &&
    observationEvents.every(event => PROVIDER_ID.test(resultText(event.providerMessageId)) && sent.some(receipt => receipt.receiptId === event.receiptId && receipt.recipientId === event.recipientId && receipt.providerThreadId === event.providerThreadId) &&
      ["reply","automatic_response","delivery_notice","unattributed"].includes(resultText(event.kind)) && resultIso(event.occurredAt)));
  const observedAll = validObservation && observation!.status === "complete" && observation!.inspectedThreads === sent.length && observation!.expectedThreads === sent.length && JSON.stringify(observedIds) === JSON.stringify(sentIds);
  const uniqueResponses = [...new Map(observationEvents.map(event=>[event.providerMessageId,event])).values()];
  const responseMetric = (kind: string) => observedAll ? observed(uniqueResponses.filter(event=>event.kind===kind).length, observationDate!) : unknown("Exact sent threads have not been fully observed for these sends.");
  const batchSequence = typeof pilot.batchSequence === "number" && Number.isInteger(pilot.batchSequence) ? pilot.batchSequence : undefined;
  const parentPilotId = typeof pilot.parentPilotId === "string" && SAFE_ID.test(pilot.parentPilotId) ? pilot.parentPilotId : undefined;
  return {
    pilotId:resultText(pilot.pilotId), status:resultText(pilot.status), tranche:resultText(pilot.tranche), ...(batchSequence === undefined ? {} : {batchSequence}), ...(parentPilotId ? {parentPilotId}:{}), createdAt:resultIso(pilot.createdAt), recipientCount:recipients.length, recipientIds, complete,
    sent:metric(receiptRead,sent.length,observedAt), stoppedBeforeProvider:metric(receiptRead,receipts.filter(row=>row.status==="stopped_before_provider").length,observedAt),
    deliveryUnknown:metric(receiptRead,receipts.filter(row=>row.status==="delivery_unknown"||row.status==="provider_inflight").length,observedAt),
    confirmedChoices:{any:metric(eventRead,[...choices.values()].filter(row=>row.rosser_gallery||row.rt_solutions).length,observedAt),rosserGallery:metric(eventRead,[...choices.values()].filter(row=>row.rosser_gallery).length,observedAt),rtSolutions:metric(eventRead,[...choices.values()].filter(row=>row.rt_solutions).length,observedAt)},
    unsubscribed:metric(eventRead,unsubscribed.size,observedAt), replies:responseMetric("reply"),automaticResponses:responseMetric("automatic_response"),deliveryNotices:responseMetric("delivery_notice"),
    bounces:unknown("Separate-thread delivery notices are not exhaustively collected."),opens:unknown("Open tracking is not installed."),clicks:unknown("Ordinary click tracking is not installed."),conversions:unknown("Sales are not attributed to this campaign."),
    recipients:recipients.map(recipient=>{ const receipt=receipts.find(row=>row.recipientId===recipient.recipientId); return {recipientId:resultText(recipient.recipientId),greetingName:resultText(recipient.greetingName).slice(0,160)||"Contact",deliveryStatus:receiptRead.status==="unknown"?"unknown":resultText(receipt?.status)||"not_started",sentAt:resultIso(receipt?.sentAtMs),providerMessageId:resultText(receipt?.providerMessageId)||null,providerThreadId:resultText(receipt?.providerThreadId)||null,terminalReason:resultText(receipt?.terminalReason).replace(/[^a-z0-9_]/gi,"").slice(0,160)||null,topics:eventRead.status==="observed"?(choices.get(resultText(recipient.recipientId))||{rosser_gallery:false,rt_solutions:false}):null,unsubscribedThroughBatch:eventRead.status==="observed"?unsubscribed.has(resultText(recipient.recipientId)):null};}),
    replyObservation:{status:observedAll?"complete":validObservation?"partial":"not_observed",observedAt:validObservation?observationDate:null,scope:"exact_sent_threads",inspectedThreads:validObservation&&typeof observation!.inspectedThreads==="number"?observation!.inspectedThreads:0,expectedThreads:sent.length},
  };
}

export async function assertResultsOwner(uid: string, db: Firestore): Promise<string> {
  const access = await assertPortfolioRegistryAccess(uid, db);
  if (access.role !== "owner") throw new ApiError(403,"Only the portfolio owner can inspect outreach outcomes.");
  return access.workspaceId;
}
export async function loadOwnedResultsPilot(uid: string, workspaceId: string, pilotId: string, db: Firestore): Promise<ResultDocument> {
  assertResultsPilotId(pilotId);
  const snapshot = await db.collection(RESULTS_PILOT_COLLECTION).doc(pilotId).get();
  const pilot = snapshot.data();
  if (!snapshot.exists || !pilot || pilot.pilotId !== pilotId || pilot.ownerUid !== uid || pilot.workspaceId !== workspaceId) throw new ApiError(404,"Outreach batch not found.");
  return pilot;
}
async function readResult<T>(read: () => Promise<T>, reason: string, log?: Logger): Promise<ResultRead<T>> {
  try { return {status:"observed",value:await read()}; } catch { log?.warn("warm_reconnect.results.read_unavailable",{stage:reason}); return {status:"unknown",reason}; }
}
export async function readResultsReceipts(pilotId: string, db: Firestore): Promise<ResultDocument[]> {
  const snapshots = await db.collection(RESULTS_PILOT_COLLECTION).doc(pilotId).collection("delivery_receipts").select("receiptId","pilotId","workspaceId","ownerUid","recipientId","personId","contactPointId","emailKey","approvalId","artifactFingerprint","audienceFingerprint","actionFingerprint","status","sentAtMs","providerMessageId","providerThreadId","terminalReason").limit(MAX_RECIPIENTS+1).get();
  if (snapshots.size > MAX_RECIPIENTS) throw new ApiError(409,"Delivery records exceed the reporting bound.");
  if (snapshots.docs.some(doc => doc.id !== doc.data().receiptId)) throw new ApiError(409,"Delivery document identities need reconciliation.");
  return snapshots.docs.map(doc=>doc.data());
}
async function loadPilotResult(pilot: ResultDocument, db: Firestore, observedAt: string, log?: Logger): Promise<WarmReconnectPilotResult> {
  const ref=db.collection(RESULTS_PILOT_COLLECTION).doc(resultText(pilot.pilotId));
  const [receipts,events,executor,observation]=await Promise.all([
    readResult(()=>readResultsReceipts(resultText(pilot.pilotId),db),"Delivery records unavailable.",log),
    readResult(async()=>{const snapshots=await db.collection("crm_permission_events").where("pilotId","==",pilot.pilotId).select("workspaceId","pilotId","recipientId","eventType","topics","occurredAt","campaignApprovalId","artifactFingerprint","audienceFingerprint","actionFingerprint").limit(MAX_EVENTS+1).get();if(snapshots.size>MAX_EVENTS)throw Error("EVENT_CAP");return snapshots.docs.map(doc=>doc.data());},"Preference records unavailable or capped.",log),
    readResult(async()=>(await ref.collection("executor").doc("state").get()).data()||null,"Executor state unavailable.",log),
    readResult(async()=>(await ref.collection(RESULTS_OBSERVATION_COLLECTION).doc("latest").get()).data()||null,"Reply observation unavailable.",log),
  ]);
  return buildWarmReconnectPilotResult({pilot,receipts,events,executor,observation,observedAt});
}
export async function loadWarmReconnectResultsForUid(uid: string, options: {pilotId?: string;db?: Firestore;log?: Logger} = {}): Promise<WarmReconnectResultsResponse> {
  const db=options.db||getAdminDb();const workspaceId=await assertResultsOwner(uid,db);
  if(options.pilotId)assertResultsPilotId(options.pilotId);
  const snapshots=await db.collection(RESULTS_PILOT_COLLECTION).where("workspaceId","==",workspaceId).where("ownerUid","==",uid).limit(MAX_PILOTS+1).get();
  const pilots=snapshots.docs.slice(0,MAX_PILOTS).map(doc=>doc.data()).filter(pilot=>pilot.workspaceId===workspaceId&&pilot.ownerUid===uid&&SAFE_ID.test(resultText(pilot.pilotId)));
  if(options.pilotId&&!pilots.some(pilot=>pilot.pilotId===options.pilotId))pilots.push(await loadOwnedResultsPilot(uid,workspaceId,options.pilotId,db));
  pilots.sort((a,b)=>(resultIso(b.createdAt)||"").localeCompare(resultIso(a.createdAt)||""));
  const observedAt=new Date().toISOString();const details:WarmReconnectPilotResult[]=[];
  for(let start=0;start<pilots.length;start+=5)details.push(...await Promise.all(pilots.slice(start,start+5).map(pilot=>loadPilotResult(pilot,db,observedAt,options.log))));
  options.log?.info("warm_reconnect.results.loaded",{pilotCount:details.length,pilotsTruncated:snapshots.size>MAX_PILOTS});
  return {schemaVersion:"crm.warm-reconnect-results.v1",observedAt,pilots:details.map(({recipients:_recipients,replyObservation:_observation,...summary})=>{void _recipients;void _observation;return summary;}),pilotsTruncated:snapshots.size>MAX_PILOTS,selectedPilot:details.find(pilot=>pilot.pilotId===options.pilotId)||details[0]||null};
}
