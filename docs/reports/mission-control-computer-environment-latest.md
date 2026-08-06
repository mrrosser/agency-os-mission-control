# Mission Control CRM Audit Checkpoint

- run_id: `crm-audit-20260806`
- milestone_id: `integration`
- task_id: `crm-ui-autonomy-protocol`
- status: `in_progress`
- evidence:
  - `docs/execplans/2026-08-06-crm-ui-agents-full-audit.md`
  - production Cloud Run revision `ssrleadflowreview-00297-dnx`
  - Tailscale Funnel host `ai-hell-mary-gateway.tail592a2d.ts.net`
  - Figma audit file `KNtDTEkNkrwblkGcGUn0wm`, observed capture node `2:2`
  - integrated commits `153b8e3`, `0249d40`, and `9f6760a`
- decisions:
  - Keep consequential actions fail-closed behind the execution envelope and approval policy.
  - Run browser-dependent verification through Playwright with desktop and phone projects.
  - Use only observed Figma file, node, and library identifiers.
- next_actions:
  - Integrate and review the agent protocol and Google profile patches.
  - Run the serial full unit, smoke, Playwright, build, and dependency gates.
  - Deploy with a recorded rollback revision, remeasure production, and email the verified mobile URL.
