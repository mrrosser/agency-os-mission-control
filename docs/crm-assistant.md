# CRM Assistant: local implementation and operator runbook

## Release state

This implementation on `codex/crm-conversation-20260908` is based on the September 8 dedicated Gallery sending release. Local verification is complete. Marcus has now approved publication and a brief attended OpenAI/phone check; publication evidence is tracked in `docs/execplans/2026-09-08-crm-assistant-release.md` and the release handoff. Approval is not proof of deployment or live connection. Gallery mailbox, sender permissions, contacts, consent records and campaigns are outside this feature's mutation scope.

## What the first version does

Open CRM → Assistant, acknowledge the AI request notice, then type or choose Start voice. The assistant returns visible evidence and editable draft cards. Voice includes microphone selection after permission, mute, stop, final transcripts, mobile playback recovery and connection error handling. Typed chat does not depend on microphone access or WebMCP.

The four shared tools are:

| Tool | Evidence or result | Side effects |
| --- | --- | --- |
| `get_crm_summary` | Owner/workspace-scoped registry totals, source and permission counts, freshness | Read only; not an individual contact search or verified newsletter audience |
| `get_outreach_review` | Existing warm-reconnection copy preview | Read only; not a live send-readiness check or approval |
| `get_share_cards` | Existing public Gallery/RT contact-card URLs, QR assets and vCards | No new QR, subscription or ingestion receipt |
| `prepare_draft` | Editable newsletter, reply, survey or intake proposal | Session-local UI state only; not saved, sent, published or approved |

Drafts can be edited, copied or downloaded. **Revise with Assistant** puts the current edited copy into the composer for a separate Send; edits are not silently shared with AI. Oversize copy must be shortened or revised in sections, not silently truncated. Changing CRM tabs preserves local drafts; reload, logout and clearing the conversation discard them. Export before leaving. An intake proposal is not a saved contact, and a survey draft is not a hosted survey. Each new voice session starts fresh; earlier typed messages are not automatically forwarded into it.

Individual contact search, inbox replies, engagement analytics, survey response collection and automatic first-party form ingestion are not connected to this Assistant. Do not use the assistant's general language as evidence that any of those actions occurred. Existing People, Outreach, Share cards and Activity workflows remain available.

## Architecture and boundaries

Text: browser → Firebase-authenticated `/api/crm/assistant/chat` → bounded server-side OpenAI Responses loop → fixed UID-scoped CRM tools → reply/cards.

Voice: explicit browser microphone permission → WebRTC offer → authenticated `/api/crm/assistant/voice` → server-owned OpenAI Realtime call → SDP answer. Media goes directly over WebRTC. Tool calls from the data channel go through the authenticated `/api/crm/assistant/tools` gateway. The standard API key never reaches the browser. This is not a remote Codex session and exposes no shell, filesystem, arbitrary URL or arbitrary MCP tool execution.

WebMCP: optional operator-enabled `document.modelContext.registerTool` registrations in compatible browsers. The fixed tools use the same server gateway and same-origin defaults, with registration and execution abort cleanup. Unsupported browsers retain ordinary text/voice UI. WebMCP is site-tool access, not microphone transport.

Every action route reauthenticates; operational reads verify existing portfolio workspace access. The model cannot choose a UID, mailbox, OAuth profile or escalation mode. No send, approval, delete, import, enrollment, contact write or provider-draft action is exposed. Human review remains the existing owner's step, not a second approver.

The drafting prompt incorporates Marcus voice/shared-email guidance: warm and direct, concrete verified details, plain text, no generic corporate filler or manufactured urgency, and one clear next step. Model self-review does not approve facts or authorize publication.

## Configuration

Use Node 22 and the repository's normal Firebase browser setup. An example with no secrets is in `config/crm-assistant.env.example`.

| Server setting | Default | Purpose |
| --- | --- | --- |
| `CRM_ASSISTANT_ENABLED` | `false` | Enables text and the fixed tool gateway |
| `CRM_ASSISTANT_VOICE_ENABLED` | `false` | Enables new voice calls only when the parent switch is also true |
| `OPENAI_CRM_MODEL` | `gpt-4.1-mini` | Configurable text model |
| `OPENAI_CRM_REALTIME_MODEL` | `gpt-realtime-2.1` | Configurable Realtime model |
| `OPENAI_CRM_VOICE` | `marin` | Allowlisted built-in voice |
| Owner secret `openaiKey`, or server `OPENAI_API_KEY` | None | Existing secure resolver; never use a `NEXT_PUBLIC_*` key |

The read-only capabilities endpoint checks switches and owned voice recovery metadata. It does not read a key or call OpenAI. “Available on request” means the feature switches permit requests, not that a live model/key has been verified. The existing resolver can migrate legacy identity API-key configuration when an explicit AI request first resolves a key. No migration was performed during this implementation's mocked checks.

Local run:

```powershell
npm ci
npm run dev -- --port 3081
```

Set the flags only in a server environment intended for authorized AI use. Use the existing signed-in owner's workspace. Do not paste API keys into the assistant, browser console, transcripts, source files or Codex messages.

## Limits, privacy and recovery

- Text: 10 messages, 4,000 characters each and 20,000 characters total; 45-second provider loop; at most three provider rounds, six tool calls and 1,200 output tokens per response.
- UID-scoped distributed fixed windows: chat 8/minute and 100/day; direct tools 30/minute and 500/day; voice starts 3/minute and 12/day; stop 20/minute and 200/day. Failure of safety-control storage fails closed.
- Atomic content-fingerprinted request reservations prevent the same billable create request ID from being automatically reissued. Replays return a conflict; raw responses and transcripts are not cached in receipts. Chat has a two-minute concurrency lease; voice allows one active or unconfirmed session per owner. No automatic TTL deletion is configured for control/receipt metadata.
- Logs contain route/tool metadata and correlation IDs, not raw transcripts, SDP, audio, provider errors or tool content. Control/receipt collections contain hashes, state, timestamps and owner-bound provider call IDs, not customer conversations. Browser drafts/transcripts are memory-only. No audio recording is saved by this application. OpenAI account/provider retention policies still apply; `store:false` for Responses does not promise zero provider retention.
- Mute pauses microphone input by disabling its tracks; the provider session remains connected. Stop, the foreground five-minute timer and session cleanup release local tracks and close the peer connection. A server Stop request then hangs up the recorded owner-bound provider call. Stop remains available when new AI requests are disabled or consent is unchecked. Leaving the workspace, hiding the page or signing out stops local voice and attempts server cleanup.
- If a create response arrives after Stop, the controller consumes it and requests hangup. If the response is lost entirely, reload/check availability to find the outstanding owned session. Use **End previous voice session** when a tracked call exists. Exact provider 404 for a recorded call is treated as already absent; other failures retain the lock.
- An unknown call ID after an uncertain provider create cannot safely be auto-unlocked. Stop the microphone, keep voice disabled, and reconcile the owner request receipt against provider-side call evidence before marking it stopped. Do not delete safety-control documents or repeatedly create sessions to bypass the hold. Text remains independent where available.
- This is not a hard dollar budget or a durable automatic provider-session timeout. Closing a browser, device power loss or network failure can prevent cleanup. A durable sideband/expiry worker and approved project-level spending controls are required before broader unattended or multi-user voice rollout. No such worker or budget was created here.

## Verification

All automated tests use synthetic local identities and mocked APIs. No real microphone or billable OpenAI request is necessary for these commands:

```powershell
npm run test:unit
npm run test:smoke
npx tsc --noEmit
npm run lint
npm run build
npm audit --audit-level=high
$env:PLAYWRIGHT_PORT = '3081'
npx playwright test tests/playwright/crm-assistant.spec.ts --project=chromium --workers=1
```

For a production-build browser check, build with the same synthetic `NEXT_PUBLIC_FIREBASE_*` values as the local Playwright configuration, then set `PLAYWRIGHT_USE_BUILD=true` before the Playwright command. The harness starts and stops its own local `next start` process; do not build while a server is using the same `.next` directory. Never publish that synthetic test build.

The Assistant browser suite refuses a deployed `PLAYWRIGHT_BASE_URL`, intercepts all API traffic, blocks external requests, seeds synthetic local Firebase state and uses a fake microphone/peer connection. Desktop, 390px and 320px checks cover draft editing/export and explicit revision, tab persistence, voice mute/cleanup, permission denial, optional site-tool execution/cleanup, recovery with flags off and consent unchecked, offline draft retention, and horizontal overflow. The final production-start run passed all three sizes. Real speech quality, iOS/Android microphone behavior and a compatible production WebMCP client require a separate user-attended check.

## Deployment after approval

Use the existing repository test/build and protected-main Firebase release workflow. Its new repository variables `CRM_ASSISTANT_ENABLED` and `CRM_ASSISTANT_VOICE_ENABLED` default to `false`; PR checks hard-disable both. The production workflow propagates both server flags to the candidate revision and verifies them before assigning the release tag. No flags were changed externally for this implementation.

1. Complete review and local gates, then obtain authorization to publish this feature. Keep both switches false for the first release. Preserve the five existing integration secret references and dedicated Gallery sender configuration.
2. Configure OpenAI access through the existing secure owner vault or an explicitly approved server Secret Manager mapping. This change does not add a secret binding or purchase API credits. If using the server fallback, preserve its approved mapping in the release pipeline, not an ad-hoc revision edit.
3. Confirm both authenticated workspace ownership and failed unauthorized requests on the deployed candidate. Check that capabilities and voice recovery metadata are private/no-store. Confirm the existing CRM/outreach workflows still work.
4. After approval for live API usage, enable text, run a small user-attended draft/read test, then separately enable voice and test the real microphone on the user's phone. Stop and verify call cleanup before ending the test. Do not send email as a connectivity test.
5. Review source coverage, consent, sender identity and the exact outward copy/audience in the existing outreach UI before any real send. Voice does not bypass that step.

Rollback: turn both Assistant variables off and release through the same pinned-runtime pipeline; keep Stop available for tracked calls. Existing live sessions must be explicitly ended or reconciled because a feature flag does not itself terminate provider media. If a code rollback is required, preserve the prior verified revision/Hosting binding using the established release runbook.

## Protocol references

- [OpenAI site tools](https://learn.chatgpt.com/docs/webmcp)
- [WebMCP draft](https://webmachinelearning.github.io/webmcp/)
- [OpenAI Realtime WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [OpenAI Realtime conversation/tool events](https://developers.openai.com/api/docs/guides/realtime-conversations)
- [OpenAI Realtime server controls](https://developers.openai.com/api/docs/guides/realtime-server-controls)
