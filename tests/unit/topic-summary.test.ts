import {describe,it,expect} from 'vitest';
import {summarizeTopicRecords} from '@/lib/crm/topic-summary';
const w='workspace';
const pref=(id='a',g=true,r=true)=>({id:'pref-'+id,data:{workspaceId:w,schemaVersion:1,personId:'p-'+id,contactPointId:id,topics:{rosser_gallery:g,rt_solutions:r},globallyUnsubscribed:false}});
const contact=(id='a')=>({id,data:{workspaceId:w,type:'email',personId:'p-'+id,normalizedValue:id+'@example.com',defaultPermissionState:'unknown'}});
describe('current topic diagnostic summary',()=>{
 it('counts both once, separate from global defaults',()=>expect(summarizeTopicRecords(w,[pref(),pref('b',true,false),pref('c',false,true)],[contact(),contact('b'),contact('c')],[])).toMatchObject({any:3,gallery:2,rt:2,both:1,held:0}));
 it('holds global suppression, canonical optout and delivery suppression',()=>{const cs=[contact(),contact('b'),contact('c')];Object.assign(cs[1].data,{defaultPermissionState:' OPTED_OUT '});Object.assign(cs[2].data,{suppressed:true});expect(summarizeTopicRecords(w,[pref(),pref('b'),pref('c')],cs,[{id:'s',data:{workspaceId:w,contactPointId:'a'}}])).toMatchObject({any:0,held:3});});
 it('holds duplicate email and conflicting owners without merging consent',()=>{const cs=[contact(),contact('b'),contact('c')];cs[1].data.normalizedValue=cs[0].data.normalizedValue;Object.assign(cs[2].data,{crmPersonId:'other'});expect(summarizeTopicRecords(w,[pref(),pref('b'),pref('c')],cs,[])).toMatchObject({any:0,held:3});});
 it('holds missing or duplicate preference identities',()=>expect(summarizeTopicRecords(w,[pref(),pref(),pref('missing')],[contact()],[])).toMatchObject({any:0,held:3}));
 it('does not mutate source records',()=>{const p=[pref()],c=[contact()];const before=JSON.stringify([p,c]);summarizeTopicRecords(w,p,c,[]);expect(JSON.stringify([p,c])).toBe(before);});
 it('returns unknown for workspace mismatch and unbound suppression',()=>{expect(summarizeTopicRecords('other',[pref()],[contact()],[]).any).toBeNull();expect(summarizeTopicRecords(w,[pref()],[contact()],[{id:'s',data:{workspaceId:w}}]).status).toBe('unknown');});
 it('returns unknown rather than truncating',()=>expect(summarizeTopicRecords(w,Array.from({length:5001},()=>pref()),[],[]).any).toBeNull());
});

// Exercise the adapter independently of live Firestore; no production data writes.
describe('topic summary bounded loader',()=>{
 it('scopes all three reads, projects fields, caps records and never writes',async()=>{
  const {loadTopicSummary}=await import('@/lib/crm/topic-summary');
  const calls: unknown[][]=[];
  const rows: Record<string,unknown[]>={crm_contact_preferences:[pref()],crm_contact_points:[contact()],crm_suppressions:[]};
  const db={collection:(name:string)=>({where:(...filter:unknown[])=>{calls.push([name,...filter]);return {select:(...fields:string[])=>({limit:(n:number)=>({get:async()=>{calls.push([name,n,fields]);return {docs:(rows[name] as {id:string;data:Record<string,unknown>}[]).map(row=>({id:row.id,data:()=>row.data}))};}})})};}})};
  const result=await loadTopicSummary(w,db as never);
  expect(result).toMatchObject({status:'observed',any:1,both:1});
  expect(calls.filter(c=>c[1]==='workspaceId')).toHaveLength(3);
  expect(calls.filter(c=>c[1]===5001)).toHaveLength(3);
 });
 it('reports failure as unknown, never an invented zero',async()=>{
  const {loadTopicSummary}=await import('@/lib/crm/topic-summary');
  const result=await loadTopicSummary(w,{collection:()=>{throw new Error('unavailable');}} as never);
  expect(result).toMatchObject({status:'unknown',any:null,gallery:null,rt:null,both:null});
 });
});
