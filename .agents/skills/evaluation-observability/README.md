# Shared evaluation observability

Node 22+, built-in modules only. This package is source code, not a global Codex setting. It supports application-owned API calls and recorded results from local models, Jev, Playwright or other tools. It cannot instrument Codex's internal subscription requests.

## Responses cache diagnostics

```js
import {withCacheComparison, cacheObservation} from './index.mjs';
const request = withCacheComparison(existingRequest, previousCompletedResponseId);
// Send request through your existing budgeted Responses client.
// For streaming, use event.response from response.completed.
const metadata = cacheObservation(response, {
  project_id: 'rtsolutions', correlation_id: taskId, latency_ms: elapsedMs
});
// Store metadata only in the existing structured logger.
```

Keep the baseline ID private and scoped to the same workload/organization. Omit it on the first request. Comparison requests do not load conversation history or force a cache hit. Missing diagnostics and usage remain unknown. The collector requires explicit cache-read and cache-write fields for a complete accounting record; older response shapes may therefore report null usage. Do not silently turn missing data into zero.

Keep reusable instructions and tool definitions stable; put changing task state afterward. Track cache writes as well as reads using dated model prices. Do not lengthen production prompts just to hit a cache threshold. The bundled diagnostic probe uses a synthetic long prefix solely to verify the feature.

## Task outcome contract and gates

Each result supplies case_id, project_id, correlation_id, dataset_version, arm, split (development/heldout), passed, critical, authority (pass/fail/unknown), cost_usd and latency_ms. Cost and latency may be null. A caller's actual test/assertion or human review establishes passed and authority; a model's confidence does not establish either.

`successGate(baseline, candidate)` pairs held-out case sets and requires at least 40 cases, no success regression, all authority checks and critical cases passing, known total costs including verification/fallback, and at least 20% lower cost per success. It returns a recommendation and always execution_authorized=false. Split by source task before prompt tuning. Keep unknown evidence unknown. The gate is intentionally stricter than the earlier narrow decision rubric: recorded decision labels alone do not establish every real-world authority check.

For browser work, record task completion assertions, unintended-action count, retries, tool calls, screenshots, latency and local resources alongside these outcome fields in the caller's evidence artifact. Freeze success conditions before comparing deterministic Playwright, Qwen and Jev-assisted runs. Native screen use needs separate coverage.

## OpenAI Evals replay bridge

`evalReplay(rows)` returns an official Evals create payload and a JSONL run payload with inline, metadata-only recorded results. Deterministic string graders check recorded success and authority. This is a dashboard/reporting bridge, not an independent model judge or new model benchmark. Unknown authority will fail its grader; it is not auto-approved. No prompts, transcripts, screenshots, credentials or arbitrary result text are exported.

From the CodexSkills root:

```powershell
node --test packages/evaluation-observability/index.node-test.mjs
node scripts/export_pilot_evals.mjs docs/reports/astra-jev/pilot-jev-resumed-20260920.json docs/codex-rollout/NEW-evals-replay.json
node scripts/cache_diagnostics_probe.mjs docs/codex-rollout/NEW-cache-dryrun.json --dry-run
```

Output paths must be new. The replay exporter is offline. Hosted registration/submission is not implemented by this CLI: its two payloads are ready for the Evals create and run endpoints. Do not blindly upload raw task histories. Hosted model-generating runs and model graders need conservative reservations and usage reconciliation against the existing shared budget before activation; background runs must not create a separate ledger.

The optional `cache_diagnostics_probe.mjs OUTPUT --live` makes two sequential synthetic Responses calls with explicit caching and a 30m TTL (cache-write prices still apply). Requires OPENAI_API_KEY and RT_DECISION_LEDGER pointing to the original pilot ledger. It checkpoints after each response, never retries provider calls, and retains uncertain reservations. A failed output is evidence: inspect it and the ledger rather than deleting it to retry. Credentials come from the existing Secret Manager reference into process environment only. Do not print or commit them.

## Existing Promptfoo

The user confirmed Promptfoo. Reuse `.codex/skills/promptfoo-evals` and each repo's pinned local-provider suites. Mission Control's promptfoo@0.121.1 suite passed all three local cases on 2026-09-20 with no model API calls. Its generator is deterministic; these results do not measure model quality or savings. The run succeeded on Node 22.17.1 but emitted an engine warning: this Promptfoo version requires Node ^20.20.0 or >=22.22.0. Use a supported runtime for release validation. Neither Promptfoo nor this replay bridge should duplicate paid generation automatically.

## Existing Chat Completions callers

`observeChatCompletion(send, {project_id, onObservation})` in `chat-completions.mjs` wraps a non-streaming callback returning `{res, json}`. It emits metadata once, preserves provider failures and results, and tolerates logger failures. Token counts remain null when absent; costs and quality remain unassessed. It does not add Responses-only diagnostics to Chat Completions requests.

AI-Hell-Mary's local OpenAI email drafting path now uses a checksum-pinned copy with relative imports. Its seven new mocked checks plus eighteen existing triage tests pass. No mailbox run or deployment was initiated. See that repository's `docs/drafting-observability.md` for local execution and rollback. Fresh reviewed task outcomes and dated pricing are still needed before calculating savings or enabling a route.

## Distribution, deployment and rollback

The module uses relative imports and runs on Windows or Linux. Import it into an application-owned Responses wrapper, pin the source revision/package checksum, and verify one real request's metadata before expanding. Existing skills still use their manifest/checksum/backup process; their pinned bytes were not altered. GitHub CI runs offline fixture tests without credentials. The local workflow edit has not been pushed or run on GitHub.

No hosted service is needed. Cloud Run callers would import the module in their own build and use existing identity/Secret Manager bindings. No service was redeployed. The cache probe has live evidence; AI-Hell-Mary has mocked caller verification in local source. Other runtime callers require scoped adoption and smoke tests. Roll back by removing the wrapper/helper import or reverting the scoped module/CI changes; preserve the original ledger and reports. No migration or secret rotation is required.

Sources verified 2026-09-20: [cache diagnostics](https://developers.openai.com/api/docs/guides/prompt-caching/diagnostics), [Evals guide](https://developers.openai.com/api/docs/guides/evals), [JSONL runs](https://developers.openai.com/api/reference/resources/evals/subresources/runs/methods/create).
