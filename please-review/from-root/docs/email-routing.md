# Email Routing + Labels (Draft-First)

Purpose
- Provide a consistent routing/label strategy across the three inboxes.
- Keep outbound messages in draft-only mode until explicit approval.

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
2) Agent drafts response (no send) and posts draft to Google Chat Outreach space.
3) User approves (or edits) -> then send.

Notes
- 404 on GET to webhook path is OK. Pub/Sub uses POST. 502 means the listener is down.
- Keep responses factual and non-committal on pricing unless confirmed.

Approval (2026-02-03)
- Base labels: approved by user.
- Optional labels: approved by user with mailbox placement noted above.
