---
name: folio-avatar-pipeline
description: Build and run the folio plus avatar outreach pipeline for qualified leads by generating scripts, producing HeyGen videos, and attaching approved video links to outbound drafts.
---

# Folio Avatar Pipeline

## Purpose
Use this skill when a lead should receive a personalized folio-style outreach asset or avatar video before human follow-up.

## Pipeline steps
1. Prepare outreach context from lead metadata, offer, and prior thread history.
2. Generate a concise outreach script (`/api/ai/script`) with business-specific voice.
3. Create avatar video (`/api/heygen/create-avatar`) and poll status (`/api/heygen/get-status`).
4. Store the resulting video URL in lead metadata and include it in a Gmail draft.
5. Route draft to approval queue before any send action.

## Inputs
- Lead identity fields (`name`, `company`, `role`, channel preference).
- Offer context (`businessKey`, CTA, booking/payment link).
- Avatar settings (`avatarId`, `voiceId`).
- Message safety controls (`idempotencyKey`, approval mode, DNC eligibility).

## Outputs
- One generated script and one avatar-video job id.
- Video URL when generation completes.
- Approval-ready draft that references the folio/video asset.

## Guardrails
- Never bypass approval for outbound send.
- Cap script length to short-form outreach (30-90 seconds spoken).
- Reuse existing video job if idempotency key already exists.
- Keep provider/API keys out of code and prompts.

## Verification
- API smoke: `POST /api/heygen/create-avatar` then `POST /api/heygen/get-status`.
- Confirm draft references the expected lead and video URL.
- Confirm KPI/reporting records include avatar-assisted outreach marker.

## Example prompts
- "Create a folio avatar draft for this high-intent lead and keep send disabled."
- "Check avatar video status and attach the URL to the pending Gmail draft."
- "List all leads waiting on avatar generation for the current campaign."

