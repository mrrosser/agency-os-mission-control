import { expect, test } from "@playwright/test";

test("operations mocked workflow: quota refresh + alert acknowledge", async ({ page }) => {
  let quotaRequests = 0;
  let alertsListRequests = 0;
  const acknowledgePayloads: Array<{ action?: string; alertId?: string }> = [];

  await page.route("**/api/lead-runs/quota", async (route) => {
    quotaRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        quota: {
          orgId: "org-1",
          windowKey: "2026-02-12",
          runsUsed: 12,
          leadsUsed: 320,
          maxRunsPerDay: 80,
          maxLeadsPerDay: 1200,
          runsRemaining: 68,
          leadsRemaining: 880,
          utilization: {
            runsPct: 15,
            leadsPct: 27,
          },
        },
      }),
    });
  });

  await page.route("**/api/lead-runs/alerts*", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const payload = request.postDataJSON() as { action?: string; alertId?: string };
      acknowledgePayloads.push(payload);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
      return;
    }

    alertsListRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        alerts: [
          {
            alertId: "org-1_run-1",
            runId: "run-1",
            severity: "error",
            title: "Lead run failures exceeded threshold",
            message: "One or more lead runs failed repeatedly.",
            failureStreak: 3,
            status: "open",
          },
        ],
      }),
    });
  });

  await page.setContent(`
    <button id="refreshQuota">Refresh Quota</button>
    <button id="refreshAlerts">Refresh Alerts</button>
    <div id="quota">Quota not loaded</div>
    <div id="alerts">No active alerts</div>
    <script>
      const quotaEl = document.getElementById("quota");
      const alertsEl = document.getElementById("alerts");
      let alerts = [];

      const API_BASE = "https://example.test";

      async function loadQuota() {
        const res = await fetch(API_BASE + "/api/lead-runs/quota");
        const data = await res.json();
        quotaEl.textContent =
          "Runs: " +
          data.quota.runsUsed +
          "/" +
          data.quota.maxRunsPerDay +
          " | Leads: " +
          data.quota.leadsUsed +
          "/" +
          data.quota.maxLeadsPerDay;
      }

      function renderAlerts() {
        if (!alerts.length) {
          alertsEl.textContent = "No active alerts";
          return;
        }
        alertsEl.innerHTML = "";
        alerts.forEach((alert) => {
          const row = document.createElement("div");
          row.setAttribute("data-alert-id", alert.alertId);

          const title = document.createElement("span");
          title.textContent = alert.title + " (" + alert.status + ")";
          row.appendChild(title);

          if (alert.status !== "acked") {
            const button = document.createElement("button");
            button.textContent = "Acknowledge";
            button.addEventListener("click", async () => {
              await fetch(API_BASE + "/api/lead-runs/alerts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "acknowledge",
                  alertId: alert.alertId,
                }),
              });
              alerts = alerts.map((item) =>
                item.alertId === alert.alertId ? { ...item, status: "acked" } : item
              );
              renderAlerts();
            });
            row.appendChild(button);
          }

          alertsEl.appendChild(row);
        });
      }

      async function loadAlerts() {
        const res = await fetch(API_BASE + "/api/lead-runs/alerts?limit=10");
        const data = await res.json();
        alerts = Array.isArray(data.alerts) ? data.alerts : [];
        renderAlerts();
      }

      document.getElementById("refreshQuota").addEventListener("click", loadQuota);
      document.getElementById("refreshAlerts").addEventListener("click", loadAlerts);
    </script>
  `);

  await page.click("#refreshQuota");
  await expect(page.locator("#quota")).toContainText("Runs: 12/80 | Leads: 320/1200");

  await page.click("#refreshAlerts");
  await expect(page.locator('[data-alert-id="org-1_run-1"]')).toContainText("Lead run failures exceeded threshold (open)");
  await page.click('[data-alert-id="org-1_run-1"] button');
  await expect(page.locator('[data-alert-id="org-1_run-1"]')).toContainText("Lead run failures exceeded threshold (acked)");
  await expect(page.locator('[data-alert-id="org-1_run-1"] button')).toHaveCount(0);

  expect(quotaRequests).toBe(1);
  expect(alertsListRequests).toBe(1);
  expect(acknowledgePayloads).toEqual([
    {
      action: "acknowledge",
      alertId: "org-1_run-1",
    },
  ]);
});
