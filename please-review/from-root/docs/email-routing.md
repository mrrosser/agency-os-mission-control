# Email Routing + Labels (Draft-First)

Purpose
- Provide a consistent routing/label strategy across the three inboxes.
- Keep outbound messages in draft-only mode until explicit human approval.

Accounts
- mrosser@rossernftgallery.com (Rosser NFT Gallery + RT Solutions)
- mcool4444@gmail.com (personal/overflow; keep minimal labels)
- marcus@aicofoundry.com (AI CoFoundry)
- marcuslrosser@gmail.com (phone account; keep minimal labels)

Base Labels (apply to all accounts)
- Needs-Reply
- Lead
- Client
- Quote
- Follow-Up
- Ignore

Optional Business-Specific Labels
Rosser NFT Gallery (apply in RNG mailbox: mrosser@rossernftgallery.com)
- RNG/NFT
- RNG/Commission
- RNG/3D-Print
- RNG/Preservation
- RNG/Event
- RNG/Reputation

RT Solutions (apply in RNG mailbox: mrosser@rossernftgallery.com; uses RNG alias)
- RTS/Workshop
- RTS/PD
- RTS/AfterSchool
- RTS/Consulting

AI CoFoundry (apply in AI CoFoundry mailbox: marcus@aicofoundry.com)
- AICF/Discovery
- AICF/Pilot
- AICF/Build
- AICF/Support

Routing Keywords (apply filters to set labels)
- Full filter definitions live in `config-templates/gmail-labels-filters.yaml`.
- Use the high-confidence queries from that file for each business.

Label Rules (recommended)
- If a message matches any business keyword -> label Lead
- If the sender domain is a known customer -> label Client
- If the message asks for price/quote -> label Quote
- If a reply is requested -> label Needs-Reply
- Promotions/newsletters -> label Ignore

Draft-First Workflow (target behavior)
1) New email hits label Lead or Needs-Reply.
2) Agent drafts response (no send). Optional: post a short digest to Chat ("Drafts ready") without sending.
3) User reviews drafts in Gmail and hits Send (this click is the approval gate).
4) Use business-specific template bank to avoid same reply for all businesses:
   - `config-templates/email-reply-templates.v1.json`

Canonical booking links (current)
- RT Solutions: `https://calendar.app.google/Yt9Lm2yBjjkrbyiHA`
- Rosser NFT Gallery: `https://calendar.app.google/d6WVsrcihD63TZZj8`
- AI CoFoundry: `https://calendar.app.google/LEk5GQobBpAXTfpR9`
- Policy: always attach Google Meet for auto-booked events.

Expected Triage Outcomes (important)
- `triage.search` can return results while `draftsCreated` remains `0`; this is expected when suppression rules or confidence thresholds skip messages.
- Typical skipped mail: receipts, newsletters/digests, no-reply senders, internal notes, and low-confidence intent.
- `threadsProcessed` may be `0` in quiet periods or when all matching threads are filtered out.

Triage Runtime v3 (recommended)
- Canonical runtime file: `config-templates/email-triage.runtime.v3.json`
- Includes:
  - suppression and actionable-signal guardrails
  - strict calendar rules with per-business booking links + `withMeet=true`
  - AI drafting with thread-aware prompts and knowledge-pack context
  - fallback templates per business (used only if AI draft cannot be produced)

Legacy policy file
- `config-templates/email-triage.policy.v2.json` is still useful as a reference, but runtime v3 should be the file installed on VM for current behavior.

Apply on VM
1) Copy runtime v3 to runtime config path:
   - `sudo install -m 600 -o marcu -g marcu /home/marcu/ai-hell-mary/config-templates/email-triage.runtime.v3.json /etc/openclaw/email-triage.json`
2) Restart timer/service:
   - `sudo systemctl restart openclaw-email-triage.timer`
   - `sudo systemctl start openclaw-email-triage.service`
3) Verify logs:
   - `sudo journalctl -u openclaw-email-triage.service -n 120 --no-pager`
4) Verify profile routing:
   - `sudo journalctl -u openclaw-email-triage.service -n 200 --no-pager | grep -E "triage.search|calendar|profile|booking|draft.created|triage.done"`

Draft quality/brain checks (when replies feel generic)
- Confirm AI drafting is active and model key is available:
  - `sudo journalctl -u openclaw-email-triage.service -n 200 --no-pager | grep -E "aiDraft|draft.create_failed|fallback|OPENAI|triage.done"`
- If drafts contain literal `\\n` text, runtime config likely has escaped newlines. Reinstall `email-triage.runtime.v3.json` and restart triage service.
- If drafts ignore prior thread context, check `maxMessagesFromThread` and prompt content in `/etc/openclaw/email-triage.json`:
  - `sudo sed -n '320,420p' /etc/openclaw/email-triage.json`

Fix Chat Digest Permissions (if logs show `chat.digest_failed` with `insufficientPermissions`)
- Re-auth all Gmail accounts with Workspace scopes (including Chat when available):
  - `sudo -i -u marcu bash /home/marcu/ai-hell-mary/scripts/native_reauth_google_workspace.sh`
- Verify:
  - `sudo -i -u marcu gog auth list --plain`
  - `sudo systemctl start openclaw-email-triage.service`
  - `sudo journalctl -u openclaw-email-triage.service -n 200 --no-pager | grep -E "chat.digest_failed|needsReauth|triage.done" || true`

Internal smoke test (cross-mailbox, draft pipeline)
- Send a test email from mailbox A to mailbox B with subject prefix `[triage-test]`.
- Trigger triage and verify:
  - `sudo systemctl start openclaw-email-triage.service`
  - `sudo journalctl -u openclaw-email-triage.service -n 200 --no-pager | grep -E "draft.created|threadsSkippedSelfMail|triage.done" || true`
- If `threadsSkippedSelfMail` is non-zero, continue testing with cross-mailbox senders (not same mailbox sender/recipient).

Near Real-Time Mode (recommended)
- Goal: run triage every minute while keeping autosync on its existing interval.
- Apply a systemd timer override on the VM:
  - `sudo mkdir -p /etc/systemd/system/openclaw-email-triage.timer.d`
  - `sudo tee /etc/systemd/system/openclaw-email-triage.timer.d/override.conf > /dev/null <<'EOF'`
  - `[Timer]`
  - `OnCalendar=`
  - `OnCalendar=*:0/1`
  - `AccuracySec=10s`
  - `RandomizedDelaySec=0`
  - `EOF`
  - `sudo systemctl daemon-reload`
  - `sudo systemctl restart openclaw-email-triage.timer`
  - `systemctl list-timers --all | grep openclaw-email-triage`

Calendar Auto-Book Verification (strict mode)
- Run a manual triage pass and inspect booking counters:
  - `sudo systemctl start openclaw-email-triage.service`
  - `sudo journalctl -u openclaw-email-triage.service -n 200 --no-pager | grep -E "triage.done|calendarBooked|calendarConflict|calendarParseFailed|calendarSkipped"`
- In strict mode, events only auto-create when explicit date/time/timezone + requester email + conflict-free slot are present.

Notes
- `systemctl` commands must run on the VM, not Cloud Shell itself.
  - Cloud Shell prompt looks like: `mcool4444@cloudshell:~`
  - VM prompt looks like: `mcool4444@ai-hell-mary-gateway:~`
  - If you see `System has not been booted with systemd as init system (PID 1)`, you ran commands in Cloud Shell instead of the VM.
- 404 on GET to webhook path is OK. Pub/Sub uses POST. 502 means the listener is down.
- Keep responses factual and non-committal on pricing unless confirmed.

Approval (2026-02-03)
- Base labels: approved by user.
- Optional labels: approved by user with mailbox placement noted above.
