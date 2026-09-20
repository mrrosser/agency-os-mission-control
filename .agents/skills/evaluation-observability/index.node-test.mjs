import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {withCacheComparison,cacheObservation,successGate,evalReplay} from './index.mjs';
import {cases} from '../../.codex/skills/astra-jev-decision/references/cases.mjs';

const context={project_id:'codexskills',correlation_id:'cache-test',latency_ms:10};
const base={case_id:'a',project_id:'codexskills',correlation_id:'a1',dataset_version:'v1',arm:'baseline',split:'heldout',passed:true,critical:true,authority:'pass',cost_usd:1,latency_ms:20};
test('comparison preserves caller settings and cannot mutate original',()=>{
  const request={model:'gpt-6-astra',input:'data',prompt_cache_options:{ttl:'30m',mode:'explicit'}};
  const actual=withCacheComparison(request,'resp_123');
  assert.deepEqual(actual.prompt_cache_options,{ttl:'30m',mode:'explicit',comparison_response_id:'resp_123'});
  assert.equal(request.prompt_cache_options.comparison_response_id,undefined);
  assert.throws(()=>withCacheComparison(request,'not a response'));
});
test('diagnostics redact arbitrary payloads and distinguish usage from diagnostic estimates',()=>{
  const r=cacheObservation({model:'gpt-6-astra',output:'SECRET',usage:{input_tokens:2000,output_tokens:10,input_tokens_details:{cached_tokens:1000,cache_write_tokens:500}},prompt_cache_diagnostics:{type:'cache_miss',reason:'tools_changed',cache_missed_tokens:1200,arbitrary:'SECRET'}},context);
  assert.equal(r.usage.uncached_tokens,500);assert.equal(r.cached_input_fraction,.5);
  assert.equal(r.diagnostics.cache_missed_tokens,1200);assert(!JSON.stringify(r).includes('SECRET'));
  assert.equal(cacheObservation({prompt_cache_diagnostics:{type:'SECRET',reason:'SECRET'}},context).diagnostics.type,'unknown');
});
test('missing or inconsistent usage cannot become zero cost or a cache measurement',()=>{
  assert.equal(cacheObservation({},context).usage,null);
  assert.equal(cacheObservation({usage:{input_tokens:1,output_tokens:1,input_tokens_details:{cached_tokens:2,cache_write_tokens:0}}},context).usage,null);
  assert.equal(cacheObservation({prompt_cache_diagnostics:{type:'cache_hit'}},context).cached_input_fraction,null);
});
test('gate rejects missing, duplicate, mismatched and critical evidence',()=>{
  const candidate={...base,arm:'candidate',cost_usd:.5};const opts={minimumCases:1};
  assert.equal(successGate([base],[candidate],opts).eligible,true);
  for(const patch of [{passed:false},{authority:'unknown'},{cost_usd:null},{dataset_version:'v2'},{critical:false}]) assert.equal(successGate([base],[{...candidate,...patch}],opts).eligible,false);
  assert.equal(successGate([base],[candidate,candidate],opts).eligible,false);
  assert.equal(successGate([base],[candidate]).eligible,false);
  assert.equal(successGate([base],[candidate],opts).execution_authorized,false);
});
test('replay is schema-valid metadata only and retains unknown authority',()=>{
  const r=evalReplay([{...base,authority:'unknown',prompt:'SECRET'}]);
  assert.equal(r.run.data_source.type,'jsonl');assert.equal(r.run.data_source.source.content[0].item.authority,'unknown');
  assert(!JSON.stringify(r).includes('SECRET'));assert.equal(r.eval.data_source_config.include_sample_schema,false);
  assert.throws(()=>evalReplay([base,base]));
});
test('pilot export CLI smoke is offline and refuses overwrite',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'rt-evals-'));
  const output=join(dir,'export.json'),input=join(dir,'input.json');
  const cwd=new URL('../../',import.meta.url);
  try {
    await writeFile(input,JSON.stringify({mode:'live',complete:true,run_id:'fixture-only',dataset_hash:'fixture-v1',records:cases.flatMap(c=>['baseline','improved','combined'].map(arm=>({case_id:c.id,split:c.split,rubric_id:c.rubric_id,arm,correct:true,execution_authorized:false,cost_usd:0,latency_ms:1})))}));
    const args=['scripts/export_pilot_evals.mjs',input,output];
    execFileSync(process.execPath,args,{cwd,stdio:'pipe'});
    const r=JSON.parse(await readFile(output));assert.equal(r.run.data_source.source.content.length,300);
    assert.throws(()=>execFileSync(process.execPath,args,{cwd,stdio:'pipe'}));
  } finally {await rm(output,{force:true});await rm(input,{force:true});await rmdir(dir);}
});
test('cache probe CLI dry run needs no credentials and dispatches no requests',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'rt-cache-'));
  const output=join(dir,'probe.json');
  try {
    execFileSync(process.execPath,['scripts/cache_diagnostics_probe.mjs',output,'--dry-run'],{cwd:new URL('../../',import.meta.url),stdio:'pipe',env:{...process.env,OPENAI_API_KEY:'',RT_DECISION_LEDGER:''}});
    const report=JSON.parse(await readFile(output));
    assert.equal(report.complete,false);assert.deepEqual(report.observations,[]);
  } finally {await rm(output,{force:true});await rmdir(dir);}
});
