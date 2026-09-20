import { createHash, randomUUID } from 'node:crypto';

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const fingerprint = value => typeof value === 'string' ? createHash('sha256').update(value).digest('hex') : null;
const providers = new Set(['gemini', 'ollama', 'openai-responses']);

export function providerUsage(provider, response) {
  if (!providers.has(provider)) throw new Error('unsupported_provider');
  const r = response ?? {};
  const g = r.usageMetadata ?? {};
  const o = r.usage ?? {};
  const usage = provider === 'gemini' ? {
    input_tokens: count(g.promptTokenCount), output_tokens: count(g.candidatesTokenCount),
    reasoning_tokens: count(g.thoughtsTokenCount), cached_tokens: count(g.cachedContentTokenCount),
    cache_write_tokens: null, tool_input_tokens: count(g.toolUsePromptTokenCount),
    total_tokens: count(g.totalTokenCount),
  } : provider === 'ollama' ? {
    input_tokens: count(r.prompt_eval_count), output_tokens: count(r.eval_count),
    reasoning_tokens: null, cached_tokens: count(r.prompt_eval_cached_count),
    cache_write_tokens: null, tool_input_tokens: null, total_tokens: null,
  } : {
    input_tokens: count(o.input_tokens), output_tokens: count(o.output_tokens),
    reasoning_tokens: count(o.output_tokens_details?.reasoning_tokens),
    cached_tokens: count(o.input_tokens_details?.cached_tokens),
    cache_write_tokens: count(o.input_tokens_details?.cache_write_tokens),
    tool_input_tokens: null, total_tokens: count(o.total_tokens),
  };
  // Retain provider semantics: reasoning may be separate or included in output.
  // Never sum heterogeneous fields or infer billing from a missing counter.
  if (usage.input_tokens !== null && (usage.cached_tokens ?? 0) + (usage.cache_write_tokens ?? 0) > usage.input_tokens) {
    usage.cached_tokens = null;
    usage.cache_write_tokens = null;
  }
  return usage;
}

export async function observeProvider(send, { provider, project_id, operation = 'generate', onObservation = () => {} }) {
  if (!providers.has(provider)) throw new Error('unsupported_provider');
  for (const value of [project_id, operation]) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(value ?? '')) throw new Error('invalid_observation_identifier');
  }
  const correlation_id = randomUUID();
  const start = performance.now();
  let response, completed = false;
  try {
    response = await send();
    completed = true;
    return response;
  } finally {
    // Observation failures never replace the original result or exception.
    try {
      await onObservation({
        schema_version: 1, event: 'application_model_call', project_id, operation, provider, correlation_id,
        latency_ms: Math.round(performance.now() - start),
        transport_status: completed ? 'returned' : 'request_failed',
        model_fingerprint: fingerprint(response?.modelVersion ?? response?.model),
        usage: providerUsage(provider, response),
        provider_duration_ns: provider === 'ollama' ? count(response?.total_duration) : null,
        cost_usd: null, quality: 'unassessed', execution_authorized: false,
      });
    } catch { /* application behavior owns its fallback */ }
  }
}
