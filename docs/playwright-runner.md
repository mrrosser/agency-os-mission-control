# Playwright Runner Guide

This project supports two Playwright paths:

1) **Global Python runner** at `C:\tools\playwright-runner` for ad-hoc browser ops across projects.
2) **Repo-local TS runner** for deterministic, CI-ready browser tests, snapshots, and parallel projects.

---

## 1) Global Python Runner (Ad-hoc Ops)

### Local Run

1) Bootstrap (once per machine):

```powershell
cd C:\tools\playwright-runner
./bootstrap.ps1 -WithDev
```

2) Run a playbook:

```powershell
pwrun --playbook C:\tools\playwright-runner\examples\smoke.yml --headed --slowmo 200 --trace
```

Artifacts and logs land in `artifacts/<run-id>` with JSONL logs at `run.jsonl`.

### Deployment

This runner is intended for **local execution only**. It is not deployed.

---

## 2) Repo-Local TS Runner (CI-Ready Tests)

### Install

```bash
npm run test:pw:install
```

### Local Run

```bash
npm run test:pw
```

Optional flags:
- `--headed` to watch the browser
- `--ui` for the Playwright UI: `npm run test:pw:ui`

### Base URL

If your app is running locally, set:

```bash
set PLAYWRIGHT_BASE_URL=http://localhost:3000
```

Then tests can use `page.goto('/')` and it resolves to the base URL.

### Parallel Browsers

Default is Chromium only. To run all browsers in parallel:

```bash
set PLAYWRIGHT_PROJECTS=all
npm run test:pw
```

### Artifacts

- HTML report: `playwright-report/`
- Traces/screenshots/videos under `test-results/`

### Snapshots

When you add snapshot tests:

```bash
npx playwright test --update-snapshots
```

### Deployment

Playwright tests are **not deployed**. They run locally or in CI.

If you want CI, add a workflow that:
1) Installs deps
2) Runs `npm run test:pw`
3) Uploads the HTML report as an artifact
