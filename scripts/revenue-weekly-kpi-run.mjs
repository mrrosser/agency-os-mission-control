const baseUrl = (process.env.KPI_BASE_URL || process.env.SMOKE_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const workerToken = String(process.env.REVENUE_WEEKLY_KPI_WORKER_TOKEN || "").trim();
const uid = String(process.env.REVENUE_WEEKLY_KPI_UID || "").trim();
const timeZone = String(process.env.REVENUE_KPI_TIMEZONE || "America/Chicago").trim();
const weekStartDate = String(process.env.REVENUE_KPI_WEEK_START_DATE || "").trim();

if (!workerToken) {
  console.error("Missing REVENUE_WEEKLY_KPI_WORKER_TOKEN");
  process.exit(1);
}
if (!uid) {
  console.error("Missing REVENUE_WEEKLY_KPI_UID");
  process.exit(1);
}

const payload = {
  uid,
  timeZone,
  ...(weekStartDate ? { weekStartDate } : {}),
};

const response = await fetch(`${baseUrl}/api/revenue/kpi/weekly/worker-task`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${workerToken}`,
  },
  body: JSON.stringify(payload),
});

const bodyText = await response.text();
let body;
try {
  body = bodyText ? JSON.parse(bodyText) : {};
} catch {
  body = { raw: bodyText };
}

if (!response.ok) {
  console.error("Weekly KPI run failed", {
    status: response.status,
    body,
  });
  process.exit(1);
}

console.log("Weekly KPI run complete", {
  status: response.status,
  weekStartDate: body?.report?.weekStartDate,
  leadsSourced: body?.report?.summary?.leadsSourced,
  depositsCollected: body?.report?.summary?.depositsCollected,
  dealsWon: body?.report?.summary?.dealsWon,
});
