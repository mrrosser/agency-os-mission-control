---
name: evaluation-observability
description: Measure authorized application model calls, MCP or creative-tool tasks, and data jobs; compare reviewed quality, latency and cost before changing routing. Use for optimization and task verification, not ordinary conversation.
---

# Evaluation observability

Use existing project tests and deterministic tools first. This package records evidence; it never grants tool, deployment, communication, security-scan or spending authority. Jev remains advisory. Do not add a model call merely to choose a tool.

## Workflow
1. Identify the canonical project, its existing caller, and one bounded authorized task. Read its local playbook. Preserve unrelated work.
2. Freeze success and failure criteria before comparing approaches. Distinguish API requests, local inference, MCP transport, rendering, data processing and human acceptance.
3. For an application-owned request, use `providers.mjs` for Gemini, Ollama or Responses, `chat-completions.mjs` for OpenAI Chat Completions, and `index.mjs` for Responses cache diagnostics. Keep payloads, timeouts, retries and authorization with the caller. Use one observation per actual attempt.
4. For an already authorized command, run the relative `measure_command.py` wrapper with a new receipt path. It stores timing, exit status and output hashes, never raw arguments/output. Exit zero proves only command completion. Review the actual artifact and record quality/authority separately.
5. Store fresh reviewed results using the outcome contract and `successGate` in `index.mjs`. Unknown costs, incomplete authority evidence and insufficient held-out coverage defer promotion. Retain all verification/fallback calls in total cost.
6. Log metadata with correlation IDs. Keep credentials in existing environment/Secret Manager; do not upload raw client content. API budgets use the existing shared ledger. Local compute and Codex subscription usage are separate quantities.

## Domain checks
- Artist/Blender/Unreal/diffusion: cheap scene/workflow preflight first; preserve client files. Record artifact validity, visual review, geometry/print constraints, engine/model versions and measured GPU/VRAM when available. Never reuse an output cache across differing input hashes, settings or versions. A successful MCP response does not prove visual correctness.
- Water/data: verify schema, units, provenance, freshness and row/raster bounds. Reuse unchanged deterministic materializations only when those invariants permit it. Do not infer data quality from a successful HTTP response.
- CRM: mocked provider regression plus reviewed task outcome; no automatic send from an eval result.
- Security: local fixtures by default; external scans retain existing authorization and scope enforcement. No model score overrides an allowlist.

## Verification
`node --test providers.test.mjs` and `python -m unittest discover -s . -p test_measure_command.py` run offline inside the package. `index.test.mjs` also contains canonical-repository CLI checks; run it in CodexSkills, not a minimal runtime mirror. Read [README.md](README.md) for adapters and [operations.md](operations.md) for installation, release and rollback.

## Example prompts
- Measure the existing Blender artifact validator and record a receipt without changing the scene.
- Compare reviewed CRM draft quality and total API usage before promoting a cheaper route.
- Validate WaterWorld data materialization using local fixtures and report missing live evidence.
