---
name: mission-control-computer-environment
description: Use when working inside agency-os-mission-control and you need the repo-local Responses computer-environment manifest, fail-closed execution-envelope expectations, or the required handoff into ui-tests for browser validation.
---

# Mission Control Computer Environment

## When to use
- You are making agent, revenue, social-dispatch, or operator changes in `C:\CTO Projects\agency-os-mission-control`.
- You need the repo-local computer-environment manifest before a long-running Responses-style loop.
- You want browser-dependent validation routed into `C:\CTO Projects\ui-tests` instead of mixed into general shell automation.

## Quick start
Validate the local manifest:

```powershell
powershell -ExecutionPolicy Bypass -File C:\CTO Projects\CodexSkills\.codex\skills\responses-computer-environment\scripts\validate_manifest.ps1 -ManifestPath C:\CTO Projects\agency-os-mission-control\docs\computer-environment-manifest.json
```

## Workflow
1. Validate `docs\computer-environment-manifest.json`.
2. Keep shell and MCP work inside the manifest's allowed paths.
3. Preserve the existing execution-envelope requirements for consequential actions.
4. Route browser-dependent checks through `C:\CTO Projects\ui-tests`.
5. Run the repo gates before declaring success.

## References
- `C:\CTO Projects\agency-os-mission-control\docs\computer-environment-manifest.json`
- `C:\CTO Projects\agency-os-mission-control\docs\mission-control-computer-environment.md`
- `C:\CTO Projects\CodexSkills\.codex\skills\responses-computer-environment\SKILL.md`

## Verification
- [ ] `powershell -ExecutionPolicy Bypass -File C:\CTO Projects\CodexSkills\.codex\skills\responses-computer-environment\scripts\validate_manifest.ps1 -ManifestPath C:\CTO Projects\agency-os-mission-control\docs\computer-environment-manifest.json`
- [ ] `npm run lint`
- [ ] `npm run test:unit`
- [ ] `npm run test:smoke`
- [ ] `npm run build`

## Example prompts
- "Use the Mission Control computer-environment skill and validate the repo manifest first."
- "Checkpoint this commercial-control run and keep the next operator action explicit."
- "Move the browser validation step into ui-tests and keep the shell work in mission control."
