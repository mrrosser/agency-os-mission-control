import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { createWarmReconnectPilot, decideWarmReconnectRecipient, decideWarmReconnectPilotApproval, requestWarmReconnectPilotLaunch, returnExpiredWarmReconnectPilotToReview, warmReconnectInitialPilotLockId } from "@/lib/crm/warm-reconnect-activation";
import { dedupeWarmReconnectCandidates } from "@/lib/crm/warm-reconnect-dedupe";
import { warmReconnectInvitationReservationId } from "@/lib/crm/warm-reconnect-invitation-ledger";
import { WARM_RECONNECT_CAMPAIGN_ID, WARM_RECONNECT_CAMPAIGN_VERSION } from "@/lib/crm/warm-reconnect-types";
import type { WarmReconnectPilot } from "@/lib/crm/warm-reconnect-activation-types";
const mocks = vi.hoisted(() => ({ access: vi.fn(), account: vi.fn(), scope: vi.fn(), sender: vi.fn() }));
vi.mock("@/lib/crm/portfolio-registry", () => ({ assertPortfolioRegistryAccess: mocks.access }));
vi.mock("@/lib/google/account-token-store", () => ({ resolveGoogleAccountTokens: mocks.account }));
vi.mock("@/lib/google/oauth", () => ({ isGoogleTokenScopeBoundedForPreset: mocks.scope }));
vi.mock("@/lib/google/gmail-campaign-sender", () => ({ sendWarmReconnectCampaignEmail: mocks.sender }));
import { returnExpiredWarmReconnectPilotToReviewForUid } from "@/lib/crm/warm-reconnect-repository";
import { claimNextWarmReconnectRecipient } from "@/lib/crm/warm-reconnect-executor";

type Data = Record<string, unknown>;
const uid = "recovery-owner";
const workspaceId = `workspace_default_${uid}`;
const pilotId = "wrp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const base = `crm_warm_reconnect_pilots/${pilotId}`;
const lockPath = `crm_warm_reconnect_campaign_locks/${warmReconnectInitialPilotLockId(workspaceId)}`;
const start = new Date("2026-10-05T15:00:00Z");
const now = new Date("2026-10-07T18:00:00Z");
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** A minimal versioned Firestore fake: reads are isolated; contention retries
 * the real repository callback, so an injected dispatcher claim is rechecked. */
function fakeDb() {
  const records = new Map<string, Data>();
  const versions = new Map<string, number>();
  const writes: string[] = [];
  let beforeCommit: (() => void) | undefined;
  let attempts = 0;
  const put = (p: string, d: Data) => { records.set(p, structuredClone(d)); versions.set(p, (versions.get(p) || 0) + 1); const c = p.slice(0, p.lastIndexOf("/")); versions.set(c, (versions.get(c) || 0) + 1); };
  const snap = (p: string, store = records) => ({ exists: store.has(p), id: p.split("/").at(-1)!, data: () => store.get(p) });
  type Ref = { path: string; query?: boolean; filters?: [string, unknown][]; cap?: number };
  function query(path: string, filters: [string, unknown][] = [], cap = Infinity) {
    return { path, query: true, filters, cap, doc: (id: string) => ref(`${path}/${id}`), where: (field: string, op: string, value: unknown) => { expect(op).toBe("=="); return query(path, [...filters, [field, value]], cap); }, limit: (n: number) => query(path, filters, n), get: async () => read({ path, query: true, filters, cap }) };
  }
  function ref(path: string) { return { path, id: path.split("/").at(-1)!, collection: (name: string) => query(`${path}/${name}`), get: async () => snap(path) }; }
  function read(r: Ref, store = records) {
    if (!r.query) return snap(r.path, store);
    const paths = [...store.keys()].filter(p => p.startsWith(r.path + "/") && !p.slice(r.path.length + 1).includes("/") && (r.filters || []).every(([f,v]) => store.get(p)?.[f] === v)).slice(0, r.cap);
    return { docs: paths.map(p => snap(p, store)), empty: paths.length === 0, size: paths.length };
  }
  const db = { collection: (name: string) => query(name), getAll: async (...refs: Ref[]) => refs.map(r => snap(r.path)), runTransaction: async (callback: (tx: unknown) => Promise<unknown>) => {
    for (let n=0; n<3; n++) {
      attempts++; const working = new Map(records); const captured = new Map(versions); const reads = new Set<string>(); const pending: [string, Data][] = [];
      const tx = { get: async (r: Ref) => { reads.add(r.path); return read(r, working); }, set: (r: Ref, data: Data) => pending.push([r.path,data]), create: (r: Ref, data: Data) => { if(working.has(r.path)) throw Error("exists"); pending.push([r.path,data]); } };
      const result = await callback(tx); const hook=beforeCommit; beforeCommit=undefined; hook?.();
      if ([...reads].some(p => versions.get(p) !== captured.get(p))) continue;
      for (const [p,d] of pending) { put(p,d); writes.push(p); }
      return result;
    }
    throw Error("transaction contention");
  } } as unknown as Firestore;
  return {db,records,writes,put,beforeCommit:(f:()=>void)=>{beforeCommit=f;},attempts:()=>attempts};
}
function setup() {
  const f=fakeDb();
  const raw=[1,2,3,4,5].map(i=>({contactPointId:`contact-${i}`,personId:`person-${i}`,displayName:`Person ${i}`,email:`person${i}@example.test`,permissionState:"unknown",primary:true,evidenceUpdatedAt:start.toISOString(),sourceEvidence:[{evidenceRef:`crm_source_records/source-${i}`,sourceSystem:"google_people",permissionBasis:"none",observedAt:start.toISOString()}],sourcePersonIds:[`person-${i}`],suppressed:false,openImportConflict:false}));
  for(const [i,r] of raw.entries()) {
    f.put(`crm_contact_points/${r.contactPointId}`,{workspaceId,personId:r.personId,type:"email",normalizedValue:r.email,defaultPermissionState:"unknown",primary:true,updatedAt:start.toISOString()});
    f.put(`crm_people/${r.personId}`,{displayName:r.displayName});
    f.put(`crm_source_records/source-${i+1}`,{workspaceId,personId:r.personId,contactPointId:r.contactPointId,sourceSystem:"google_people",permissionBasis:"none",observedAt:start.toISOString()});
  }
  const candidates=dedupeWarmReconnectCandidates(workspaceId,raw).candidates;
  let pilot=createWarmReconnectPilot({pilotId,workspaceId,ownerUid:uid,legacyDncOrgId:workspaceId,candidates,googleReady:true,fromEmail:"mrosser@rossergallery.com",accountId:"gallery-account",preferenceOrigin:"https://leadflow-review.web.app",now:start,request:{idempotencyKey:"initial",campaignPreviewFingerprint:`sha256:${"a".repeat(64)}`,tranche:"initial_5",recipientCap:5,candidateRecipientIds:candidates.map(c=>c.recipientId) as [string,string,string,string,string],contentMode:"plain_text",sender:{senderName:"Marcus Rosser",legalEntity:"Marcus Rosser / Rosser Gallery",replyTo:"mrosser@rossergallery.com",physicalPostalAddress:"2505 N Tonti St, New Orleans, LA 70117",businessId:"rosser_nft_gallery",profileId:"rosser_gallery_send"}}});
  for(const r of pilot.recipients) pilot=decideWarmReconnectRecipient({pilot,recipientId:r.recipientId,decisionId:`decision-${r.recipientId}`,googleReady:true,now:start,request:{decision:"attest_relationship",expectedCandidateFingerprint:r.candidateFingerprint,personallyRecognizedRelationship:true,oneTimeReconnectionInvitationOnly:true,sourceEvidenceRefs:[...r.decision.sourceEvidenceRefs],note:"Existing relationship verified for one invitation."}});
  pilot=decideWarmReconnectPilotApproval({pilot,approvalId:"approval-old",googleReady:true,now:start,request:{decision:"approve",expectedArtifactFingerprint:pilot.fingerprints.artifactFingerprint,expectedAudienceFingerprint:pilot.fingerprints.audienceFingerprint,expectedActionFingerprint:pilot.fingerprints.actionFingerprint,approvalScope:"exact_five_one_time_reconnection_emails",note:"Exact five approved.",confirmations:{senderLegalIdentityVerified:true,physicalPostalAddressVerified:true,preferencesAndUnsubscribeVerified:true,suppressionLedgerVerified:true,spfDkimDmarcVerified:true,replyToMonitored:true,exactAudienceReviewed:true}}});
  pilot=requestWarmReconnectPilotLaunch({pilot,googleReady:true,now:start,request:{approvalId:"approval-old",expectedArtifactFingerprint:pilot.fingerprints.artifactFingerprint,expectedAudienceFingerprint:pilot.fingerprints.audienceFingerprint,expectedActionFingerprint:pilot.fingerprints.actionFingerprint,acknowledgeLaunchAuthorizesExactFiveEmailSend:true}});
  f.put(base,pilot as unknown as Data);
  f.put(lockPath,{schemaVersion:1,workspaceId,campaignId:WARM_RECONNECT_CAMPAIGN_ID,campaignVersion:WARM_RECONNECT_CAMPAIGN_VERSION,tranche:"initial_5",state:"active",pilotId});
  const request={expiredApprovalId:"approval-old",expectedArtifactFingerprint:pilot.fingerprints.artifactFingerprint,expectedAudienceFingerprint:pilot.fingerprints.audienceFingerprint,expectedActionFingerprint:pilot.fingerprints.actionFingerprint,reason:"Approval expired before any delivery started."};
  const recover=(overrides:Partial<typeof request>={})=>returnExpiredWarmReconnectPilotToReviewForUid({uid,pilotId,request:{...request,...overrides},correlationId:"recovery-test",idempotencyKey:"return-once",log,db:f.db});
  return {...f,pilot,request,recover};
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(now);vi.clearAllMocks();mocks.access.mockResolvedValue({workspaceId,role:"owner"});mocks.account.mockResolvedValue({record:{accountId:"gallery-account",tokens:{refreshToken:"fixture-only",scope:"https://www.googleapis.com/auth/gmail.send",accountEmail:"mrosser@rossergallery.com"}}});mocks.scope.mockReturnValue(true);mocks.sender.mockRejectedValue(Error("No provider allowed"));});
afterEach(()=>{expect(mocks.sender).not.toHaveBeenCalled();vi.useRealTimers();});

describe("expired launch recovery",()=>{
  it("returns the same pristine pilot to unapproved review and archives old authority without changing its lock",async()=>{const f=setup();const lock=structuredClone(f.records.get(lockPath));const result=await f.recover();const saved=f.records.get(base) as unknown as WarmReconnectPilot;expect(result.replayed).toBe(false);expect(saved).toMatchObject({pilotId,status:"needs_campaign_approval",approval:null,launchRequestedAt:null,fingerprints:f.pilot.fingerprints,recipients:f.pilot.recipients,sender:f.pilot.sender});expect(saved.availableActions.canLaunch).toBe(false);expect(saved.gates.some(g=>g.status!=="verified")).toBe(true);expect(f.records.get(lockPath)).toEqual(lock);expect(f.writes).toHaveLength(2);const event=f.records.get(f.writes.find(p=>p.includes("/events/"))!)!;expect(event.previousApproval).toEqual(f.pilot.approval);expect(event.previousLaunchRequestedAt).toBe(f.pilot.launchRequestedAt);expect(event.providerAction).toBe(false);});
  it("replays the same request without another write and rejects key reuse with changed content",async()=>{const f=setup();await f.recover();expect((await f.recover()).replayed).toBe(true);expect(f.writes).toHaveLength(2);await expect(f.recover({reason:"Different request"})).rejects.toThrow("idempotency key");expect(f.writes).toHaveLength(2);});
  it.each([{}, {claimedCount:0}, {activeReceiptId:"unknown",sentCount:0}])("rejects any executor document, even apparently empty: %j",async state=>{const f=setup();f.put(base+"/executor/state",state);await expect(f.recover()).rejects.toThrow("Dispatch evidence exists");expect(f.writes).toEqual([]);});
  it.each(["claimed","sent","delivery_unknown","stopped_before_provider"]) ("rejects any receipt including unexpected IDs and %s",async status=>{const f=setup();f.put(base+"/delivery_receipts/unexpected-id",{status});await expect(f.recover()).rejects.toThrow("Dispatch evidence exists");expect(f.writes).toEqual([]);});
  it.each(["reserved","sent","delivery_unknown","released_before_provider"]) ("rejects existing cross-pilot invitation ledger %s",async status=>{const f=setup();const r=f.pilot.recipients[4];const id=warmReconnectInvitationReservationId({workspaceId,campaignVersion:WARM_RECONNECT_CAMPAIGN_VERSION,personId:r.personId,emailKey:r.emailKey});f.put("crm_warm_reconnect_invitation_ledger/"+id,{status,pilotId:"different-pilot"});await expect(f.recover()).rejects.toThrow("Dispatch evidence exists");expect(f.writes).toEqual([]);});
  it("rechecks after a concurrent dispatcher claim commits and never overwrites it",async()=>{const f=setup();f.beforeCommit(()=>{f.put(base+"/executor/state",{activeReceiptId:"claimed",claimedCount:1});f.put(base+"/delivery_receipts/claimed",{status:"claimed"});});await expect(f.recover()).rejects.toThrow("Dispatch evidence exists");expect(f.attempts()).toBe(2);expect(f.writes).toEqual([]);expect(f.records.get(base)?.status).toBe("launch_requested");});
  it("makes a subsequent real dispatcher claim reject before any writes",async()=>{const f=setup();await f.recover();const before=f.writes.length;await expect(claimNextWarmReconnectRecipient({uid,pilotId,correlationId:"worker-race",now:start,db:f.db})).rejects.toThrow();expect(f.writes.length).toBe(before);});
  it.each(["missing","released","other"]) ("requires the same active campaign lock: %s",async mode=>{const f=setup();if(mode==="missing")f.records.delete(lockPath);else f.put(lockPath,{...f.records.get(lockPath),...(mode==="released"?{state:"released_before_provider"}:{pilotId:"another-pilot"})});await expect(f.recover()).rejects.toThrow();expect(f.writes).toEqual([]);});
  it("keeps owner and suppression checks authoritative",async()=>{const f=setup();mocks.access.mockResolvedValueOnce({workspaceId,role:"admin"});await expect(f.recover()).rejects.toThrow("exact portfolio workspace owner");f.put("crm_suppressions/test",{workspaceId,contactPointId:"contact-1"});await expect(f.recover()).rejects.toThrow("Recipient evidence");expect(f.writes).toEqual([]);});
  it.each(["approved","stopped","rejected","needs_campaign_approval"]) ("rejects an ineligible pilot status %s",status=>{const f=setup();expect(()=>returnExpiredWarmReconnectPilotToReview({pilot:{...f.pilot,status} as WarmReconnectPilot,request:f.request,googleReady:true,now})).toThrow();});
  it("rejects unexpired or malformed approvals, changed approval ID, request fingerprint, and changed content",()=>{const f=setup();for(const expiresAt of ["not-a-date","2026-10-08T00:00:00Z"]){expect(()=>returnExpiredWarmReconnectPilotToReview({pilot:{...f.pilot,approval:{...f.pilot.approval!,expiresAt}},request:f.request,googleReady:true,now})).toThrow();}for(const request of [{...f.request,expiredApprovalId:"other"},{...f.request,expectedActionFingerprint:`sha256:${"f".repeat(64)}`}]){expect(()=>returnExpiredWarmReconnectPilotToReview({pilot:f.pilot,request,googleReady:true,now})).toThrow();}expect(()=>returnExpiredWarmReconnectPilotToReview({pilot:{...f.pilot,sender:{...f.pilot.sender,replyTo:"other@example.test"}},request:f.request,googleReady:true,now})).toThrow("content changed");});
});
