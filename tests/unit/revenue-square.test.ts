import { describe, expect, it } from "vitest";
import {
  classifySquareEventCategory,
  computeSquareWebhookSignature,
  extractSquareEventType,
  extractSquareLeadDocIdHint,
  extractSquareOfferCode,
  extractSquareUidHint,
  isSquareAllowlistedEventType,
  isSquareCompletedPaymentEvent,
  verifySquareWebhookSignature,
} from "@/lib/revenue/square";

describe("revenue square helpers", () => {
  it("computes and verifies webhook signatures", () => {
    const notificationUrl = "https://leadflow-review.web.app/api/webhooks/square";
    const rawBody = JSON.stringify({ event_id: "evt-1", type: "payment.updated" });
    const signatureKey = "square-signing-secret";

    const signature = computeSquareWebhookSignature({
      notificationUrl,
      rawBody,
      signatureKey,
    });

    expect(
      verifySquareWebhookSignature({
        notificationUrl,
        rawBody,
        signatureKey,
        providedSignature: signature,
      })
    ).toBe(true);

    expect(
      verifySquareWebhookSignature({
        notificationUrl,
        rawBody,
        signatureKey,
        providedSignature: "bad-signature",
      })
    ).toBe(false);
  });

  it("extracts offer code, uid, and lead hint from nested payload", () => {
    const payload = {
      type: "payment.updated",
      data: {
        object: {
          payment: {
            note: "offer=RNG-COMMISSION-SCULPTURE leadDocId=lead_12345 uid=user_1",
            status: "COMPLETED",
          },
        },
      },
      metadata: {
        offerCode: "rng-commission-sculpture",
        uid: "user_1",
      },
    };

    expect(extractSquareOfferCode(payload)).toBe("RNG-COMMISSION-SCULPTURE");
    expect(extractSquareUidHint(payload, null)).toBe("user_1");
    expect(extractSquareLeadDocIdHint(payload)).toBe("lead_12345");
  });

  it("detects completed payment events", () => {
    const completed = {
      type: "payment.updated",
      data: {
        object: {
          payment: {
            status: "COMPLETED",
          },
        },
      },
    };

    const ignored = {
      type: "payment.updated",
      data: {
        object: {
          payment: {
            status: "CANCELED",
          },
        },
      },
    };

    expect(isSquareCompletedPaymentEvent(completed)).toBe(true);
    expect(isSquareCompletedPaymentEvent(ignored)).toBe(false);
  });

  it("normalizes event type categories and allowlist checks", () => {
    const payload = {
      type: "invoice.updated",
    };
    expect(extractSquareEventType(payload)).toBe("INVOICE.UPDATED");
    expect(classifySquareEventCategory("invoice.updated")).toBe("invoice");
    expect(classifySquareEventCategory("refund.created")).toBe("refund");
    expect(classifySquareEventCategory("foo.bar")).toBe("other");
    expect(isSquareAllowlistedEventType("ORDER.UPDATED")).toBe(true);
    expect(isSquareAllowlistedEventType("TEAM_MEMBER.UPDATED")).toBe(false);
  });
});
