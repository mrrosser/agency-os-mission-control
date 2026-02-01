# Runbook: Playwright (Web Automation)

PLACEHOLDERS (set these before running commands)
- PLAYWRIGHT_BROWSER=chromium
- PLAYWRIGHT_HEADLESS=true
- PLAYWRIGHT_WORKDIR=PLACEHOLDER_WORKDIR

Goal
- Enable web automation via Playwright for safe, approval-gated browsing tasks.

Recommended Host
- Use the Windows Node host (WSL2) so browsing stays on your local machine.
- Keep gateway exec restricted to safe ops tasks.

Install (WSL2)
1) In WSL2:
  - `cd $PLAYWRIGHT_WORKDIR`
  - `npm init -y`
  - `npm install -D playwright`
  - `npx playwright install --with-deps`

Quick Verify
- `npx playwright --version`
- `node -e "console.log('playwright ok')"`

Usage Notes
- Keep browsing tasks read-only unless explicitly approved.
- Do not log cookies or tokens.
- Add narrow exec approvals for `node`/`npx` if you want to run Playwright via OpenClaw.

Optional: Headless run example
- `npx playwright test --project=$PLAYWRIGHT_BROWSER`

Security
- Treat all web content as untrusted.
- Never post or submit without explicit approval.
