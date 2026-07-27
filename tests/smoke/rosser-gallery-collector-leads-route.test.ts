import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtureJson from "@/contracts/rosser-gallery/collector-lead.v1.json";
import {
  GET,
  POST,
} from "@/app/api/integrations/rosser-gallery/collector-leads/route";
import { ingestRosserGalleryCollectorLead } from "@/lib/crm/rosser-gallery-collector-ingest";

vi.mock("@/lib/crm/rosser-gallery-collector-ingest", () => ({
  ingestRosserGalleryCollectorLead: vi.fn(),
}));

const ingestMock = vi.mocked(ingestRosserGalleryCollectorLead);
const TOKEN = "ingest-token-with-at-least-thirty-two-characters";

function createContext() {
  return { params: Promise.resolve({}) };
}

function createRequest(options?: {
  body?: Record<string, unknown>;
  token?: string;
  idempotencyKey?: string;
  correlationId?: string;
}) {
  const body = options?.body || (structuredClone(fixtureJson) as Record<string, unknown>);
  const externalEventId = String(body.externalEventId || "");
  return new Request(
    "http://localhost/api/integrations/rosser-gallery/collector-leads",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options?.token ?? TOKEN}`,
        "x-idempotency-key": options?.idempotencyKey ?? externalEventId,
        "x-correlation-id": options?.correlationId ?? "rng-smoke-test-0001",
      },
      body: JSON.stringify(body),
    }
  );
}

async function invoke(request: Request) {
  return POST(
    request as unknown as Parameters<typeof POST>[0],
    createContext() as unknown as Parameters<typeof POST>[1]
  );
}

async function invokeReadiness(token: string = TOKEN) {
  return GET(
    new Request(
      "http://localhost/api/integrations/rosser-gallery/collector-leads",
      {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-correlation-id": "rng-readiness-test-0001",
        },
      }
    ) as unknown as Parameters<typeof GET>[0],
    createContext() as unknown as Parameters<typeof GET>[1]
  );
}

describe("Rosser Gallery collector-lead integration route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRM_INGEST_TOKEN", TOKEN);
    vi.stubEnv("ROSSER_GALLERY_CRM_OWNER_UID", "owner-uid");
    vi.stubEnv("ROSSER_GALLERY_CRM_WORKSPACE_ID", "rosser-gallery-workspace");
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
      receiptId: "rng_receipt_test",
      customerId: "rng_customer_test",
      timelineEventId: "rng_activity_test",
      receivedAt: "2026-07-25T16:00:00.000Z",
      sourceOfTruth: "firestore_projected",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("fails closed when server routing or secrets are missing", async () => {
    vi.stubEnv("CRM_INGEST_TOKEN", "");

    const response = await invoke(createRequest());
    expect(response.status).toBe(503);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("rejects an incorrect bearer token", async () => {
    const response = await invoke(createRequest({ token: "wrong-token" }));

    expect(response.status).toBe(403);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("provides an authenticated non-writing readiness check", async () => {
    const response = await invokeReadiness();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      receiver: "rosser-gallery-collector-leads-v1",
      campaignId: "the-braider-atlanta",
      correlationId: "rng-readiness-test-0001",
    });
    expect(ingestMock).not.toHaveBeenCalled();

    const denied = await invokeReadiness("wrong-token");
    expect(denied.status).toBe(403);
  });

  it("rejects oversized bodies before parsing or writing", async () => {
    const body = structuredClone(fixtureJson) as Record<string, unknown>;
    const collector = body.collector as Record<string, unknown>;
    collector.note = "x".repeat(40 * 1024);

    const response = await invoke(createRequest({ body }));

    expect(response.status).toBe(413);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("rejects unknown body fields and mismatched idempotency keys", async () => {
    const body = structuredClone(fixtureJson) as Record<string, unknown>;
    body.unapproved = "field";
    const unknownFieldResponse = await invoke(createRequest({ body }));
    expect(unknownFieldResponse.status).toBe(400);

    const mismatchResponse = await invoke(
      createRequest({ idempotencyKey: "rg_collector_different" })
    );
    expect(mismatchResponse.status).toBe(400);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("rejects an unsafe correlation header and returns a generated safe ID", async () => {
    const response = await invoke(
      createRequest({ correlationId: "unsafe correlation id" })
    );
    const body = (await response.json()) as { correlationId: string };

    expect(response.status).toBe(400);
    expect(body.correlationId).not.toBe("unsafe correlation id");
    expect(response.headers.get("x-correlation-id")).toBe(body.correlationId);
  });

  it("creates a lead with correlation metadata and redacted logs", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = await invoke(createRequest());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-correlation-id")).toBe("rng-smoke-test-0001");
    expect(body).toMatchObject({
      ok: true,
      replayed: false,
      correlationId: "rng-smoke-test-0001",
      receiptId: "rng_receipt_test",
    });
    expect(Object.keys(body).sort()).toEqual(
      [
        "correlationId",
        "customerId",
        "ok",
        "receiptId",
        "receivedAt",
        "replayed",
        "timelineEventId",
      ].sort()
    );
    expect(ingestMock).toHaveBeenCalledOnce();
    expect(ingestMock).toHaveBeenCalledWith(
      expect.objectContaining({ externalEventId: fixtureJson.externalEventId }),
      expect.objectContaining({ businessUnit: "rosser_nft_gallery" }),
      { correlationId: "rng-smoke-test-0001" }
    );

    const logged = logSpy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("collector@example.com");
    expect(logged).not.toContain("Example Collector");
    expect(logged).not.toContain("Atlanta, GA");
    expect(logged).not.toContain(TOKEN);
  });

  it("returns 200 for an idempotent replay", async () => {
    ingestMock.mockResolvedValueOnce({
      replayed: true,
      latestApplied: true,
      receiptId: "rng_receipt_test",
      customerId: "rng_customer_test",
      timelineEventId: "rng_activity_test",
      receivedAt: "2026-07-25T16:00:00.000Z",
      sourceOfTruth: "firestore_projected",
    });

    const response = await invoke(createRequest());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ replayed: true });
  });
});
