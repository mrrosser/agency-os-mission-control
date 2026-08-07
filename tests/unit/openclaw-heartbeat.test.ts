import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getAdminDbMock, verifyIdTokenMock } = vi.hoisted(() => ({
  getAdminDbMock: vi.fn(),
  verifyIdTokenMock: vi.fn(),
}));

vi.mock("@/lib/firebase-admin", () => ({
  getAdminDb: getAdminDbMock,
}));

vi.mock("google-auth-library", () => ({
  OAuth2Client: class {
    verifyIdToken = verifyIdTokenMock;
  },
}));

import {
  authorizeOpenClawHeartbeat,
  deriveOpenClawHeartbeatStatus,
  recordOpenClawHeartbeat,
  type OpenClawHeartbeatEnvelope,
} from "@/lib/agents/openclaw-heartbeat";

const ENV_NAMES = [
  "OPENCLAW_HEARTBEAT_OIDC_AUDIENCES",
  "OPENCLAW_HEARTBEAT_OIDC_SERVICE_ACCOUNT_EMAILS",
  "OPENCLAW_HEARTBEAT_RUNTIME_ID",
  "OPENCLAW_HEARTBEAT_MAX_SENT_AGE_SECONDS",
  "OPENCLAW_HEARTBEAT_MAX_FUTURE_SKEW_SECONDS",
  "OPENCLAW_HEARTBEAT_STALE_AFTER_SECONDS",
] as const;

function makeEnvelope(overrides: Partial<OpenClawHeartbeatEnvelope> = {}): OpenClawHeartbeatEnvelope {
  const nowMs = Date.parse("2026-08-07T16:00:00.000Z");
  return {
    schema_version: 1,
    runtime_id: "openclaw-gateway",
    heartbeat_id: "openclaw-gateway:boot-a:1786118400000",
    sequence: nowMs,
    sent_at: new Date(nowMs).toISOString(),
    source_commit: "a".repeat(40),
    correlation_id: "heartbeat-test-20260807",
    services: {
      openclaw_gateway: "active",
      voice_mcp_rt: "active",
      voice_mcp_rosser: "active",
      voice_mcp_router: "active",
    },
    ...overrides,
  };
}

describe("OpenClaw authenticated heartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENCLAW_HEARTBEAT_OIDC_AUDIENCES = "https://agency.example";
    process.env.OPENCLAW_HEARTBEAT_OIDC_SERVICE_ACCOUNT_EMAILS =
      "openclaw-gateway@example.iam.gserviceaccount.com";
    process.env.OPENCLAW_HEARTBEAT_RUNTIME_ID = "openclaw-gateway";
  });

  afterEach(() => {
    for (const name of ENV_NAMES) delete process.env[name];
  });

  it("fails closed when OIDC configuration is absent", async () => {
    delete process.env.OPENCLAW_HEARTBEAT_OIDC_AUDIENCES;
    delete process.env.OPENCLAW_HEARTBEAT_OIDC_SERVICE_ACCOUNT_EMAILS;

    await expect(
      authorizeOpenClawHeartbeat(
        new Request("https://agency.example/api/agents/openclaw-heartbeat", {
          headers: { Authorization: "Bearer ignored" },
        })
      )
    ).rejects.toMatchObject({ status: 503 });
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
  });

  it("fails closed when the configured OIDC audience is not an exact HTTPS origin", async () => {
    process.env.OPENCLAW_HEARTBEAT_OIDC_AUDIENCES =
      "https://agency.example/api/agents/openclaw-heartbeat";

    await expect(
      authorizeOpenClawHeartbeat(
        new Request("https://agency.example/api/agents/openclaw-heartbeat", {
          headers: { Authorization: "Bearer ignored" },
        })
      )
    ).rejects.toMatchObject({ status: 503 });
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
  });

  it("accepts only a verified allowlisted Google service account", async () => {
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        iss: "https://accounts.google.com",
        sub: "service-account-subject",
        email: "openclaw-gateway@example.iam.gserviceaccount.com",
        email_verified: true,
      }),
    });

    const identity = await authorizeOpenClawHeartbeat(
      new Request("https://agency.example/api/agents/openclaw-heartbeat", {
        headers: { Authorization: "Bearer google-oidc-token" },
      })
    );

    expect(identity).toEqual({
      email: "openclaw-gateway@example.iam.gserviceaccount.com",
      subject: "service-account-subject",
    });
    expect(verifyIdTokenMock).toHaveBeenCalledWith({
      idToken: "google-oidc-token",
      audience: ["https://agency.example"],
    });
  });

  it("rejects a valid Google identity outside the publisher allowlist", async () => {
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({
        iss: "accounts.google.com",
        sub: "other-subject",
        email: "other@example.iam.gserviceaccount.com",
        email_verified: true,
      }),
    });

    await expect(
      authorizeOpenClawHeartbeat(
        new Request("https://agency.example/api/agents/openclaw-heartbeat", {
          headers: { Authorization: "Bearer google-oidc-token" },
        })
      )
    ).rejects.toMatchObject({ status: 403 });
  });

  it("uses server receivedAt, not caller sentAt, as the freshness clock", () => {
    const status = deriveOpenClawHeartbeatStatus(
      {
        receivedAt: "2026-08-07T16:00:00.000Z",
        sentAt: "2030-01-01T00:00:00.000Z",
        sourceCommit: "b".repeat(40),
        services: makeEnvelope().services,
      },
      { nowMs: Date.parse("2026-08-07T16:05:00.000Z"), staleAfterSeconds: 900 }
    );

    expect(status.state).toBe("operational");
    expect(status.ageSeconds).toBe(300);
    expect(status.sentAt).toBe("2030-01-01T00:00:00.000Z");
  });

  it("fails closed for missing or invalid receipts and degrades stale receipts", () => {
    expect(deriveOpenClawHeartbeatStatus(null).state).toBe("offline");
    expect(deriveOpenClawHeartbeatStatus({ sentAt: "2026-08-07T16:00:00.000Z" }).state).toBe(
      "offline"
    );

    const stale = deriveOpenClawHeartbeatStatus(
      {
        receivedAt: "2026-08-07T15:30:00.000Z",
        sentAt: "2026-08-07T15:30:00.000Z",
        sourceCommit: "c".repeat(40),
        services: makeEnvelope().services,
      },
      { nowMs: Date.parse("2026-08-07T16:00:00.000Z"), staleAfterSeconds: 900 }
    );
    expect(stale).toEqual(expect.objectContaining({ state: "degraded", reason: "stale" }));
  });

  it("degrades a fresh receipt when any critical runtime unit is not active", () => {
    const services = { ...makeEnvelope().services, voice_mcp_router: "failed" as const };
    const status = deriveOpenClawHeartbeatStatus(
      {
        receivedAt: "2026-08-07T16:00:00.000Z",
        sentAt: "2026-08-07T16:00:00.000Z",
        sourceCommit: "d".repeat(40),
        services,
      },
      { nowMs: Date.parse("2026-08-07T16:01:00.000Z"), staleAfterSeconds: 900 }
    );
    expect(status).toEqual(
      expect.objectContaining({ state: "degraded", reason: "service_unhealthy" })
    );
  });

  it("records a new receipt with a server timestamp and idempotently ignores replay", async () => {
    const transactionSet = vi.fn();
    const transactionGet = vi
      .fn()
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ heartbeatId: makeEnvelope().heartbeat_id, sequence: makeEnvelope().sequence }),
      });
    const db = {
      collection: vi.fn(() => ({ doc: vi.fn(() => ({ path: "runtime_heartbeats/openclaw-gateway" })) })),
      runTransaction: vi.fn(async (callback: (transaction: unknown) => Promise<void>) =>
        callback({ get: transactionGet, set: transactionSet })
      ),
    };
    getAdminDbMock.mockReturnValue(db);

    const first = await recordOpenClawHeartbeat({
      envelope: makeEnvelope(),
      identity: {
        email: "openclaw-gateway@example.iam.gserviceaccount.com",
        subject: "service-account-subject",
      },
      requestCorrelationId: "request-correlation-1",
      nowMs: makeEnvelope().sequence,
    });
    const second = await recordOpenClawHeartbeat({
      envelope: makeEnvelope(),
      identity: {
        email: "openclaw-gateway@example.iam.gserviceaccount.com",
        subject: "service-account-subject",
      },
      requestCorrelationId: "request-correlation-2",
      nowMs: makeEnvelope().sequence,
    });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(transactionSet).toHaveBeenCalledOnce();
    expect(transactionSet.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        heartbeatId: makeEnvelope().heartbeat_id,
        requestCorrelationId: "request-correlation-1",
        receivedAt: expect.anything(),
      })
    );
  });

  it("rejects an older sequence without refreshing the authoritative receipt", async () => {
    const transactionSet = vi.fn();
    const envelope = makeEnvelope();
    const db = {
      collection: vi.fn(() => ({ doc: vi.fn(() => ({ path: "runtime_heartbeats/openclaw-gateway" })) })),
      runTransaction: vi.fn(async (callback: (transaction: unknown) => Promise<void>) =>
        callback({
          get: vi.fn(async () => ({
            exists: true,
            data: () => ({ heartbeatId: "different-heartbeat", sequence: envelope.sequence + 1 }),
          })),
          set: transactionSet,
        })
      ),
    };
    getAdminDbMock.mockReturnValue(db);

    await expect(
      recordOpenClawHeartbeat({
        envelope,
        identity: {
          email: "openclaw-gateway@example.iam.gserviceaccount.com",
          subject: "service-account-subject",
        },
        requestCorrelationId: "request-correlation-3",
        nowMs: envelope.sequence,
      })
    ).rejects.toMatchObject({ status: 409 });
    expect(transactionSet).not.toHaveBeenCalled();
  });
});
