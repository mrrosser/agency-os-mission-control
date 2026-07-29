import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtureJson from "@/contracts/rosser-gallery/intake-lead.v1.json";
import {
  GET,
  POST,
} from "@/app/api/integrations/rosser-gallery/intake-leads/route";
import { ingestRosserGalleryIntakeLead } from "@/lib/crm/rosser-gallery-intake-ingest";
import { triggerIntakeNotificationWorker } from "@/lib/crm/rosser-gallery-intake-notification-trigger";

vi.mock("@/lib/crm/rosser-gallery-intake-ingest", () => ({
  ingestRosserGalleryIntakeLead: vi.fn(),
}));
vi.mock("@/lib/crm/rosser-gallery-intake-notification-trigger", () => ({
  triggerIntakeNotificationWorker: vi.fn(),
}));

const ingestMock = vi.mocked(ingestRosserGalleryIntakeLead);
const triggerMock = vi.mocked(triggerIntakeNotificationWorker);
const TOKEN = "ingest-token-with-at-least-thirty-two-characters";

function context() {
  return { params: Promise.resolve({}) };
}

function request(args?: {
  body?: Record<string, unknown>;
  token?: string;
  idempotencyKey?: string;
  correlationId?: string;
}) {
  const body =
    args?.body || (structuredClone(fixtureJson) as Record<string, unknown>);
  return new Request(
    "http://localhost/api/integrations/rosser-gallery/intake-leads",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${args?.token ?? TOKEN}`,
        "content-type": "application/json",
        "x-idempotency-key":
          args?.idempotencyKey ?? String(body.externalEventId || ""),
        "x-correlation-id": args?.correlationId ?? "intake-route-smoke-0001",
      },
      body: JSON.stringify(body),
    }
  );
}

async function invoke(requestValue: Request) {
  return POST(
    requestValue as unknown as Parameters<typeof POST>[0],
    context() as unknown as Parameters<typeof POST>[1]
  );
}

async function readiness(token = TOKEN) {
  const requestValue = new Request(
    "http://localhost/api/integrations/rosser-gallery/intake-leads",
    {
      headers: {
        authorization: `Bearer ${token}`,
        "x-correlation-id": "intake-ready-smoke-0001",
      },
    }
  );
  return GET(
    requestValue as unknown as Parameters<typeof GET>[0],
    context() as unknown as Parameters<typeof GET>[1]
  );
}

describe("generic Rosser Gallery intake receiver route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRM_INGEST_TOKEN", TOKEN);
    vi.stubEnv("ROSSER_GALLERY_CRM_OWNER_UID", "owner-uid");
    vi.stubEnv("ROSSER_GALLERY_CRM_WORKSPACE_ID", "workspace-id");
    vi.stubEnv("ROSSER_GALLERY_CRM_BUSINESS_UNIT", "rosser_nft_gallery");
    vi.stubEnv(
      "ROSSER_GALLERY_CRM_CUSTOMER_ID_HMAC_SECRET",
      "customer-id-secret-with-at-least-thirty-two-characters"
    );
    vi.stubEnv("PAPERCLIP_API_BASE_URL", "");
    vi.stubEnv("PAPERCLIP_SYSTEM_URL", "");
    vi.stubEnv("PAPERCLIP_MCP_SERVER_URL", "");
    vi.stubEnv("TELEMETRY_SERVER_ERRORS", "false");
    ingestMock.mockResolvedValue({
      replayed: false,
      latestApplied: true,
      receiptId: "intake-receipt-test",
      customerId: "intake-customer-test",
      timelineEventId: "intake-activity-test",
      notificationChannels: [
        {
          channel: "owner_alert",
          outboxId: "outbox-owner",
          receiptId: "receipt-owner",
          status: "queued",
        },
        {
          channel: "submitter_acknowledgment",
          outboxId: "outbox-thanks",
          receiptId: "receipt-thanks",
          status: "queued",
        },
      ],
      receivedAt: "2026-07-28T20:31:00.000Z",
      sourceOfTruth: "firestore_projected",
    });
    triggerMock.mockResolvedValue("triggered");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("advertises the exact authenticated contract without tenant or recipient data", async () => {
    const response = await readiness();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      receiver: "rosser-gallery-intake-leads",
      contractVersions: [1],
      supportedLanes: [
        "artist_call",
        "vendor_interest",
        "program_proposal",
        "gallery_support",
        "community_signup",
        "contact_message",
        "meeting_interest",
      ],
      supportedBusinessUnits: ["rosser_gallery", "rt_solutions"],
      supportedMeetingIntents: expect.arrayContaining([
        "public_gallery_visit",
        "private_gallery_walkthrough",
        "consulting_consultation",
        "purchase_guidance",
      ]),
      notificationMode: "outbox",
    });
    expect(ingestMock).not.toHaveBeenCalled();
    expect(triggerMock).not.toHaveBeenCalled();
    expect((await readiness("wrong-token")).status).toBe(403);
  });

  it("fails closed for auth, unknown fields, and mismatched idempotency", async () => {
    expect((await invoke(request({ token: "wrong-token" }))).status).toBe(403);

    const unknown = structuredClone(fixtureJson) as Record<string, unknown>;
    unknown.recipient = "attacker@example.com";
    expect((await invoke(request({ body: unknown }))).status).toBe(400);
    expect(
      (
        await invoke(
          request({ idempotencyKey: "intake_00000000-0000-4000-8000-000000000000" })
        )
      ).status
    ).toBe(400);
    expect(ingestMock).not.toHaveBeenCalled();
    expect(triggerMock).not.toHaveBeenCalled();
  });

  it("returns deterministic channel receipts and best-effort triggers delivery", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = await invoke(request());
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      ok: true,
      replayed: false,
      receiptId: "intake-receipt-test",
      customerId: "intake-customer-test",
      timelineEventId: "intake-activity-test",
      notificationChannels: [
        {
          channel: "owner_alert",
          outboxId: "outbox-owner",
          receiptId: "receipt-owner",
          status: "queued",
        },
        {
          channel: "submitter_acknowledgment",
          outboxId: "outbox-thanks",
          receiptId: "receipt-thanks",
          status: "queued",
        },
      ],
      correlationId: "intake-route-smoke-0001",
      receivedAt: "2026-07-28T20:31:00.000Z",
    });
    expect(ingestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        externalEventId: fixtureJson.externalEventId,
        lane: "meeting_interest",
      }),
      expect.objectContaining({
        notificationOwnerEmails: {
          rosser_gallery: "mrosser@rossergallery.com",
          rt_solutions: "mrosser@rossergallery.com",
        },
      }),
      { correlationId: "intake-route-smoke-0001" }
    );
    expect(triggerMock).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: "intake-route-smoke-0001" })
    );
    const logs = logSpy.mock.calls.flat().join(" ");
    expect(logs).not.toContain("community.member@example.com");
    expect(logs).not.toContain("Example Community Member");
    expect(logs).not.toContain(TOKEN);
  });

  it("keeps successful ingest independent when the immediate worker trigger fails", async () => {
    triggerMock.mockResolvedValueOnce("failed");
    const response = await invoke(request());
    expect(response.status).toBe(201);
    expect(ingestMock).toHaveBeenCalledOnce();
    expect(triggerMock).toHaveBeenCalledOnce();
  });
});
