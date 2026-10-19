import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { assertPortfolioRegistryAccess } from "@/lib/crm/portfolio-registry";
import { assertResultsOwner, buildWarmReconnectPilotResult, loadOwnedResultsPilot, readResultsReceipts, type ResultDocument } from "@/lib/crm/warm-reconnect-results";

vi.mock("@/lib/crm/portfolio-registry",()=>({assertPortfolioRegistryAccess:vi.fn()}));
const now="2026-10-08T20:00:00.000Z";
const fingerprints={artifactFingerprint:"artifact",audienceFingerprint:"audience",actionFingerprint:"action"};
const recipients=Array.from({length:5},(_,index)=>({recipientId:`recipient-${index}`,personId:`person-${index}`,contactPointId:`point-${index}`,emailKey:`email-${index}`,greetingName:`Person ${index}`}));
const pilot:ResultDocument={pilotId:"pilot-1",workspaceId:"workspace",ownerUid:"owner",status:"launch_requested",tranche:"initial_5",createdAt:now,recipients,approval:{approvalId:"approval-1"},fingerprints,sender:{fromEmail:"mrosser@rossergallery.com"}};
const receipts=recipients.map((recipient,index)=>({...recipient,...fingerprints,receiptId:`receipt-${index}`,pilotId:pilot.pilotId,workspaceId:pilot.workspaceId,ownerUid:pilot.ownerUid,approvalId:"approval-1",status:"sent",sentAtMs:Date.parse(now)-1000,providerMessageId:`ab${index}`,providerThreadId:`ab${index}`}));
const executor={pilotId:pilot.pilotId,workspaceId:pilot.workspaceId,complete:true,halted:false,activeReceiptId:null,sentCount:5,claimedCount:5};
const observed=<T,>(value:T)=>({status:"observed" as const,value});
function project(overrides:Partial<Parameters<typeof buildWarmReconnectPilotResult>[0]>={}){return buildWarmReconnectPilotResult({pilot,receipts:observed(receipts),events:observed([]),executor:observed(executor),observation:observed(null),observedAt:now,...overrides});}
function event(recipientId:string,occurredAt:string,extra:ResultDocument={}){return {workspaceId:pilot.workspaceId,pilotId:pilot.pilotId,recipientId,occurredAt,eventType:"preferences_updated",campaignApprovalId:"approval-1",...fingerprints,topics:{rosser_gallery:true,rt_solutions:false},...extra};}

function batchFixture(count:number){
  const batchRecipients=Array.from({length:count},(_,index)=>({...recipients[0],recipientId:`recipient-${index}`,personId:`person-${index}`,contactPointId:`point-${index}`,emailKey:`email-${index}`}));
  const batchReceipts=batchRecipients.map((recipient,index)=>({...receipts[0],...recipient,receiptId:`receipt-${index}`,providerMessageId:`ab${index.toString(16)}`,providerThreadId:`ab${index.toString(16)}`}));
  return {pilot:{...pilot,tranche:"follow_on",recipientCap:count,recipients:batchRecipients},receipts:observed(batchReceipts),executor:observed({...executor,sentCount:count,claimedCount:count})};
}

describe("warm outreach results projection",()=>{
  it.each([11,20])("reports all %i follow-on sends without treating supported batches as capped",count=>{
    const fixture=batchFixture(count);const result=project(fixture);
    expect(result.sent).toMatchObject({status:"observed",value:count});expect(result.complete).toBe(true);expect(result.recipients).toHaveLength(count);
    expect(project({...fixture,receipts:observed(fixture.receipts.value.slice(0,count-1))}).complete).toBe(false);
  });
  it("keeps an oversized twenty-one-person report unknown and incomplete",()=>{
    const result=project(batchFixture(21));expect(result.sent).toMatchObject({status:"unknown",value:null});expect(result.complete).toBe(false);
  });
  it("reports five durable sends and observed zero confirmations, but unknown uncollected outcomes",()=>{
    const result=project();expect(result.complete).toBe(true);expect(result.sent.value).toBe(5);expect(result.confirmedChoices.any).toMatchObject({status:"observed",value:0});expect(result.unsubscribed.value).toBe(0);
    for(const key of ["replies","bounces","opens","clicks","conversions"] as const)expect(result[key]).toMatchObject({status:"unknown",value:null});
  });
  it("does not infer complete from pilot status or an executor counter without exact bound receipts",()=>{
    expect(project({receipts:observed(receipts.slice(0,4))}).complete).toBe(false);
    expect(project({executor:observed({...executor,activeReceiptId:"pending"})}).complete).toBe(false);
    expect(project({executor:observed({...executor,halted:true})}).complete).toBe(false);
    expect(project({executor:observed({...executor,workspaceId:"other"})}).complete).toBe(false);
  });
  it("fails closed on a cross-owner, changed-approval, duplicate or malformed receipt",()=>{
    for(const patch of [{ownerUid:"other"},{approvalId:"other"},{providerMessageId:"not-valid"},{emailKey:"other"}]){
      const result=project({receipts:observed([{...receipts[0],...patch},...receipts.slice(1)])});expect(result.sent.value).toBeNull();expect(result.complete).toBe(false);
    }
    expect(project({receipts:observed([receipts[0],receipts[0]])}).sent.value).toBeNull();
  });
  it("counts latest choices per recipient, preserves both topics and gives sticky unsubscribe precedence",()=>{
    const events=[event("recipient-0","2026-10-08T19:50:00Z"),event("recipient-0","2026-10-08T19:51:00Z",{topics:{rosser_gallery:false,rt_solutions:true}}),event("recipient-1","2026-10-08T19:52:00Z",{topics:{rosser_gallery:true,rt_solutions:true}}),event("recipient-1","2026-10-08T19:53:00Z",{eventType:"unsubscribed"}),event("recipient-1","2026-10-08T19:54:00Z")];
    const result=project({events:observed(events)});expect(result.confirmedChoices.any.value).toBe(1);expect(result.confirmedChoices.rosserGallery.value).toBe(0);expect(result.confirmedChoices.rtSolutions.value).toBe(1);expect(result.unsubscribed.value).toBe(1);expect(result.recipients[1].unsubscribedThroughBatch).toBe(true);
  });
  it("keeps capped/failed/malformed or cross-workspace preference data unknown",()=>{
    for(const events of [{status:"unknown" as const,reason:"capped"},observed([event("recipient-0",now,{workspaceId:"other"})]),observed([event("recipient-0",now,{topics:{}})])])expect(project({events}).confirmedChoices.any.value).toBeNull();
    expect(project({receipts:{status:"unknown",reason:"unavailable"}}).sent.value).toBeNull();
  });
  it("counts deduplicated attributed response observations only for the exact current sent set",()=>{
    const response={providerMessageId:"cc1",providerThreadId:"ab0",receiptId:"receipt-0",recipientId:"recipient-0",kind:"reply",occurredAt:now};
    const observation={schemaVersion:"crm.warm-reconnect-response-observation.v1",pilotId:pilot.pilotId,workspaceId:pilot.workspaceId,ownerUid:pilot.ownerUid,accountEmail:"mrosser@rossergallery.com",status:"complete",observedAt:now,inspectedThreads:5,expectedThreads:5,sentMessageIds:receipts.map(row=>row.providerMessageId),events:[response,response]};
    expect(project({observation:observed(observation)}).replies.value).toBe(1);
    expect(project({observation:observed({...observation,events:[]})}).replies).toMatchObject({status:"observed",value:0});
    for(const change of [{status:"partial"},{ownerUid:"other"},{sentMessageIds:["ab0"]},{accountEmail:"other@example.com"}])expect(project({observation:observed({...observation,...change})}).replies.value).toBeNull();
    expect(project({observation:observed(observation)}).bounces.value).toBeNull();
  });
  it("does not return capability digests, tokens, raw headers or message bodies",()=>{
    const result=project({receipts:observed(receipts.map(receipt=>({...receipt,preferenceCapabilityDigest:"secret-link",body:"private-body",headers:"private-header"})))});
    expect(JSON.stringify(result)).not.toMatch(/secret-link|private-body|private-header|CapabilityDigest/);
  });
});

describe("outcome ownership",()=>{
  it.each([20,21])("reads the overflow sentinel and handles %i receipt rows without silent truncation",async(count)=>{
    const rows=batchFixture(count).receipts.value;let cap=Infinity;
    const query={select:()=>query,limit:(limit:number)=>{cap=limit;return query;},get:async()=>({size:Math.min(rows.length,cap),docs:rows.slice(0,cap).map(row=>({id:row.receiptId,data:()=>row}))})};
    const db={collection:()=>({doc:()=>({collection:()=>query})})} as unknown as Firestore;
    const result=readResultsReceipts("pilot-1",db);
    if(count===20)await expect(result).resolves.toHaveLength(20);else await expect(result).rejects.toMatchObject({status:409});
    expect(cap).toBe(21);
  });
  beforeEach(()=>vi.mocked(assertPortfolioRegistryAccess).mockResolvedValue({workspaceId:"workspace",role:"owner"}));
  it("requires owner role even when an admin has registry access",async()=>{
    vi.mocked(assertPortfolioRegistryAccess).mockResolvedValue({workspaceId:"workspace",role:"admin"});
    await expect(assertResultsOwner("owner",{} as Firestore)).rejects.toMatchObject({status:403});
  });
  it("rejects another owner's pilot without returning its fields",async()=>{
    const db={collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({...pilot,ownerUid:"other"})})})})} as unknown as Firestore;
    await expect(loadOwnedResultsPilot("owner","workspace","pilot-1",db)).rejects.toMatchObject({status:404});
    await expect(loadOwnedResultsPilot("owner","workspace","../other",db)).rejects.toMatchObject({status:400});
  });
  it("rejects a receipt whose stored identifier differs from its document",async()=>{
    const query={select:()=>query,limit:()=>query,get:async()=>({size:1,docs:[{id:"different-document",data:()=>receipts[0]}]})};
    const db={collection:()=>({doc:()=>({collection:()=>query})})} as unknown as Firestore;
    await expect(readResultsReceipts("pilot-1",db)).rejects.toMatchObject({status:409});
  });
});
