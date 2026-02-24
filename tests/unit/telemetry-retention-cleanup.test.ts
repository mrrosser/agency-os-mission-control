import { describe, expect, it, vi } from "vitest";
import cleanupModule from "../../scripts/telemetry-retention-cleanup.js";

const { parseConfig, cleanupTelemetryRetention } = cleanupModule as {
  parseConfig: (env: NodeJS.ProcessEnv) => {
    eventRetentionDays: number;
    groupRetentionDays: number;
    batchSize: number;
    maxDeletesPerCollection: number;
    dryRun: boolean;
  };
  cleanupTelemetryRetention: (
    db: unknown,
    config: {
      eventRetentionDays: number;
      groupRetentionDays: number;
      batchSize: number;
      maxDeletesPerCollection: number;
      dryRun: boolean;
    },
    log: (level: string, message: string, fields?: Record<string, unknown>) => void
  ) => Promise<{
    events: { deleted: number; batches: number; reachedDeleteCap: boolean };
    groups: { deleted: number; batches: number; reachedDeleteCap: boolean };
  }>;
};

type MockDoc = { ref: { id: string } };

function doc(id: string): MockDoc {
  return { ref: { id } };
}

function createMockDb(queues: Record<string, MockDoc[][]>) {
  const commits: string[][] = [];

  const db = {
    collection: vi.fn((name: string) => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => ({
            get: vi.fn(async () => {
              const next = queues[name]?.shift() || [];
              return {
                empty: next.length === 0,
                docs: next,
              };
            }),
          })),
        })),
      })),
    })),
    batch: vi.fn(() => {
      const pending: string[] = [];
      return {
        delete: vi.fn((ref: { id: string }) => {
          pending.push(ref.id);
        }),
        commit: vi.fn(async () => {
          commits.push([...pending]);
        }),
      };
    }),
  };

  return { db, commits };
}

describe("telemetry retention cleanup", () => {
  it("parses defaults and allows explicit config", () => {
    const defaults = parseConfig({});
    expect(defaults).toMatchObject({
      eventRetentionDays: 30,
      groupRetentionDays: 180,
      batchSize: 200,
      maxDeletesPerCollection: 5000,
      dryRun: false,
    });

    const explicit = parseConfig({
      TELEMETRY_EVENT_RETENTION_DAYS: "14",
      TELEMETRY_GROUP_RETENTION_DAYS: "45",
      TELEMETRY_CLEANUP_BATCH_SIZE: "50",
      TELEMETRY_CLEANUP_MAX_DELETES_PER_COLLECTION: "999",
      TELEMETRY_CLEANUP_DRY_RUN: "true",
    });
    expect(explicit).toMatchObject({
      eventRetentionDays: 14,
      groupRetentionDays: 45,
      batchSize: 50,
      maxDeletesPerCollection: 999,
      dryRun: true,
    });
  });

  it("rejects group retention shorter than event retention", () => {
    expect(() =>
      parseConfig({
        TELEMETRY_EVENT_RETENTION_DAYS: "30",
        TELEMETRY_GROUP_RETENTION_DAYS: "7",
      })
    ).toThrow("TELEMETRY_GROUP_RETENTION_DAYS must be >= TELEMETRY_EVENT_RETENTION_DAYS");
  });

  it("deletes docs in batches when dryRun is disabled", async () => {
    const { db, commits } = createMockDb({
      telemetry_error_events: [[doc("e1"), doc("e2")], []],
      telemetry_error_groups: [[doc("g1")], []],
    });
    const log = vi.fn();

    const result = await cleanupTelemetryRetention(
      db,
      {
        eventRetentionDays: 30,
        groupRetentionDays: 90,
        batchSize: 200,
        maxDeletesPerCollection: 5000,
        dryRun: false,
      },
      log
    );

    expect(result.events.deleted).toBe(2);
    expect(result.events.batches).toBe(1);
    expect(result.groups.deleted).toBe(1);
    expect(result.groups.batches).toBe(1);
    expect(commits).toEqual([["e1", "e2"], ["g1"]]);
    expect(log).toHaveBeenCalled();
  });

  it("does not commit deletes in dry-run mode", async () => {
    const { db, commits } = createMockDb({
      telemetry_error_events: [[doc("e1")], []],
      telemetry_error_groups: [[doc("g1"), doc("g2")], []],
    });

    const result = await cleanupTelemetryRetention(
      db,
      {
        eventRetentionDays: 30,
        groupRetentionDays: 90,
        batchSize: 200,
        maxDeletesPerCollection: 5000,
        dryRun: true,
      },
      () => undefined
    );

    expect(result.events.deleted).toBe(1);
    expect(result.groups.deleted).toBe(2);
    expect(commits).toHaveLength(0);
  });

  it("respects max delete cap per collection", async () => {
    const { db } = createMockDb({
      telemetry_error_events: [[doc("e1"), doc("e2")], [doc("e3")], []],
      telemetry_error_groups: [[]],
    });

    const result = await cleanupTelemetryRetention(
      db,
      {
        eventRetentionDays: 30,
        groupRetentionDays: 90,
        batchSize: 200,
        maxDeletesPerCollection: 2,
        dryRun: true,
      },
      () => undefined
    );

    expect(result.events.deleted).toBe(2);
    expect(result.events.reachedDeleteCap).toBe(true);
  });
});
