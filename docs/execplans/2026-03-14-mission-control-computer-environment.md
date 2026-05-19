# Mission Control Computer Environment Rollout

## Goal
- Add a repo-local computer-environment manifest for `agency-os-mission-control`.
- Add a local skill wrapper that points agents at the shared validator and the repo-local contract.
- Keep browser-dependent validation routed through `C:\CTO Projects\ui-tests`.

## Scope
- `docs/computer-environment-manifest.json`
- `docs/mission-control-computer-environment.md`
- `skills/mission-control-computer-environment/SKILL.md`
- `skills_playbook.md`

## Definition of done
- Local manifest scopes the repo's paths, domains, secrets, artifacts, and compaction state.
- Local wrapper skill exists and references the shared validator.
- Local docs and playbook call out `ui-tests` as the browser/computer-use lane.

## Status
- [x] Local manifest added.
- [x] Local wrapper skill added.
- [x] Playbook updated with the computer-environment entrypoint.
