import {createHash} from 'node:crypto';

const id = x => typeof x === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/.test(x) && !/(?:apikey_|sk-[A-Za-z0-9_-]{12,})/i.test(x);
const count = x => Number.isSafeInteger(x) && x >= 0;
const number = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const types = new Set(['cache_hit','cache_miss','comparison_response_not_found','unavailable']);
const reasons = new Set(['model_changed','prompt_cache_key_changed','service_tier_changed','tools_changed','text_format_changed','reasoning_effort_changed','verbosity_changed','context_compacted','input_changed']);

// Optional diagnostics never alter the caller's input, tools, model or cache policy.
export function withCacheComparison(request, baselineResponseId) {
  if (!baselineResponseId) return structuredClone(request);
  if (!/^resp_[A-Za-z0-9_-]{1,200}$/.test(baselineResponseId)) throw Error('invalid_response_id');
  return {...structuredClone(request),prompt_cache_options:{...request.prompt_cache_options,comparison_response_id:baselineResponseId}};
}

// Pass the final Responses object, or event.response from response.completed.
// Intentionally excludes response IDs, arbitrary strings, prompts and model output.
export function cacheObservation(response, {project_id,correlation_id,latency_ms}) {
  if (!id(project_id)||!id(correlation_id)||!number(latency_ms)) throw Error('invalid_context');
  const usage=response?.usage, details=usage?.input_tokens_details;
  const valid= count(usage?.input_tokens)&&count(usage?.output_tokens)&&count(details?.cached_tokens)&&count(details?.cache_write_tokens)&&details.cached_tokens+details.cache_write_tokens<=usage.input_tokens;
  const diagnostic=response?.prompt_cache_diagnostics;
  return {
    schema_version:1,event:'prompt_cache_observation',project_id,correlation_id,latency_ms,
    model_fingerprint:typeof response?.model==='string'?digest(response.model):null,
    usage:valid?{input_tokens:usage.input_tokens,output_tokens:usage.output_tokens,cached_tokens:details.cached_tokens,cache_write_tokens:details.cache_write_tokens,uncached_tokens:usage.input_tokens-details.cached_tokens-details.cache_write_tokens}:null,
    cached_input_fraction:valid&&usage.input_tokens>0?details.cached_tokens/usage.input_tokens:null,
    diagnostics:{type:types.has(diagnostic?.type)?diagnostic.type:'unknown',reason:reasons.has(diagnostic?.reason)?diagnostic.reason:null,cache_missed_tokens:count(diagnostic?.cache_missed_tokens)?diagnostic.cache_missed_tokens:null,comparison_reusable_tokens:count(diagnostic?.comparison_reusable_tokens)?diagnostic.comparison_reusable_tokens:null}
  };
}

export function validateOutcome(row) {
  if(!row||!['case_id','project_id','correlation_id','dataset_version','arm'].every(k=>id(row[k]))||!['development','heldout'].includes(row.split)||typeof row.passed!=='boolean'||typeof row.critical!=='boolean'||!['pass','fail','unknown'].includes(row.authority)||!(row.cost_usd===null||number(row.cost_usd))||!(row.latency_ms===null||number(row.latency_ms))) throw Error('invalid_outcome');
  return row;
}

// Eligibility is only a recommendation; this function cannot authorize execution.
export function successGate(baseline,candidate,{minimumCases=40,minimumSavings=0.2}={}) {
  if(!Number.isInteger(minimumCases)||minimumCases<1||!number(minimumSavings)||minimumSavings>1) throw Error('invalid_gate');
  [...baseline,...candidate].forEach(validateOutcome);
  const b=baseline.filter(x=>x.split==='heldout'), c=candidate.filter(x=>x.split==='heldout');
  const key=x=>`${x.project_id}:${x.dataset_version}:${x.case_id}`;
  const unique=a=>new Set(a.map(key)).size===a.length;
  const failures=[];
  if(new Set(b.map(x=>x.arm)).size!==1||new Set(c.map(x=>x.arm)).size!==1) failures.push('mixed_or_missing_arm');
  if(b.length<minimumCases||c.length<minimumCases) failures.push('insufficient_heldout');
  if(!unique(b)||!unique(c)||b.map(key).sort().join('|')!==c.map(key).sort().join('|')) failures.push('case_set_mismatch');
  const expected=new Map(b.map(x=>[key(x),x]));
  if(c.some(x=>expected.get(key(x))?.critical!==x.critical)) failures.push('critical_label_mismatch');
  if([...b,...c].some(x=>x.authority!=='pass'||(x.critical&&!x.passed))) failures.push('critical_or_authority_failure');
  if([...b,...c].some(x=>x.cost_usd===null)) failures.push('unknown_cost');
  const bg=b.filter(x=>x.passed).length,cg=c.filter(x=>x.passed).length;
  if(!bg||cg<bg) failures.push('quality_regression');
  const bc=bg&&b.every(x=>x.cost_usd!==null)?b.reduce((n,x)=>n+x.cost_usd,0)/bg:null;
  const cc=cg&&c.every(x=>x.cost_usd!==null)?c.reduce((n,x)=>n+x.cost_usd,0)/cg:null;
  const savings=bc>0&&cc!==null?1-cc/bc:null;
  if(savings===null||savings<minimumSavings) failures.push('insufficient_savings');
  return {eligible:failures.length===0,execution_authorized:false,reasons:failures,heldout_count:c.length,cost_per_success:{baseline:bc,candidate:cc},savings};
}

// Replay checks observed task outcomes; it does not run or judge a model afresh.
export function evalReplay(rows,name='rt-recorded-outcomes') {
  if(!id(name)||!Array.isArray(rows)||rows.length===0||rows.length>10000) throw Error('invalid_replay');
  const seen=new Set();
  const content=rows.map(row=>{
    validateOutcome(row);
    const key=`${row.project_id}:${row.dataset_version}:${row.case_id}:${row.arm}`;
    if(seen.has(key)) throw Error('duplicate_outcome'); seen.add(key);
    return {item:{case_id:row.case_id,project_id:row.project_id,dataset_version:row.dataset_version,arm:row.arm,split:row.split,observed:row.passed?'pass':'fail',expected:'pass',authority:row.authority,critical:row.critical?'yes':'no'}};
  });
  const properties=Object.fromEntries(Object.keys(content[0].item).map(k=>[k,{type:'string'}]));
  return {
    evidence_kind:'recorded-outcome-replay-not-fresh-model-evaluation',dataset_hash:digest(content),
    eval:{name,data_source_config:{type:'custom',item_schema:{type:'object',properties,required:Object.keys(properties),additionalProperties:false},include_sample_schema:false},testing_criteria:[
      {type:'string_check',name:'Recorded task success',input:'{{ item.observed }}',operation:'eq',reference:'{{ item.expected }}'},
      {type:'string_check',name:'Recorded authority check',input:'{{ item.authority }}',operation:'eq',reference:'pass'}
    ]},
    run:{name,data_source:{type:'jsonl',source:{type:'file_content',content}}}
  };
}
