import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/handler";
import { POST } from "@/app/api/crm/warm-reconnect/pilots/[pilotId]/return-to-review/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { returnExpiredWarmReconnectPilotToReviewForUid } from "@/lib/crm/warm-reconnect-repository";
vi.mock("@/lib/api/auth",()=>({requireFirebaseAuth:vi.fn()}));
vi.mock("@/lib/crm/warm-reconnect-repository",()=>({returnExpiredWarmReconnectPilotToReviewForUid:vi.fn()}));
const auth=vi.mocked(requireFirebaseAuth);
const recover=vi.mocked(returnExpiredWarmReconnectPilotToReviewForUid);
const fingerprint=`sha256:${"a".repeat(64)}`;
const body={expiredApprovalId:"approval-old",expectedArtifactFingerprint:fingerprint,expectedAudienceFingerprint:fingerprint,expectedActionFingerprint:fingerprint,reason:"Expired before any delivery."};
const route="https://example.test/api/crm/warm-reconnect/pilots/pilot-1/return-to-review";
const context={params:Promise.resolve({pilotId:"pilot-1"})};
function request(payload:unknown=body,key:string|null="recover-once",url=route) {return new NextRequest(url,{method:"POST",headers:{authorization:"Bearer fixture","content-type":"application/json","x-correlation-id":"recovery-route-test",...(key?{"x-idempotency-key":key}:{})},body:JSON.stringify(payload)});}
beforeEach(()=>{vi.clearAllMocks();auth.mockResolvedValue({uid:"owner"} as never);recover.mockResolvedValue({pilot:{pilotId:"pilot-1",status:"needs_campaign_approval",approval:null,launchRequestedAt:null},replayed:false} as never);});
describe("return-to-review route",()=>{
  it("routes authenticated owner identity, exact bindings and idempotency without provider authority",async()=>{const response=await POST(request(),context);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toContain("no-store");expect(response.headers.get("pragma")).toBe("no-cache");expect(await response.json()).toMatchObject({providerAction:false,pilot:{status:"needs_campaign_approval",approval:null,launchRequestedAt:null}});expect(recover).toHaveBeenCalledWith(expect.objectContaining({uid:"owner",pilotId:"pilot-1",request:body,idempotencyKey:"recover-once",correlationId:"recovery-route-test"}));});
  it("requires authentication",async()=>{auth.mockRejectedValue(new ApiError(401,"Sign in required"));const r=await POST(request(),context);expect(r.status).toBe(401);expect(recover).not.toHaveBeenCalled();expect(r.headers.get("cache-control")).toContain("no-store");});
  it("preserves repository owner denial",async()=>{recover.mockRejectedValue(new ApiError(403,"Owner required"));expect((await POST(request(),context)).status).toBe(403);});
  it("preserves execution-evidence conflict without retry",async()=>{recover.mockRejectedValue(new ApiError(409,"Dispatch evidence exists"));expect((await POST(request(),context)).status).toBe(409);expect(recover).toHaveBeenCalledTimes(1);});
  it.each([{...body,expiredApprovalId:""},{...body,reason:""},{...body,expectedActionFingerprint:"bad"},{...body,approve:true},{...body,sendsAuthorized:true},{...body,reason:"x".repeat(501)}])("rejects malformed or authority-widening body %j",async payload=>{expect((await POST(request(payload),context)).status).toBe(400);expect(recover).not.toHaveBeenCalled();});
  it("rejects query parameters and missing idempotency key",async()=>{expect((await POST(request(body,"recover",route+"?send=true"),context)).status).toBe(400);expect((await POST(request(body,null),context)).status).toBe(400);expect(recover).not.toHaveBeenCalled();});
  it("rejects an oversized body before repository access",async()=>{const r=await POST(request({...body,reason:"x".repeat(9000)}),context);expect([400,413]).toContain(r.status);expect(recover).not.toHaveBeenCalled();});
});
