# CRM conversation workspace

## Outcome and scope

Give the signed-in CRM operator a mobile-friendly text and voice assistant, with visible tool receipts and editable local drafts. Expose the same bounded tools through WebMCP when a compatible browser provides it. The website must still work without Codex, WebMCP, microphone permission, or an enabled AI provider.

Base: `origin/main` at `6d79c844b48a823e51f9371fe3c8f32cc7c5adef`. Isolated worktree: `C:\CTO Projects\.worktrees\crm-conversation-20260908`, branch `codex/crm-conversation-20260908`. Prior CRM and dedicated Gallery sender release remains unchanged.

Initial implementation was local and mock-only. Marcus subsequently approved publication and a brief user-attended OpenAI/phone check with "push live!" on September 8. Release through the existing protected PR/main workflow; preserve integrations and existing safeguards. Newsletter sends, new enrollments, imports, survey publication, scheduler changes, credential replacement and a broader unattended voice rollout remain excluded. Existing manual outreach confirmation and sender restrictions remain intact; no second reviewer is introduced.

## Design

- Fifth CRM workspace, Assistant, with a prominent Talk to CRM entry. Reuse Gallery ivory/plum, brand glyphs, keyboard tabs and reduced-motion behavior.
- Text uses a bounded server-side Responses loop. Voice uses browser WebRTC and authenticated server SDP negotiation with OpenAI Realtime. Native fetch, no added SDK required.
- API keys remain on the server. Use the existing owner-scoped secret resolver only on explicit AI requests, never on passive readiness checks. Disabled by default via server environment flags.
- Server validates every tool input and derives UID from Firebase authentication. Read-only CRM evidence and draft proposals only. No generic URL fetch, shell execution, account selector, arbitrary OAuth profile, approve, send, delete or enrollment tool.
- Draft cards are editable session-local proposals; they do not imply CRM or Gmail persistence. Existing CRM surfaces remain the deliberate path for saving contacts and reviewing/sending outreach.
- This first slice exposes aggregate CRM summary, existing outreach copy preview, existing share cards and editable draft proposals. Contact intake writes, live outreach readiness, inbox analytics and survey collection are not tools in this version; unavailable evidence must never be synthesized as fact. A registry contact-point total is not a newsletter audience.
- Browser WebMCP uses current `document.modelContext.registerTool` with AbortSignal cleanup, same-origin default, explicit opt-in and no fallback polyfill. It is an additional site-tool channel, not the voice transport.
- Microphone starts only after a click and permission. Show state, mute/stop and transcript; release media on stop, error, logout, background and unmount. Typed chat is independent of microphone. Local voice duration guard is a UX safeguard, not a hard provider billing cap.
- Use UID-scoped rate limits, idempotency for billable create requests, bounded payloads/tool rounds, sanitized error messages, correlation IDs and metadata-only logs. Never log raw audio, SDP, contact content, transcripts, API keys or provider error bodies.

## Work split

- Main: contracts, voice controller, WebMCP adapter, protocol research, integration review, docs and local browser tests.
- Backend editor: provider gateways, scoped tool dispatcher, route guards and mocked unit/smoke tests.
- UI editor: conversation workspace, tab integration, local editable result cards and related UI tests.
- All handoffs identify objective, scope, artifacts, evidence, blockers and next action. No agent deploys or calls live providers.

## Verification

- Unit: schemas/allowlists, denied write/profile/UID injection, same authenticated scope, provider failure redaction, bounded tool loop, duplicate request handling, microphone lifecycle races, tool-event deduplication, WebMCP unsupported/registration/cleanup.
- Smoke: unauthenticated/disabled/rate-limited routes, mocked text -> tools -> response, mocked voice SDP/hangup, no secrets in client response.
- Desktop/mobile browser with fake authentication and intercepted APIs, no real microphone/provider: navigation, typed request, edit draft, voice unavailable/permission failure, stop and logout, no horizontal overflow.
- Typecheck, lint, full unit/smoke suites, production build, dependency audit and changed-file secrets scan. Tests that cannot run are explicitly documented.

## Local run / deployment

Use Node 22 and `npm ci`, then `npm run dev -- --port 3081`. Existing Firebase browser configuration is required for normal login. AI routes require explicit server flags and a securely configured owner-scoped OpenAI key or server `OPENAI_API_KEY`; no credential belongs in a `NEXT_PUBLIC_*` setting. Exact settings and validation steps will be recorded in a feature runbook before handoff.

Deployment is a separate authorization gate: use the repository's existing reviewed Firebase/App Hosting release pipeline, preserve dedicated Gallery sender and existing integration secrets, start with AI flags disabled, and validate authenticated owner workflows and real mobile audio before enabling. Do not claim readiness from mocked tests alone.

## Progress

- [x] Read project rules/skills and inventory current UI/backend; verify official WebMCP, Realtime/WebRTC and function-calling docs.
- [x] Create isolated worktree and define scope/ownership.
- [x] Implement contracts, backend and browser UI.
- [x] Run local mocked verification and record findings.
- [x] Write deployment/runbook and user handoff; production remains unchanged.

### Verification notes

The first integration run uncovered an existing unhandled offline Firestore read in optional `FirstScanTour.boot`. A scoped catch now closes the optional tour without persisting onboarding status. The next desktop/390px/320px run passed all mocked flows and recorded no page errors or overflow.

The full unit/smoke suite passed 1,112 tests across 238 files. The subsequent compact-mobile voice placement and explicit draft-revision affordance passed the final 125-test Assistant/workbench/workflow focused suite. Full lint has zero errors and three existing unrelated warnings; final changed UI/client/config lint is clean. TypeScript and the final production build passed, including all 91 static pages. Dependency audit has no high/critical findings and 15 moderate findings in unchanged dependencies. Initial 32-file redacted secret scan passed; the final scan is recorded in the latest-run report.

The final production-start Chromium suite passed at 1440px, 390px and 320px (3/3, 34.6 seconds), with fake authentication, intercepted APIs and a simulated microphone. It covered explicit draft revision without automatic transmission, tab persistence, voice cleanup, permission denial, optional WebMCP execution/cleanup, recovery with all new AI flags off and consent unchecked, and offline draft retention. No page errors, unexpected mutations or horizontal overflow. After compact mobile controls were added, one test locator matched both visible and CSS-hidden status text; the assertion now uses the accessible status role. No application change was needed for that test-only issue. Final desktop/mobile screenshots were visually inspected and copied to the RNG project at `output/crm-conversation-2026-09-08/`. The harness stopped its owned port 3081 server. The synthetic Firebase test build must never be deployed.

An independent authorization/lifecycle review found no actionable P1/P2 issues. Known limits remain explicit in `docs/crm-assistant.md`: voice uses a foreground timer, unknown provider call IDs require reconciliation, drafts are local only, and inbox/search/intake mutations/analytics/survey publication are not implemented tools. Feature flags and live API access were not enabled.

## References (verified 2026-09-08)

### Publication continuation

- [x] Explicit user publication approval received; refreshed `origin/main` still equals tested base `6d79c844` and no matching PR exists.
- [x] Capture fresh coordinated Hosting/Cloud Run rollback metadata without exposing credentials. At 22:10:01 UTC, Ready 100% revision `ssrleadflowreview-release-34269666110-1` and Hosting `dfc76bd88d85e195`/tag `release-34269666110-1` matched and stayed stable. All five preserved references matched; zero warm pilots and zero direct warm Scheduler targets. OpenAI readiness is a separate pending check.
- [ ] Commit the exact tested feature, push its isolated branch, and pass required PR checks. Do not bypass protected-main checks or deploy the synthetic local build.
- [ ] Publish through the existing release workflow, verify exact runtime flags and preserved references, then verify the live application. Owner-started text/voice controls may be enabled for the approved brief attended test, not unattended rollout.
- [ ] Record final evidence and remaining user microphone/API setup steps. No email connectivity tests.

Prior default-off staging guidance was written before publication approval. The approved activation may carry the two server flags through the release pipeline once the intended existing provider access and ownership gates are established; no new key, API purchase or secret binding is authorized implicitly. If access cannot be established safely, publish the UI with a truthful setup requirement and do not claim working voice.

- [OpenAI site tools](https://learn.chatgpt.com/docs/webmcp)
- [WebMCP draft](https://webmachinelearning.github.io/webmcp/)
- [Realtime WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [Realtime conversations/function calls](https://developers.openai.com/api/docs/guides/realtime-conversations)
- [Realtime server controls](https://developers.openai.com/api/docs/guides/realtime-server-controls)
- [Responses function calling](https://developers.openai.com/api/docs/guides/function-calling)
