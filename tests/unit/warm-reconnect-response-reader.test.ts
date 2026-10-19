import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { resolveGoogleAccountTokens } from "@/lib/google/account-token-store";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { assertPortfolioRegistryAccess } from "@/lib/crm/portfolio-registry";
import { warmReconnectEmailKey } from "@/lib/crm/warm-reconnect-dedupe";
import { classifyWarmReconnectThread, refreshWarmReconnectResponsesForUid, resolveWarmReconnectReadToken } from "@/lib/crm/warm-reconnect-response-reader";
import type { ResultDocument } from "@/lib/crm/warm-reconnect-results";

vi.mock("@/lib/google/account-token-store",()=>({resolveGoogleAccountTokens:vi.fn()}));
vi.mock("@/lib/google/oauth",()=>({getAccessTokenForUser:vi.fn()}));
vi.mock("@/lib/crm/portfolio-registry",()=>({assertPortfolioRegistryAccess:vi.fn()}));
const workspaceId="workspace";const email="person@example.com";const date=Date.parse("2026-10-08T19:40:00Z");
const recipient={recipientId:"recipient",personId:"person",contactPointId:"point",emailKey:warmReconnectEmailKey(workspaceId,email)};
const fingerprints={artifactFingerprint:"artifact",audienceFingerprint:"audience",actionFingerprint:"action"};
const pilot={pilotId:"pilot",workspaceId,ownerUid:"owner",sender:{fromEmail:"mrosser@rossergallery.com"},approval:{approvalId:"approval"},fingerprints,recipients:[recipient]};
const receipt={...recipient,...fingerprints,receiptId:"receipt",pilotId:"pilot",workspaceId,ownerUid:"owner",approvalId:"approval",status:"sent",providerMessageId:"ab1",providerThreadId:"ab1",sentAtMs:date+900};
function message(id:string,headers:Record<string,string>,extra:ResultDocument={}){return{id,threadId:"ab1",labelIds:[],internalDate:String(date+1000),payload:{headers:Object.entries(headers).map(([name,value])=>({name,value}))},...extra};}
const original=message("ab1",{"From":"Marcus <mrosser@rossergallery.com>","To":email,"Message-ID":"<original@example.com>"},{labelIds:["SENT"],internalDate:String(date)});
const reply=(id="cd1",headers:Record<string,string>={})=>message(id,{"From":email,"In-Reply-To":"<original@example.com>",...headers});
const thread=(messages:ResultDocument[])=>({id:"ab1",messages:[original,...messages]});
const resolution={registryFound:true,profileMapped:true,record:{accountId:"account",profileId:"rosser_gallery_work",tokens:{scope:"openid https://www.googleapis.com/auth/gmail.readonly",refreshToken:"existing-secret"}}};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"content-type":"application/json"}});

describe("exact outreach thread attribution",()=>{
  it("uses original Message-ID references and known recipient instead of subject alone",()=>{
    const events=classifyWarmReconnectThread({pilot,receipt,thread:thread([reply(),reply("cd2",{"In-Reply-To":"<other@example.com>","Subject":"A quick hello from Marcus"}),reply("cd3",{"From":"unrelated@example.com"}),reply("cd4",{"In-Reply-To":"","References":"<other@example.com> <original@example.com>"})])});
    expect(events.map(row=>row.kind)).toEqual(["reply","unattributed","unattributed","reply"]);
  });
  it("excludes own sent messages and distinguishes automatic responses and structured delivery notices",()=>{
    const events=classifyWarmReconnectThread({pilot,receipt,thread:thread([reply("cd1",{"Auto-Submitted":"auto-replied"}),reply("cd2",{"From":"mailer-daemon@example.com","Content-Type":"multipart/report; report-type=delivery-status"}),message("cd3",{"From":"mrosser@rossergallery.com"},{labelIds:["SENT"]})])});
    expect(events.map(row=>row.kind)).toEqual(["automatic_response","delivery_notice"]);
    expect(JSON.stringify(events)).not.toMatch(/headers|payload|original@example|person@example|Auto-Submitted/);
  });
  it("fails closed when the original account, recipient, ID or thread differs",()=>{
    for(const changed of [{id:"different",messages:[original]},thread([{...original,id:"ab1"}]),{id:"ab1",messages:[{...original,payload:{headers:[]}}]}])expect(()=>classifyWarmReconnectThread({pilot,receipt,thread:changed})).toThrow();
    expect(()=>classifyWarmReconnectThread({pilot,receipt:{...receipt,emailKey:"different"},thread:thread([])})).toThrow();
  });
});

describe("existing Gallery read connection",()=>{
  beforeEach(()=>{
    vi.mocked(resolveGoogleAccountTokens).mockResolvedValue(resolution);
    vi.mocked(getAccessTokenForUser).mockResolvedValue("in-memory-token");
    vi.mocked(assertPortfolioRegistryAccess).mockResolvedValue({workspaceId,role:"owner"});
  });
  it("verifies provider mailbox and stable binding using only existing read scope",async()=>{
    const fetchMock=vi.fn().mockResolvedValue(json({emailAddress:"mrosser@rossergallery.com"}));
    expect(await resolveWarmReconnectReadToken("owner","mrosser@rossergallery.com",{fetchImpl:fetchMock})).toBe("in-memory-token");
    expect(getAccessTokenForUser).toHaveBeenCalledWith("owner",undefined,{profileId:"rosser_gallery_work"});
    expect(fetchMock).toHaveBeenCalledWith("https://gmail.googleapis.com/gmail/v1/users/me/profile?fields=emailAddress",expect.objectContaining({method:"GET",redirect:"manual"}));
  });
  it("fails closed on provider identity mismatch without requesting a thread",async()=>{
    const fetchMock=vi.fn().mockResolvedValue(json({emailAddress:"different@example.com"}));
    await expect(resolveWarmReconnectReadToken("owner","mrosser@rossergallery.com",{fetchImpl:fetchMock})).rejects.toMatchObject({status:409});expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects send-only grant and profile/account changes without broadening scope",async()=>{
    vi.mocked(resolveGoogleAccountTokens).mockResolvedValueOnce({...resolution,record:{...resolution.record,tokens:{scope:"https://www.googleapis.com/auth/gmail.send"}}});
    const fetchMock=vi.fn().mockImplementation(async()=>json({emailAddress:"mrosser@rossergallery.com"}));
    await expect(resolveWarmReconnectReadToken("owner","mrosser@rossergallery.com",{fetchImpl:fetchMock})).rejects.toMatchObject({status:403});expect(getAccessTokenForUser).not.toHaveBeenCalled();
    vi.mocked(resolveGoogleAccountTokens).mockResolvedValueOnce(resolution).mockResolvedValueOnce({...resolution,record:{...resolution.record,accountId:"different"}});
    await expect(resolveWarmReconnectReadToken("owner","mrosser@rossergallery.com",{fetchImpl:fetchMock})).rejects.toMatchObject({status:409});
  });
  it("records bounded idempotent safe observations, never bodies, headers or capabilities",async()=>{
    let saved:ResultDocument|undefined;const writes:ResultDocument[]=[];
    const ref=(path:string):unknown=>({collection:(name:string)=>ref(`${path}/${name}`),doc:(id:string)=>ref(`${path}/${id}`),select:()=>ref(path),limit:()=>ref(path),get:async()=>path.endsWith("/delivery_receipts")?{size:1,docs:[{id:receipt.receiptId,data:()=>receipt}]}:path.endsWith("/latest")?{data:()=>saved}:{exists:true,data:()=>pilot},path});
    const db={collection:(name:string)=>ref(name),runTransaction:async(fn:(tx:unknown)=>Promise<void>)=>fn({get:async()=>({data:()=>saved}),set:(_ref:unknown,value:ResultDocument)=>{saved=value;writes.push(value);}})} as unknown as Firestore;
    const providerThread=thread([reply("cd1")]);
    providerThread.messages[1].payload={...providerThread.messages[1].payload as object,body:{data:"private-body"}};
    const fetchMock=vi.fn().mockImplementation(async(url:string)=>json(url.includes("/profile")?{emailAddress:"mrosser@rossergallery.com"}:providerThread));
    const options={uid:"owner",pilotId:"pilot",correlationId:"correlation",db,fetchImpl:fetchMock};
    await refreshWarmReconnectResponsesForUid(options);await refreshWarmReconnectResponsesForUid(options);
    expect(writes).toHaveLength(2);expect(saved).toMatchObject({status:"complete",inspectedThreads:1,expectedThreads:1});expect(saved?.events).toHaveLength(1);
    expect(JSON.stringify(saved)).not.toMatch(/private-body|payload|headers|in-memory-token|original@example|person@example/);
    const requested=fetchMock.mock.calls.map(call=>String(call[0]));expect(requested.filter(url=>url.includes("/threads/")).every(url=>url.includes("format=metadata")&&!url.includes("format=full"))).toBe(true);
  });
  it("never converts failed thread reads to observed zero responses",async()=>{
    let saved:ResultDocument|undefined;
    const ref=(path:string):unknown=>({collection:(name:string)=>ref(`${path}/${name}`),doc:(id:string)=>ref(`${path}/${id}`),select:()=>ref(path),limit:()=>ref(path),get:async()=>path.endsWith("/delivery_receipts")?{size:1,docs:[{id:receipt.receiptId,data:()=>receipt}]}:{exists:true,data:()=>pilot}});
    const db={collection:(name:string)=>ref(name),runTransaction:async(fn:(tx:unknown)=>Promise<void>)=>fn({get:async()=>({data:()=>undefined}),set:(_ref:unknown,value:ResultDocument)=>{saved=value;}})} as unknown as Firestore;
    const fetchMock=vi.fn().mockImplementation(async(url:string)=>url.includes("/profile")?json({emailAddress:"mrosser@rossergallery.com"}):json({error:"private-provider-error"},503));
    await refreshWarmReconnectResponsesForUid({uid:"owner",pilotId:"pilot",correlationId:"correlation",db,fetchImpl:fetchMock});
    expect(saved).toMatchObject({status:"partial",inspectedThreads:0,expectedThreads:1});expect(JSON.stringify(saved)).not.toContain("private-provider-error");
  });

  it("observes twenty exact threads in two bounded metadata waves without persisting raw mail",async()=>{
    const batchRecipients=Array.from({length:20},(_,index)=>({...recipient,recipientId:`recipient-${index}`,personId:`person-${index}`,contactPointId:`point-${index}`,emailKey:warmReconnectEmailKey(workspaceId,`person${index}@example.test`)}));
    const batchPilot={...pilot,tranche:"follow_on",recipientCap:20,recipients:batchRecipients};
    const batchReceipts=batchRecipients.map((row,index)=>({...receipt,...row,receiptId:`receipt-${index}`,providerMessageId:`ab${index.toString(16)}`,providerThreadId:`ab${index.toString(16)}`}));
    const threads=new Map(batchReceipts.map((row,index)=>{
      const threadId=row.providerThreadId;const messageId=`<original-${index}@example.test>`;const address=`person${index}@example.test`;
      return [threadId,{id:threadId,messages:[
        message(row.providerMessageId,{From:"Marcus <mrosser@rossergallery.com>",To:address,"Message-ID":messageId},{threadId,labelIds:["SENT"],internalDate:String(date)}),
        message(`cd${index.toString(16)}`,{From:address,"In-Reply-To":messageId},{threadId}),
      ]}];
    }));
    let saved:ResultDocument|undefined;let cap=Infinity;
    const ref=(path:string):unknown=>({collection:(name:string)=>ref(`${path}/${name}`),doc:(id:string)=>ref(`${path}/${id}`),select:()=>ref(path),limit:(value:number)=>{cap=value;return ref(path);},get:async()=>path.endsWith("/delivery_receipts")?{size:Math.min(cap,batchReceipts.length),docs:batchReceipts.slice(0,cap).map(row=>({id:row.receiptId,data:()=>row}))}:{exists:true,data:()=>batchPilot}});
    const db={collection:(name:string)=>ref(name),runTransaction:async(fn:(tx:unknown)=>Promise<void>)=>fn({get:async()=>({data:()=>undefined}),set:(_ref:unknown,value:ResultDocument)=>{saved=value;}})} as unknown as Firestore;
    let active=0;let peak=0;const readIds:string[]=[];
    const fetchMock=vi.fn().mockImplementation(async(url:string)=>{
      if(url.includes("/profile"))return json({emailAddress:"mrosser@rossergallery.com"});
      const parsed=new URL(url);expect(parsed.searchParams.get("format")).toBe("metadata");
      const id=parsed.pathname.split("/").at(-1)!;readIds.push(id);active++;peak=Math.max(peak,active);
      await new Promise(resolve=>setTimeout(resolve,0));active--;
      return json(threads.get(id));
    });
    await refreshWarmReconnectResponsesForUid({uid:"owner",pilotId:"pilot",correlationId:"twenty-thread-observation",db,fetchImpl:fetchMock});
    expect(peak).toBe(10);expect(active).toBe(0);expect(readIds.sort()).toEqual([...threads.keys()].sort());
    expect(fetchMock).toHaveBeenCalledTimes(21);expect(cap).toBe(21);
    expect(saved).toMatchObject({status:"complete",inspectedThreads:20,expectedThreads:20});expect(saved?.events).toHaveLength(20);
    expect(JSON.stringify(saved)).not.toMatch(/headers|payload|in-memory-token|original-\d+@|person\d+@|private-body/);
  });
});
