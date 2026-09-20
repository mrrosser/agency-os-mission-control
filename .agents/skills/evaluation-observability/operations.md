# Runtime operation

Node 22+ and Python 3.11+; built-in modules only. Relative paths work locally and in repository cloud checkouts. No hosted service or background process is installed.

From a project root:

```text
node --test .agents/skills/evaluation-observability/providers.test.mjs
python -m unittest discover -s .agents/skills/evaluation-observability -p test_measure_command.py
python .agents/skills/evaluation-observability/measure_command.py --project your-project --case existing-check --kind local-task --receipt .runtime/evaluations/unique-run.json -- python path/to/existing_validator.py
```

Choose an authorized command and its timeout deliberately. The wrapper creates the receipt exclusively before execution, uses argv without shell interpolation, and captures only output sizes/hashes. It is not an execution sandbox. On timeout it kills the measured process; descendant cleanup is not certified. Use existing engine cancellation controls for render farms and asynchronous jobs. Command success is not model quality, authority approval or a deployment gate.

`observeProvider` supports non-streaming Gemini, Ollama and OpenAI Responses objects. Streaming callers must observe their final aggregated response themselves. The Gemini caller adapter is verified in T.A.L.K; the installed package alone does not intercept any application, Codex internal request or arbitrary MCP call. Token pricing stays unknown until joined to a dated resolved-model price and invoice/usage reconciliation. Reasoning token fields have provider-specific inclusion rules; do not blindly sum them.

Source is authored in CodexSkills `packages/evaluation-observability`. The skill distribution tool accepts this explicit SourceRoot. Releases use a clean committed checkout, registry-approved targets, reviewed file hashes, dry run, external preimage backup and apply receipt. Rollback uses the same `restore_runtime_sync.ps1` with the receipt and expected source root; it refuses later target drift. Repository cloud distribution requires committing this relative package on the project's release branch and testing discovery in that environment. Local installation does not prove cloud activation.

No model default or provider credential is changed. Revert a caller wrapper separately from a package rollback; do not remove a package while a caller imports it. Actual client services retain their own release gates, clean-source requirements and rollback procedures.

Field references verified 2026-09-20: [Gemini response usage](https://ai.google.dev/api/generate-content), [Ollama usage](https://github.com/ollama/ollama/blob/main/docs/api/usage.mdx). OpenAI references are in README.md.
