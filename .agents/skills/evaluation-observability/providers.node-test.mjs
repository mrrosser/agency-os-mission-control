import test from 'node:test';
import assert from 'node:assert/strict';
import { providerUsage, observeProvider } from './providers.mjs';

test('Gemini preserves separate thought/tool counters without inferred totals', () => {
  const u = providerUsage('gemini', { usageMetadata: {promptTokenCount: 100, candidatesTokenCount: 5, thoughtsTokenCount: 12, cachedContentTokenCount: 80, toolUsePromptTokenCount: 7} });
  assert.equal(u.reasoning_tokens, 12); assert.equal(u.output_tokens, 5);
  assert.equal(u.tool_input_tokens, 7); assert.equal(u.total_tokens, null);
  assert.equal(u.cache_write_tokens, null);
});
test('Ollama and Responses counters preserve zeros and unknowns', () => {
  assert.equal(providerUsage('ollama', {prompt_eval_count: 20, eval_count: 0}).output_tokens, 0);
  assert.equal(providerUsage('ollama', {}).cached_tokens, null);
  const u = providerUsage('openai-responses', {usage: {input_tokens: 20, input_tokens_details: {cached_tokens: 15, cache_write_tokens: 6}}});
  assert.equal(u.cached_tokens, null); assert.equal(u.cache_write_tokens, null);
  assert.equal(providerUsage('gemini', {usageMetadata: {promptTokenCount: true}}).input_tokens, null);
});
test('metadata omits raw text, errors and credentials; return value is unchanged', async () => {
  const rows = [], result = {text: 'PRIVATE', apiKey: 'PRIVATE', modelVersion: 'model-v1', usageMetadata: {promptTokenCount: 3}};
  assert.equal(await observeProvider(async () => result, {provider: 'gemini', project_id: 'rts-talk', onObservation: r => rows.push(r)}), result);
  assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
  assert.equal(rows[0].execution_authorized, false); assert.equal(rows[0].cost_usd, null);
  assert.equal(rows[0].model_fingerprint.length, 64);
});
test('one attempt, stable exception and logger-failure isolation', async () => {
  let calls = 0; const rows = [], error = new Error('PRIVATE');
  await assert.rejects(observeProvider(async () => {calls++; throw error;}, {provider: 'ollama', project_id: 'artist', onObservation: r => rows.push(r)}), e => e === error);
  assert.equal(calls, 1); assert.equal(rows[0].transport_status, 'request_failed');
  assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
  assert.equal(await observeProvider(async () => 7, {provider: 'ollama', project_id: 'artist', onObservation: () => {throw error;}}), 7);
});
test('unsupported provider and invalid identifiers fail before invocation', async () => {
  let calls = 0; const send = async () => calls++;
  await assert.rejects(observeProvider(send, {provider: 'other', project_id: 'x'}));
  await assert.rejects(observeProvider(send, {provider: 'gemini', project_id: '../x'}));
  assert.equal(calls, 0);
});
