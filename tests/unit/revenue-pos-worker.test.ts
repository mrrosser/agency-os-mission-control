import { afterEach, describe, expect, it } from "vitest";
import {
  buildPosWorkerActionPlan,
  readPosWorkerPolicy,
  summarizePosWorkerHealth,
} from "@/lib/revenue/pos-worker";

const ORIGINAL_ENV = { ...process.env };

describe("revenue pos worker helpers", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("builds deterministic action plans per Square event type", () => {
    const paymentPlan = buildPosWorkerActionPlan("payment.updated");
    const invoicePlan = buildPosWorkerActionPlan("invoice.updated");
    const refundPlan = buildPosWorkerActionPlan("refund.created");

    expect(paymentPlan.map((step) => step.kind)).toEqual(["payment.lifecycle.track"]);
    expect(invoicePlan.some((step) => step.kind === "invoice.followup.queue")).toBe(true);
    expect(invoicePlan.some((step) => step.requiresSideEffect)).toBe(true);
    expect(refundPlan.some((step) => step.kind === "refund.review.queue")).toBe(true);
    expect(refundPlan.find((step) => step.kind === "refund.review.queue")?.risk).toBe("high");
  });

  it("reads policy flags with safe defaults", () => {
    delete process.env.POS_WORKER_ALLOW_SIDE_EFFECTS;
    delete process.env.POS_WORKER_AUTO_APPROVE_LOW_RISK;
    delete process.env.POS_WORKER_REQUIRE_APPROVAL_FOR_HIGH_RISK;

    const defaults = readPosWorkerPolicy();
    expect(defaults.allowSideEffects).toBe(false);
    expect(defaults.autoApproveLowRisk).toBe(true);
    expect(defaults.requireApprovalForHighRisk).toBe(true);

    process.env.POS_WORKER_ALLOW_SIDE_EFFECTS = "true";
    process.env.POS_WORKER_AUTO_APPROVE_LOW_RISK = "false";
    process.env.POS_WORKER_REQUIRE_APPROVAL_FOR_HIGH_RISK = "false";
    const overridden = readPosWorkerPolicy();
    expect(overridden.allowSideEffects).toBe(true);
    expect(overridden.autoApproveLowRisk).toBe(false);
    expect(overridden.requireApprovalForHighRisk).toBe(false);
  });

  it("computes worker health from recency and queue pressure", () => {
    const nowIso = new Date().toISOString();
    const operational = summarizePosWorkerHealth({
      lastWebhookAt: nowIso,
      blockedEvents: 0,
      deadLetterEvents: 0,
      oldestPendingSeconds: 60,
    });
    expect(operational).toBe("operational");

    const degraded = summarizePosWorkerHealth({
      lastWebhookAt: nowIso,
      blockedEvents: 1,
      deadLetterEvents: 0,
      oldestPendingSeconds: 60,
    });
    expect(degraded).toBe("degraded");

    const staleDate = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
    const offline = summarizePosWorkerHealth({
      lastWebhookAt: staleDate,
      blockedEvents: 0,
      deadLetterEvents: 0,
      oldestPendingSeconds: 0,
    });
    expect(offline).toBe("offline");
  });
});
