import { NextRequest } from "next/server";
import { beforeEach,describe,it,expect,vi } from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),refresh:vi.fn(),parse:vi.fn()}));
vi.mock("@/lib/api/auth",()=>({requireFirebaseAuth:mocks.auth}));
vi.mock("@/lib/crm/separate-delivery-discovery",()=>({refreshSeparateDeliveryNoticesForUid:mocks.refresh}));
vi.mock("@/lib/crm/warm-reconnect-activation",()=>({parseBoundedWarmReconnectJson:mocks.parse}));
vi.mock("@/lib/api/handler",()=>({ApiError:class extends Error{constructor(public status:number,message:string){super(message);}},withApiHandler:(fn:(v:unknown)=>Promise<Response>)=>(request:Request)=>fn({request,log:undefined,correlationId:"test"})}));
import { POST } from "@/app/api/crm/warm-reconnect/delivery-notices/refresh/route";
describe("separate report endpoint boundary",()=>{
 beforeEach(()=>{mocks.auth.mockReset();mocks.refresh.mockReset();mocks.parse.mockReset();});
 it("requires authentication before parsing or accessing mailbox",async()=>{
  mocks.auth.mockRejectedValue(new Error("unauthorized"));
  await expect(POST(new NextRequest("https://example.test/api/crm/warm-reconnect/delivery-notices/refresh",{method:"POST"}),undefined as never)).rejects.toThrow("unauthorized");
  expect(mocks.parse).not.toHaveBeenCalled();expect(mocks.refresh).not.toHaveBeenCalled();
 });
 it("passes only authenticated owner and bounded parsed batch to read service",async()=>{
  mocks.auth.mockResolvedValue({uid:"owner"});mocks.parse.mockResolvedValue({pilotId:"pilot"});mocks.refresh.mockResolvedValue({schemaVersion:"crm.separate-delivery-observation.v1",status:"partial",events:[]});
  const response=await POST(new NextRequest("https://example.test/api/crm/warm-reconnect/delivery-notices/refresh",{method:"POST",body:'{"pilotId":"pilot"}'}),undefined as never);
  expect(mocks.parse.mock.calls[0][2]).toBe(2048);expect(mocks.refresh).toHaveBeenCalledWith({uid:"owner",pilotId:"pilot",log:undefined});
  expect(response.headers.get("cache-control")).toContain("no-store");expect(await response.json()).toMatchObject({observation:{status:"partial",events:[]}});
 });
 it("rejects extra query parameters before discovery",async()=>{
  mocks.auth.mockResolvedValue({uid:"owner"});
  await expect(POST(new NextRequest("https://example.test/api/crm/warm-reconnect/delivery-notices/refresh?send=true",{method:"POST"}),undefined as never)).rejects.toMatchObject({status:400});expect(mocks.refresh).not.toHaveBeenCalled();
 });
});
