import { describe,it,expect,vi } from "vitest";
import { discoverSeparateDeliveryNotices } from "@/lib/crm/separate-delivery-discovery";
import { warmReconnectEmailKey } from "@/lib/crm/warm-reconnect-dedupe";
vi.mock("@/lib/google/account-token-store",()=>({resolveGoogleAccountTokens:vi.fn()}));
vi.mock("@/lib/google/oauth",()=>({getAccessTokenForUser:vi.fn()}));
vi.mock("@/lib/crm/portfolio-registry",()=>({assertPortfolioRegistryAccess:vi.fn()}));
const sender="mrosser@rossergallery.com", recipient="person@example.com",date=Date.parse("2026-11-03T08:00:00Z");
const pilot={workspaceId:"workspace",sender:{fromEmail:sender}};
const receipt={status:"sent",receiptId:"receipt",recipientId:"recipient",providerMessageId:"aa1",providerThreadId:"aa2",emailKey:warmReconnectEmailKey("workspace",recipient)};
const headers=(h:Record<string,string>)=>Object.entries(h).map(([name,value])=>({name,value}));
const original={id:"aa1",threadId:"aa2",labelIds:["SENT"],internalDate:String(date),payload:{headers:headers({From:sender,To:recipient,"Message-ID":"<original@example.com>"})}};
const enc=(s:string)=>Buffer.from(s).toString("base64url");
const notice={id:"bb1",threadId:"bb2",internalDate:String(date+1000),payload:{mimeType:"multipart/report",headers:headers({From:"mailer-daemon@googlemail.com",To:sender,"Content-Type":"multipart/report; report-type=delivery-status"}),parts:[{mimeType:"message/rfc822",parts:[{headers:original.payload.headers}]},{mimeType:"message/delivery-status",body:{data:enc(`Final-Recipient: rfc822; ${recipient}\r\nAction: failed\r\nStatus: 5.1.1`)}}]}};
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
function provider(list:unknown={messages:[{id:"bb1",threadId:"bb2"}]}, message:unknown=notice){return vi.fn(async(input:RequestInfo | URL)=>{const url=String(input);return json(url.includes("/aa1?")?original:url.includes("/bb1?")?message:list);});}
function run(fetchImpl:typeof fetch,deadlineAt=Date.now()+60000){return discoverSeparateDeliveryNotices({pilot,receipts:[receipt],token:"private-test-token",fetchImpl,deadlineAt});}
describe("separate DSN discovery integration",()=>{
 it("verifies original receipt, finds nested Gmail attachment and returns distinct safe evidence",async()=>{
  const fetchMock=provider(),result=await run(fetchMock);
  expect(result).toMatchObject({status:"complete",verifiedOriginals:1,inspectedCandidates:1,events:[{kind:"separate_delivery_notice",providerThreadId:"bb2",originalProviderThreadId:"aa2",receiptId:"receipt",reportedAction:"failed"}]});
  expect(JSON.stringify(result)).not.toMatch(/private-test-token|person@example|original@example|payload|headers/);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  for(const call of fetchMock.mock.calls as unknown as [string,RequestInit][]){expect(call[1]).toMatchObject({method:"GET",redirect:"manual",cache:"no-store"});expect(call[0]).not.toMatch(/send|modify|trash/);}
 });
 it("reports truncation rather than pretending all reports were inspected",async()=>{expect(await run(provider({messages:[{id:"bb1",threadId:"bb2"}],nextPageToken:"not-stored"}))).toMatchObject({status:"partial",truncated:true});});
 it("does not infer consent or a failed delivery from an unrelated candidate",async()=>{const changed={...notice,payload:{...notice.payload,parts:[]}};expect(await run(provider(undefined,changed))).toMatchObject({status:"complete",events:[]});});
 it("does not search using unverified original identity",async()=>{const fetchMock=vi.fn(async()=>json({...original,labelIds:[]}));expect(await run(fetchMock)).toMatchObject({status:"partial",verifiedOriginals:0,events:[]});expect(fetchMock).toHaveBeenCalledTimes(1);});
 it("stops on auth/provider denial instead of swallowing it as zero",async()=>{for(const status of [401,403,429]){const f=vi.fn(async()=>json({},status));await expect(run(f)).rejects.toMatchObject({status:status===429?429:403});expect(f).toHaveBeenCalledTimes(1);}});
 it("marks network failure and exhausted deadline partial",async()=>{expect(await run(vi.fn(async()=>{throw Error("private provider error");}))).toMatchObject({status:"partial",events:[]});const f=provider();expect(await run(f,Date.now()-1)).toMatchObject({status:"partial"});expect(f).not.toHaveBeenCalled();});
 it("rejects duplicate candidate IDs and provider identity mismatches",async()=>{const f=provider({messages:[{id:"bb1",threadId:"bb2"},{id:"bb1",threadId:"bb2"}]});expect(await run(f)).toMatchObject({status:"partial",events:[]});expect(f).toHaveBeenCalledTimes(2);expect(await run(provider(undefined,{...notice,id:"cc1"}))).toMatchObject({status:"partial",inspectedCandidates:0,events:[]});});
});
