# Autonomous Business Control Plane

## Goal
- Extend Agent Nexus from visibility-only monitoring into a real autonomous-business operating surface.
- Add the missing Paperclip, budget-governor, omnichannel customer-memory, product/ad-ops, profit-attribution, mobile-ops, and reliability summaries to the existing Mission Control control plane.
- Keep the implementation fail-closed, mobile-readable, and backward compatible with the current queue-based operator actions.

## Scope
- `app/api/ad-ops/campaigns/route.ts`
- `app/api/ad-ops/campaigns/[campaignId]/action/route.ts`
- `app/api/agents/control-plane/route.ts`
- `app/api/agents/actions/route.ts`
- `app/api/crm/customers/route.ts`
- `app/api/crm/customers/[customerId]/route.ts`
- `app/api/crm/customers/[customerId]/timeline/route.ts`
- `app/api/elevenlabs/synthesize/route.ts`
- `app/api/heygen/create-avatar/route.ts`
- `app/api/twilio/make-call/route.ts`
- `app/api/twilio/send-sms/route.ts`
- `app/dashboard/agents/page.tsx`
- `app/dashboard/crm/page.tsx`
- `app/dashboard/operations/page.tsx`
- `components/operations/AdOpsControlCard.tsx`
- `lib/agent-control-plane.ts`
- `lib/ad-ops/client.ts`
- `lib/budget/enforcement.ts`
- `lib/control-plane/autonomous-business.ts`
- `lib/crm/customer-memory.ts`
- `lib/paperclip/client.ts`
- `middleware.ts`
- `tests/unit/agent-control-plane.test.ts`
- `tests/unit/ad-ops-client.test.ts`
- `tests/unit/autonomous-business-control.test.ts`
- `tests/unit/budget-enforcement.test.ts`
- `tests/unit/customer-memory.test.ts`
- `tests/unit/paperclip-client.test.ts`
- `tests/smoke/ad-ops-routes.test.ts`
- `tests/smoke/agents-control-plane-route.test.ts`
- `tests/smoke/agents-actions-route.test.ts`
- `tests/smoke/crm-customers-route.test.ts`
- `tests/smoke/elevenlabs-route.test.ts`
- `tests/smoke/heygen-route.test.ts`
- `tests/smoke/twilio-routes.test.ts`
- `README.md`
- `.env.local.example`

## Definition of done
- Agent Nexus exposes the autonomous-business operating state in one snapshot payload.
- Paperclip is represented through a server-only client with live health/count reads and direct lifecycle proxy support.
- Consequential Paperclip lifecycle actions fail closed behind Mission Control and honor the global kill switch.
- Mission Control has server-side customer-memory routes for customer list, customer upsert, pipeline-stage updates, and per-customer timeline reads.
- The CRM dashboard reads from the new server-side customer-memory contract instead of direct Firestore client writes.
- Ad-ops exposes provider-backed campaign listing plus fail-closed pause/resume/sync routes with trust-envelope and budget checks.
- Budget governor posture, customer-memory posture, product/ad-ops readiness, profit attribution, mobile ops, and reliability posture are all visible in the dashboard.
- Hard-stop budget enforcement is active on spend-bearing Twilio, ElevenLabs, and HeyGen routes.
- Local env/deploy docs cover the new Paperclip, budget, mobile, ad-ops, and reliability knobs.
- Unit + smoke coverage exists for the new control-plane builders and the Paperclip client/action route behavior.

## Status
- [x] Repo-local execplan added.
- [x] Added pure autonomous-business control-plane builders.
- [x] Added server-only Paperclip client with summary + lifecycle proxy support.
- [x] Wired the new business snapshot into `GET /api/agents/control-plane`.
- [x] Extended `POST /api/agents/actions` with direct Paperclip lifecycle proxy actions.
- [x] Updated Agent Nexus UI with mobile-friendly business-control cards and direct lifecycle buttons.
- [x] Added unit + smoke coverage for the new payload and Paperclip behavior.
- [x] Updated env + README documentation.
- [x] Added hard-stop spend enforcement for Twilio, ElevenLabs, and HeyGen routes.
- [x] Added unit + smoke coverage for budget-enforcement behavior.
- [x] Added Paperclip-backed customer-memory API routes with Firestore projection fallback.
- [x] Switched the CRM dashboard to the customer-memory API contract.
- [x] Added provider-agnostic ad-ops campaign routes with trust-envelope + budget enforcement.
- [x] Surfaced ad-ops controls in Operations.
- [x] Added unit + smoke coverage for customer-memory and ad-ops routes.
- [x] Added idempotent Firestore -> Paperclip CRM backfill tooling and documented the cutover contract.
- [x] Updated Agent Nexus customer-memory summary to read canonical Paperclip counts when Paperclip is the live source of truth.
- [x] Added direct-provider env/docs for Meta Ads and Google Ads transports.
