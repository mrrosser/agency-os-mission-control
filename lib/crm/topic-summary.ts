import type { Firestore } from 'firebase-admin/firestore';
import { normalizeWarmReconnectEmail } from './warm-reconnect-dedupe';

export type TopicSummary = {
  status: 'observed' | 'unknown';
  any: number | null; gallery: number | null; rt: number | null; both: number | null;
  held: number | null; observedAt: string; reason?: string;
  scope: 'current_topic_records_not_send_authority';
};
type Row = { id: string; data: Record<string, unknown> };
const LIMIT = 5000;
const object = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
const text = (x: unknown) => typeof x === 'string' ? x.trim() : '';
export const unknownTopicSummary = (reason: string): TopicSummary => ({status:'unknown',any:null,gallery:null,rt:null,both:null,held:null,observedAt:new Date().toISOString(),reason,scope:'current_topic_records_not_send_authority'});

/** Read-only diagnostics, never an eligibility decision or consent mutation.
 * One current preference document per canonical contact point is expected.
 * Ambiguous ownership, duplicate email identities and suppressions are held.
 */
export function summarizeTopicRecords(workspaceId: string, preferences: Row[], contacts: Row[], suppressions: Row[]): TopicSummary {
  if ([preferences, contacts, suppressions].some(rows => rows.length > LIMIT)) return unknownTopicSummary('Topic evidence exceeded its reporting bound.');
  if ([...preferences,...contacts,...suppressions].some(row => row.data.workspaceId !== workspaceId)) return unknownTopicSummary('Topic evidence workspace mismatch.');
  const byId = new Map(contacts.map(row => [row.id,row.data]));
  if (byId.size !== contacts.length) return unknownTopicSummary('Duplicate contact identities.');
  const emailFrequency = new Map<string,number>();
  for (const {data} of contacts) {
    const email = normalizeWarmReconnectEmail(text(data.normalizedValue) || text(data.value));
    if (data.type === 'email' && email) emailFrequency.set(email,(emailFrequency.get(email)||0)+1);
  }
  const prefFrequency = new Map<string,number>();
  for (const {data} of preferences) {const id=text(data.contactPointId);prefFrequency.set(id,(prefFrequency.get(id)||0)+1);}
  // Fail closed for an unbound suppression: do not silently ignore a record.
  if (suppressions.some(row => !text(row.data.contactPointId))) return unknownTopicSummary('Suppression identity needs reconciliation.');
  const suppressed = new Set(suppressions.map(row=>text(row.data.contactPointId)));
  let any=0,gallery=0,rt=0,both=0,held=0;
  for (const {data} of preferences) {
    const id=text(data.contactPointId), contact=byId.get(id), topics=object(data.topics);
    const owners=contact ? [contact.personId,contact.crmPersonId,contact.personRef].map(text).filter(Boolean) : [];
    const email=contact ? normalizeWarmReconnectEmail(text(contact.normalizedValue)||text(contact.value)) : null;
    const invalid = !contact || contact.type !== 'email' || !email || emailFrequency.get(email)!==1 || prefFrequency.get(id)!==1 ||
      !text(data.personId) || !owners.length || owners.some(owner=>owner!==text(data.personId)) || data.schemaVersion!==1 ||
      typeof topics.rosser_gallery!=='boolean' || typeof topics.rt_solutions!=='boolean' || typeof data.globallyUnsubscribed!=='boolean';
    const blocked = data.globallyUnsubscribed===true || suppressed.has(id) || contact?.suppressed===true || text(contact?.defaultPermissionState).toLowerCase()==='opted_out';
    if (invalid || blocked) {held++;continue;}
    const g=topics.rosser_gallery===true,r=topics.rt_solutions===true;
    if(g||r) any++; if(g) gallery++; if(r) rt++; if(g&&r) both++;
  }
  return {status:'observed',any,gallery,rt,both,held,observedAt:new Date().toISOString(),scope:'current_topic_records_not_send_authority'};
}

export async function loadTopicSummary(workspaceId: string, db: Firestore): Promise<TopicSummary> {
  try {
    const fields = {
      crm_contact_preferences:['workspaceId','personId','contactPointId','schemaVersion','topics','globallyUnsubscribed'],
      crm_contact_points:['workspaceId','personId','crmPersonId','personRef','type','normalizedValue','value','suppressed','defaultPermissionState'],
      crm_suppressions:['workspaceId','contactPointId'],
    };
    const reads = await Promise.all(Object.entries(fields).map(async ([collection,select]) => {
      const snapshot=await db.collection(collection).where('workspaceId','==',workspaceId).select(...select).limit(LIMIT+1).get();
      return snapshot.docs.map(doc=>({id:doc.id,data:doc.data()}));
    }));
    return summarizeTopicRecords(workspaceId,reads[0],reads[1],reads[2]);
  } catch {return unknownTopicSummary('Current topic evidence unavailable. No zero count inferred.');}
}
