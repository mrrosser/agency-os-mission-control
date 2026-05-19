# Agents

## Quick links
- Local playbook: `skills_playbook.md`
- Exec plans: `docs/execplans/`
- Planning docs: `docs/plans/`

## Global sources
- Shared skills: `C:\CTO Projects\CodexSkills`
- RT loop (global skill): `C:\CTO Projects\rt-infinite-loop`


## Skill trigger surface
- When a request maps to a local workflow, name the exact skill in the prompt (example: `Use $skill-automation-ops` for cross-repo skill/playbook audits, and `Use $subagent-handoff-contract` when work is split across planner/editor/verifier/safety handoffs).
- Include one intent verb + target artifact + constraints so the skill routes with fewer clarification turns.
- Invoke `skills_playbook.md` before multi-step edits to avoid defaulting to broad repo scans.
## Rule
- Repo-local `docs/` is the source of truth for this project.
