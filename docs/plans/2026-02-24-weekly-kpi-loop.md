# Weekly KPI Loop (Dual Business)

Date: 2026-02-24  
Cadence: Every Monday 9:00 AM local business time  
Owner: Marcus (operator) + Mission Control dashboard

## KPI Board (weekly)

- New leads sourced
- Qualified leads (score threshold met)
- Outreach drafted
- Outreach approved/sent
- Meetings booked
- Deposits collected
- Deals won
- Avg deal value
- Lead -> deposit cycle time (days)
- No-response rate

## Segment by

- Business unit (`rosser_gallery`, `rt_solutions`)
- Offer code
- Channel (`google_maps`, `social`, `referral`, `walk_in`, `email`, `events`)

## Decision Rules

- Scale rule: if offer close rate >= 20% and cycle time <= 14 days for 2 consecutive weeks, increase sourcing/outreach volume.
- Fix rule: if meeting rate >= 15% but deposit rate < 25%, improve pricing clarity and proposal flow.
- Kill rule: if close rate < 5% for 3 consecutive weeks with >= 30 leads, pause that offer/channel pair.

## Weekly Ritual (45 minutes)

1. Review KPI board by business and offer.
2. Pick top 2 offers to scale and bottom 2 to fix/kill.
3. Lock one copy/test change per weak stage (source, outreach, booking, proposal).
4. Assign owners and due dates.
5. Publish one-page weekly summary.

## Deterministic Decision Log Output

- Weekly worker now writes a machine-readable decision log to:
  - `identities/{uid}/revenue_kpi_decisions/{weekStartDate}`
  - `identities/{uid}/revenue_kpi_decisions/latest`
- Decision actions are deterministic per `offerCode`:
  - `scale`: close rate >= 20% and cycle <= 14 days for 2+ consecutive weeks.
  - `fix`: meeting rate >= 15% and deposit-from-meeting rate < 25%.
  - `kill`: close rate < 5% for 3 consecutive weeks with >= 30 leads/week.
  - `watch`: no threshold reached.

## Data Discipline

- Use one pipeline ledger schema for both businesses.
- Do not change stage names mid-week.
- Every booked meeting and deposit must map to `offer_code`.
- Any manual deal updates require a note with date, owner, and reason.
