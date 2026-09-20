import {createHash,randomUUID} from 'node:crypto';
const tokenCount=value=>Number.isSafeInteger(value)&&value>=0?value:null;

// Observe an existing non-streaming request without changing its payload or retry policy.
export async function observeChatCompletion(send,{project_id,onObservation=()=>{}}={}) {
  if(!/^[a-z][a-z0-9-]{0,63}$/.test(project_id??''))throw Error('project_id_required');
  const correlation_id=randomUUID(),started=performance.now();
  let result;
  try {result=await send();return result;}
  finally {
    const usage=result?.json?.usage,details=usage?.prompt_tokens_details;
    const input_tokens=tokenCount(usage?.prompt_tokens),output_tokens=tokenCount(usage?.completion_tokens);
    let cached_tokens=tokenCount(details?.cached_tokens),cache_write_tokens=tokenCount(details?.cache_write_tokens);
    if(input_tokens!==null&&((cached_tokens??0)+(cache_write_tokens??0)>input_tokens)){cached_tokens=null;cache_write_tokens=null;}
    const row={schema_version:1,event:'application_model_call',project_id,correlation_id,provider:'openai',api:'chat_completions',latency_ms:Math.round(performance.now()-started),
      transport_status:result?(result.res.ok?'ok':'http_error'):'request_failed',http_status:Number.isInteger(result?.res?.status)?result.res.status:null,
      model_fingerprint:typeof result?.json?.model==='string'?createHash('sha256').update(result.json.model).digest('hex'):null,
      usage:{input_tokens,output_tokens,cached_tokens,cache_write_tokens},cost_usd:null,quality:'unassessed',execution_authorized:false};
    // Logging failures must not discard a successful draft or replace its existing fallback.
    try {await onObservation(row);}catch { /* Preserve the caller result if logging fails. */ }
  }
}
