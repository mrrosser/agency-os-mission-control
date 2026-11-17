import {beforeEach,describe,it,expect,vi} from "vitest";
import type {Firestore} from "firebase-admin/firestore";
const mocks=vi.hoisted(()=>({access:vi.fn(),tokens:vi.fn(),scope:vi.fn()}));
vi.mock("@/lib/crm/portfolio-registry",()=>({assertPortfolioRegistryAccess:mocks.access}));
vi.mock("@/lib/google/account-token-store",()=>({resolveGoogleAccountTokens:mocks.tokens}));
vi.mock("@/lib/google/oauth",()=>({isGoogleTokenScopeBoundedForPreset:mocks.scope}));
import {loadWarmReconnectSenderProfilesForUid} from "@/lib/crm/warm-reconnect-repository";
describe("independent sender status owner boundary",()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.access.mockResolvedValue({workspaceId:"workspace",role:"owner"});mocks.scope.mockReturnValue(true);mocks.tokens.mockResolvedValue({profileMapped:true,record:{accountId:"account",tokens:{accessToken:"private",scope:"send",accountEmail:"sender@example.com"}}});});
 it("reads only allowed sender profiles without candidate/history scans or provider actions",async()=>{
  const collection=vi.fn(()=>{throw Error("unexpected campaign collection read");});const db={collection} as unknown as Firestore;
  const result=await loadWarmReconnectSenderProfilesForUid("owner",db);
  expect(result.schemaVersion).toBe("crm.warm-reconnect-sender-profiles.v1");expect(result.providerActions).toBe("none");expect(result.googleProfiles.length).toBeGreaterThan(0);
  expect(mocks.access).toHaveBeenCalledWith("owner",db);expect(collection).not.toHaveBeenCalled();
  expect(mocks.tokens.mock.calls.map(c=>c[1]).every(id=>id.endsWith("_send"))).toBe(true);
  expect(JSON.stringify(result)).not.toContain("private");
 });
 it("denies non-owner before reading credentials",async()=>{
  mocks.access.mockResolvedValue({workspaceId:"workspace",role:"admin"});
  await expect(loadWarmReconnectSenderProfilesForUid("admin",{} as Firestore)).rejects.toMatchObject({status:403});expect(mocks.tokens).not.toHaveBeenCalled();
 });
 it("reports credential storage failure unavailable rather than not connected",async()=>{
  mocks.tokens.mockRejectedValue(Error("private vault failure"));
  const result=await loadWarmReconnectSenderProfilesForUid("owner",{} as Firestore);
  expect(result.googleProfiles.every(p=>p.state==="unavailable")).toBe(true);expect(JSON.stringify(result)).not.toContain("private vault");
 });
});
