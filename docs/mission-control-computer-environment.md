# Mission Control Computer Environment

This repo uses the shared Responses-style computer-environment contract as a bounded commercial-control and lead orchestration surface, not as a public browser runtime.

## Entry points
- Shared skill: `C:\CTO Projects\CodexSkills\.codex\skills\responses-computer-environment\SKILL.md`
- Local wrapper skill: `C:\CTO Projects\agency-os-mission-control\skills\mission-control-computer-environment\SKILL.md`
- Shared validator: `C:\CTO Projects\CodexSkills\.codex\skills\responses-computer-environment\scripts\validate_manifest.ps1`
- Local manifest: `C:\CTO Projects\agency-os-mission-control\docs\computer-environment-manifest.json`

## Lane split
- Shell, control-plane, and MCP work stay in this repo and should follow the local manifest plus the execution-envelope rules.
- Browser, OAuth, admin UI, and other screen-driven validation should run through `C:\CTO Projects\ui-tests`.
- Consequential actions still fail closed when `run_id`, `correlation_id`, or the required execution metadata is missing.

## Validation
```powershell
powershell -ExecutionPolicy Bypass -File C:\CTO Projects\CodexSkills\.codex\skills\responses-computer-environment\scripts\validate_manifest.ps1 -ManifestPath C:\CTO Projects\agency-os-mission-control\docs\computer-environment-manifest.json
```

## Code and runtime checks
- `npm run lint`
- `npm run test:unit`
- `npm run test:smoke`
- `npm run build`

## Notes
- Keep secrets out of the repo and resolve them through environment variables or Secret Manager references.
- Use checkpoint artifacts under `docs\reports` and durable state under `tmp\computer-environment`.
- Treat this contract as the bounded runtime for revenue, social-dispatch, and operator workflows, not as blanket permission for every frontend path.
