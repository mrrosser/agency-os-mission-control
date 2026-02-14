import { expect, test } from "@playwright/test";

test("operations mocked workflow: background run, receipts drawer, triage links", async ({ page }) => {
  const runId = "run-mocked-123";

  await page.route("**/api/leads/source", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        runId,
        leads: [
          {
            id: "lead-1",
            companyName: "Dutch Alley Artist's Co-op",
            founderName: "Alex",
            score: 69,
            source: "googlePlaces",
          },
        ],
      }),
    });
  });

  await page.route(`**/api/lead-runs/${runId}/jobs`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        job: {
          runId,
          status: "completed",
          nextIndex: 1,
          totalLeads: 1,
          diagnostics: {
            processedLeads: 1,
            emailsSent: 1,
            meetingsScheduled: 1,
          },
        },
      }),
    });
  });

  await page.route(`**/api/lead-runs/${runId}/receipts`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        run: {
          runId,
          total: 1,
        },
        leads: [
          {
            leadDocId: "googlePlaces-lead-1",
            id: "lead-1",
            companyName: "Dutch Alley Artist's Co-op",
            founderName: "Alex",
            score: 69,
            actions: [
              {
                actionId: "drive.folder",
                status: "complete",
                updatedAt: "2026-02-12T10:00:00Z",
                data: {
                  webViewLink: "https://drive.google.com/drive/folders/test-folder",
                },
              },
            ],
          },
        ],
      }),
    });
  });

  await page.route(`**/api/telemetry/groups?runId=${runId}*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        groups: [
          {
            fingerprint: "fp-1",
            count: 3,
            sample: { message: "Could not load inbox" },
            triage: {
              status: "issued",
              issueNumber: 77,
              issueUrl: "https://github.com/example/repo/issues/77",
            },
          },
        ],
      }),
    });
  });

  await page.setContent(`
    <button id="run">Run In Background</button>
    <div id="status">idle</div>
    <ul id="leads"></ul>
    <div id="drawer" hidden>
      <div id="drawer-company"></div>
      <a id="drawer-link" href="" target="_blank">open-link</a>
    </div>
    <a id="triage" href="" target="_blank"></a>
    <script>
      const leadsEl = document.getElementById("leads");
      const statusEl = document.getElementById("status");
      const drawer = document.getElementById("drawer");
      const drawerCompany = document.getElementById("drawer-company");
      const drawerLink = document.getElementById("drawer-link");
      const triage = document.getElementById("triage");
      const API_BASE = "https://example.test";
      let leads = [];

      function renderLeads() {
        leadsEl.innerHTML = "";
        leads.forEach((lead) => {
          const li = document.createElement("li");
          li.innerHTML = '<span>' + lead.companyName + '</span> <button data-id="' + lead.leadDocId + '">Details</button>';
          li.querySelector("button").addEventListener("click", () => {
            const action = (lead.actions || [])[0] || {};
            drawerCompany.textContent = lead.companyName;
            drawerLink.href = action.data?.webViewLink || "#";
            drawer.hidden = false;
          });
          leadsEl.appendChild(li);
        });
      }

      document.getElementById("run").addEventListener("click", async () => {
        statusEl.textContent = "running";
        const source = await fetch(API_BASE + "/api/leads/source", { method: "POST" }).then(r => r.json());
        const job = await fetch(API_BASE + '/api/lead-runs/' + source.runId + '/jobs', { method: "POST" }).then(r => r.json());
        const receipts = await fetch(API_BASE + '/api/lead-runs/' + source.runId + '/receipts').then(r => r.json());
        const groups = await fetch(API_BASE + '/api/telemetry/groups?runId=' + source.runId + '&limit=6').then(r => r.json());
        leads = receipts.leads || [];
        renderLeads();
        triage.textContent = "Issue #" + (groups.groups[0].triage.issueNumber || "?");
        triage.href = groups.groups[0].triage.issueUrl;
        statusEl.textContent = job.job.status;
      });
    </script>
  `);

  await page.click("#run");
  await expect(page.locator("#status")).toHaveText("completed");
  await expect(page.locator("#leads")).toContainText("Dutch Alley Artist's Co-op");
  await page.click('button[data-id="googlePlaces-lead-1"]');
  await expect(page.locator("#drawer")).toBeVisible();
  await expect(page.locator("#drawer-company")).toHaveText("Dutch Alley Artist's Co-op");
  await expect(page.locator("#drawer-link")).toHaveAttribute("href", /drive\.google\.com/);
  await expect(page.locator("#triage")).toHaveAttribute("href", /github\.com\/example\/repo\/issues\/77/);
});
