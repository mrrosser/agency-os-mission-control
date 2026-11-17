import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth:vi.fn(), load:vi.fn() }));
vi.mock("@/lib/api/auth", () => ({ requireFirebaseAuth:mocks.auth }));
vi.mock("@/lib/crm/warm-reconnect-repository", () => ({ loadWarmReconnectSenderProfilesForUid:mocks.load }));
vi.mock("@/lib/api/handler", () => ({
  ApiError:class extends Error { constructor(public status:number,message:string) { super(message); } },
  withApiHandler:(fn:(value:unknown)=>Promise<Response>) => (request:NextRequest) => fn({request,log:undefined}),
}));
import { GET } from "@/app/api/crm/warm-reconnect/sender-profiles/route";
describe("sender status route", () => {
  beforeEach(() => { mocks.auth.mockReset(); mocks.load.mockReset(); });
  it("authenticates before reading profiles", async () => {
    mocks.auth.mockRejectedValue(new Error("unauthorized"));
    await expect(GET(new NextRequest("https://example.test/api/crm/warm-reconnect/sender-profiles"), undefined as never)).rejects.toThrow("unauthorized");
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("rejects caller-supplied profile, owner or other query parameters", async () => {
    mocks.auth.mockResolvedValue({uid:"owner"});
    await expect(GET(new NextRequest("https://example.test/api/crm/warm-reconnect/sender-profiles?uid=other"), undefined as never)).rejects.toMatchObject({status:400});
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("passes authenticated identity only and prevents response caching", async () => {
    mocks.auth.mockResolvedValue({uid:"owner"}); mocks.load.mockResolvedValue({googleProfiles:[],providerActions:"none"});
    const result = await GET(new NextRequest("https://example.test/api/crm/warm-reconnect/sender-profiles"), undefined as never);
    expect(mocks.load).toHaveBeenCalledWith("owner");
    expect(result.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await result.json()).toEqual({googleProfiles:[],providerActions:"none"});
  });
});
