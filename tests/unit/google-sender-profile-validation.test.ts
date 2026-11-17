import { describe, expect, it } from "vitest";
import { parseGoogleSenderProfiles } from "@/components/crm/google-sender-connection-client";
const profile = {
  profileId: "rosser_gallery_send", businessId: "rosser_nft_gallery", label: "Gallery",
  state: "connected", connected: true, gmailCapable: true,
  accountEmail: "mrosser@rossergallery.com", accountId: "account",
};
const response = (googleProfiles: unknown) => ({schemaVersion:"crm.warm-reconnect-sender-profiles.v1",providerActions:"none",googleProfiles});
describe("sender profile response validation", () => {
  it("accepts typed allowed profiles", () => expect(parseGoogleSenderProfiles(response([profile]))).toEqual([profile]));
  it.each([null, {}, "profile", {...profile, profileId:"rosser_gallery_work"}, {...profile,businessId:"rt_solutions"}, {...profile, connected:"true"}, {...profile,accountEmail:{}}, {...profile, accountId:undefined}, {...profile,state:"invented"}])("rejects malformed or unauthorized profile %j", item => {
    expect(() => parseGoogleSenderProfiles(response([item]))).toThrow("could not be verified");
  });
  it("rejects duplicate IDs and incorrect envelope", () => {
    expect(() => parseGoogleSenderProfiles(response([profile,profile]))).toThrow();
    expect(() => parseGoogleSenderProfiles({...response([profile]),providerActions:"send"})).toThrow();
  });
});
