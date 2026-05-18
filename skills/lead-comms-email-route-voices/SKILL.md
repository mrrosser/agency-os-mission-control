---
name: lead-comms-email-route-voices
description: Route-specific style modules for mission-control email routing. Use when RT Solutions, Rosser NFT Gallery, or AI CoFoundry voice rules should load from references instead of living in one large prompt blob.
---

# Lead Comms Email Route Voices

## When to use
- The business route is already known.
- The draft needs route-specific priorities and tone.

## Workflow
1. Load the route-specific reference file for the active route.
2. Apply only the priorities that match that route.
3. Keep unrelated business language out of the reply.

## Verification
- [ ] Route-specific reference file was loaded.
- [ ] Unrelated business language was not introduced.
- [ ] The next step matches the active route.

## Example prompts
- "Load lead-comms-email-route-voices for rt_solutions and draft the reply."
- "Use lead-comms-email-route-voices with the ai_cofoundry overlay."

## References
- `references/routes/rt_solutions.md`
- `references/routes/rosser_nft_gallery.md`
- `references/routes/ai_cofoundry.md`
