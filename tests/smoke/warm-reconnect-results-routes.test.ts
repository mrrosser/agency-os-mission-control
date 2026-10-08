import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/crm/warm-reconnect/results/route";
import { POST } from "@/app/api/crm/warm-reconnect/results/refresh/route";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/handler";
import { loadWarmReconnectResultsForUid } from "@/lib/crm/warm-reconnect-results";
import { refreshWarmReconnectResponsesForUid } from "@/lib/crm/warm-reconnect-response-reader";

vi.mock("@/lib/api/auth",()=>({requireFirebaseAuth:vi.fn()}));
vi.mock("@/lib/crm/warm-reconnect-results",async importOriginal=>({...await importOriginal<typeof import("@/lib/crm/warm-reconnect-results")>(),loadWarmReconnectResultsForUid:vi.fn()}));
vi.mock("@/lib/crm/warm-reconnect-response-reader",()=>({refreshWarmReconnectResponsesForUid:vi.fn()}));
const context=()=>({params:Promise.resolve({})});
const result={schemaVersion:"crm.warm-reconnect-results.v1",observedAt:"2026-10-08T20:00:00Z",pilots:[],pilotsTruncated:false,selectedPilot:null} as const;
function request(path="",body?:unknown){return new Request(`http://localhost/api/crm/warm-reconnect/results${path}`,{method:body===undefined?"GET":"POST",headers:{authorization:"Bearer existing-user", "content-type":"application/json","x-correlation-id":"results-correlation"},...(body===undefined?{}:{body:JSON.stringify(body)})});}
describe("outreach result routes",()=>{
  beforeEach(()=>{
    vi.mocked(requireFirebaseAuth).mockResolvedValue({uid:"owner"} as never);
    vi.mocked(loadWarmReconnectResultsForUid).mockResolvedValue({...result,pilots:[]});
    vi.mocked(refreshWarmReconnectResponsesForUid).mockResolvedValue(undefined);
  });
  it("requires sign-in and never invokes the reader for unauthenticated requests",async()=>{
    vi.mocked(requireFirebaseAuth).mockRejectedValue(new ApiError(401,"Sign in"));
    for(const response of [await GET(request() as never,context()),await POST(request("/refresh",{pilotId:"pilot"}) as never,context())]){expect(response.status).toBe(401);expect(response.headers.get("cache-control")).toContain("no-store");}
    expect(loadWarmReconnectResultsForUid).not.toHaveBeenCalled();expect(refreshWarmReconnectResponsesForUid).not.toHaveBeenCalled();
  });
  it("returns private owner results with correlation ID and makes no provider refresh",async()=>{
    const response=await GET(request("?pilotId=pilot") as never,context());
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");expect(response.headers.get("x-correlation-id")).toBe("results-correlation");expect(await response.json()).toEqual(result);
    expect(loadWarmReconnectResultsForUid).toHaveBeenCalledWith("owner",expect.objectContaining({pilotId:"pilot"}));expect(refreshWarmReconnectResponsesForUid).not.toHaveBeenCalled();
  });
  it("rejects arbitrary filters, duplicate identifiers and path traversal",async()=>{
    for(const query of ["?ownerUid=other","?pilotId=a&pilotId=b","?pilotId=..%2Fsecret","?pilotId="])expect((await GET(request(query) as never,context())).status).toBe(400);
    expect(loadWarmReconnectResultsForUid).not.toHaveBeenCalled();
  });
  it("refreshes only an explicit owned batch and then returns its result",async()=>{
    const response=await POST(request("/refresh",{pilotId:"pilot"}) as never,context());expect(response.status).toBe(200);
    expect(refreshWarmReconnectResponsesForUid).toHaveBeenCalledWith(expect.objectContaining({uid:"owner",pilotId:"pilot",correlationId:"results-correlation"}));expect(loadWarmReconnectResultsForUid).toHaveBeenCalledWith("owner",expect.objectContaining({pilotId:"pilot"}));
  });
  it("rejects broad mailbox/body flags and oversized refresh input",async()=>{
    for(const body of [{pilotId:"pilot",query:"in:inbox"},{pilotId:"pilot",send:true},{pilotId:"../secret"},{pilotId:"x".repeat(3000)}])expect((await POST(request("/refresh",body) as never,context())).status).toBeGreaterThanOrEqual(400);
    expect(refreshWarmReconnectResponsesForUid).not.toHaveBeenCalled();
  });
  it("preserves owner or provider identity rejection without returning a false successful report",async()=>{
    vi.mocked(refreshWarmReconnectResponsesForUid).mockRejectedValue(new ApiError(409,"Gallery identity mismatch"));
    const response=await POST(request("/refresh",{pilotId:"pilot"}) as never,context());expect(response.status).toBe(409);expect(response.headers.get("cache-control")).toContain("no-store");expect(loadWarmReconnectResultsForUid).not.toHaveBeenCalled();
  });
});
