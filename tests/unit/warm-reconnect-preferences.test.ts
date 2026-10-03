import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import {
  digestWarmReconnectToken,
  globallyUnsubscribeWarmReconnectCapability,
  issueWarmReconnectPreferenceCapabilities,
  processWarmReconnectPreferenceMutation,
} from "@/lib/crm/warm-reconnect-preferences";
import { warmReconnectEmailKey } from "@/lib/crm/warm-reconnect-dedupe";

type Stored = Record<string, unknown>;

function fakeDb(seed: Record<string, Stored> = {}) {
  const records = new Map(Object.entries(seed));
  const writes: Array<{ operation: string; path: string; data: Stored }> = [];

  function mergeFields(existing: Stored, incoming: Stored): Stored {
    const merged = { ...existing };
    for (const [key, value] of Object.entries(incoming)) {
      const previous = merged[key];
      const isMap = (entry: unknown): entry is Stored => Boolean(
        entry && typeof entry === "object" && Object.getPrototypeOf(entry) === Object.prototype
      );
      merged[key] = isMap(previous) && isMap(value) && Object.keys(value).length > 0
        ? mergeFields(previous, value)
        : value;
    }
    return merged;
  }

  function snapshot(path: string) {
    const value = records.get(path);
    return {
      id: path.split("/").at(-1),
      exists: Boolean(value),
      data: () => value,
    };
  }

  function ref(path: string): Record<string, unknown> {
    return {
      path,
      id: path.split("/").at(-1),
      get: async () => snapshot(path),
      collection: (name: string) => collection(`${path}/${name}`),
    };
  }

  function collection(path: string): Record<string, unknown> {
    return { path, doc: (id: string) => ref(`${path}/${id}`) };
  }

  const transaction = {
    get: async (reference: { path: string }) => snapshot(reference.path),
    create: (reference: { path: string }, data: Stored) => {
      if (records.has(reference.path)) throw new Error("already exists");
      records.set(reference.path, data);
      writes.push({ operation: "create", path: reference.path, data });
    },
    set: (
      reference: { path: string },
      data: Stored,
      options?: { merge?: boolean }
    ) => {
      const next = options?.merge ? mergeFields(records.get(reference.path) || {}, data) : data;
      records.set(reference.path, next);
      writes.push({ operation: "set", path: reference.path, data });
    },
  };

  const db = {
    collection,
    runTransaction: async (callback: (value: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  } as unknown as Firestore;
  return { db, records, writes };
}

const preferenceToken = "p".repeat(43);
const unsubscribeToken = "u".repeat(43);
const workspaceId = "workspace_default_owner-1";
const personId = "person-1";
const contactPointId = "contact-1";
const legacyDncOrgId = "lead-run-org-1";
const pilotId = "pilot-1";
const recipientId = "pilot-recipient-1";
const recipientDecisionId = "recipient-decision-1";
const campaignApprovalId = "campaign-approval-1";
const audienceFingerprint = `sha256:${"a".repeat(64)}`;
const artifactFingerprint = `sha256:${"b".repeat(64)}`;
const actionFingerprint = `sha256:${"c".repeat(64)}`;

function tokenDocument(
  scope: "preferences" | "unsubscribe_only",
  capabilityExpiresAtMs = Date.parse("2026-11-10T00:00:00.000Z")
) {
  return {
    schemaVersion: 1,
    scope,
    workspaceId,
    personId,
    contactPointId,
    emailKey: warmReconnectEmailKey(workspaceId, "example@example.com"),
    legacyDncOrgId,
    pilotId,
    recipientId,
    recipientDecisionId,
    campaignApprovalId,
    audienceFingerprint,
    artifactFingerprint,
    actionFingerprint,
    capabilityExpiresAtMs,
  };
}

function pilotDocument(overrides: Record<string, unknown> = {}) {
  return {
    pilotId,
    workspaceId,
    legacyDncOrgId,
    status: "launch_requested",
    launchRequestedAt: new Date(Date.now() - 60_000).toISOString(),
    fingerprints: { audienceFingerprint, artifactFingerprint, actionFingerprint },
    approval: {
      approvalId: campaignApprovalId,
      decision: "approved",
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      audienceFingerprint,
      artifactFingerprint,
      actionFingerprint,
    },
    recipients: [
      {
        recipientId,
        personId,
        contactPointId,
        emailKey: warmReconnectEmailKey(workspaceId, "example@example.com"),
        decision: {
          status: "eligible_one_time_reconnection",
          decisionId: recipientDecisionId,
          relationshipAttested: true,
        },
      },
    ],
    ...overrides,
  };
}

function issueInput(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId,
    personId,
    contactPointId,
    emailKey: warmReconnectEmailKey(workspaceId, "example@example.com"),
    legacyDncOrgId,
    pilotId,
    recipientId,
    recipientDecisionId,
    campaignApprovalId,
    audienceFingerprint,
    artifactFingerprint,
    actionFingerprint,
    capabilityExpiresAtMs: Date.now() + 90 * 24 * 60 * 60 * 1_000,
    ...overrides,
  };
}

function issuanceSeed(pilot = pilotDocument()) {
  return {
    [`crm_contact_points/${contactPointId}`]: contactDocument(),
    [`crm_warm_reconnect_pilots/${pilotId}`]: pilot,
  };
}

function contactDocument() {
  return {
    workspaceId,
    personId,
    type: "email",
    value: "Example@Example.com",
    normalizedValue: "example@example.com",
    defaultPermissionState: "unknown",
  };
}

function tokenPath(rawToken: string) {
  return `crm_preference_tokens/${digestWarmReconnectToken(rawToken)}`;
}

function preferenceStatePath() {
  const id = createHash("sha256").update(`preference:${workspaceId}:${contactPointId}`).digest("hex").slice(0, 40);
  return `crm_contact_preferences/${id}`;
}

describe("warm reconnect preference capabilities", () => {
  it("issues separate exact-recipient capabilities and stores only token digests", async () => {
    const first = `PREF_${"c".repeat(38)}`;
    const second = `UNSUB_${"d".repeat(37)}`;
    const queue = [first, second];
    const fake = fakeDb(issuanceSeed());

    const issued = await issueWarmReconnectPreferenceCapabilities(
      issueInput(),
      fake.db,
      () => queue.shift() || ""
    );

    expect(issued).toEqual({
      preferenceToken: first,
      unsubscribeOnlyToken: second,
      preferenceFragment: `/preferences#token=${first}`,
      oneClickPath: `/api/crm/warm-reconnect/unsubscribe/${second}`,
    });
    const serialized = JSON.stringify([...fake.records.entries()]);
    expect(serialized).not.toContain(first);
    expect(serialized).not.toContain(second);
    expect(fake.records.get(tokenPath(first))).toMatchObject({
      scope: "preferences",
      workspaceId,
      personId,
      contactPointId,
      legacyDncOrgId,
      pilotId,
      recipientId,
      recipientDecisionId,
      campaignApprovalId,
      actionFingerprint,
    });
    expect(fake.records.get(tokenPath(second))).toMatchObject({
      scope: "unsubscribe_only",
    });
  });

  it.each(["crmPersonId", "personRef"] as const)(
    "accepts the canonical contact owner alias %s when issuing capabilities",
    async (ownerField) => {
      const first = `PREF_${"a".repeat(38)}`;
      const second = `UNSUB_${"b".repeat(37)}`;
      const fake = fakeDb({
        ...issuanceSeed(),
        [`crm_contact_points/${contactPointId}`]: {
          ...contactDocument(),
          personId: undefined,
          [ownerField]: personId,
        },
      });
      const queue = [first, second];

      await expect(
        issueWarmReconnectPreferenceCapabilities(
          issueInput(),
          fake.db,
          () => queue.shift() || ""
        )
      ).resolves.toMatchObject({ preferenceToken: first, unsubscribeOnlyToken: second });
    }
  );

  it("fails closed instead of overwriting a colliding capability digest", async () => {
    const collision = `COLLIDE_${"z".repeat(35)}`;
    const other = `OTHER_${"y".repeat(37)}`;
    const fake = fakeDb({
      ...issuanceSeed(),
      [tokenPath(collision)]: tokenDocument("preferences"),
    });
    const queue = [collision, other];

    await expect(
      issueWarmReconnectPreferenceCapabilities(
        issueInput(),
        fake.db,
        () => queue.shift() || ""
      )
    ).rejects.toThrow(/collided/);
  });

  it("keeps recipient capability lifetime distinct from a 24-hour operator approval", async () => {
    const fake = fakeDb(issuanceSeed());
    await expect(
      issueWarmReconnectPreferenceCapabilities(
        issueInput({ capabilityExpiresAtMs: Date.now() + 23 * 60 * 60 * 1_000 }),
        fake.db
      )
    ).rejects.toThrow(/approved-pilot capability binding/);
  });

  it.each([
    ["stopped pilot", () => pilotDocument({ status: "stopped" })],
    [
      "expired approval",
      () =>
        pilotDocument({
          approval: {
            ...pilotDocument().approval,
            expiresAt: new Date(Date.now() - 60_000).toISOString(),
          },
        }),
    ],
    [
      "changed recipient decision",
      () =>
        pilotDocument({
          recipients: [
            {
              ...pilotDocument().recipients[0],
              decision: {
                ...pilotDocument().recipients[0]?.decision,
                decisionId: "different-decision",
              },
            },
          ],
        }),
    ],
    [
      "changed action fingerprint",
      () =>
        pilotDocument({
          fingerprints: {
            ...pilotDocument().fingerprints,
            actionFingerprint: `sha256:${"d".repeat(64)}`,
          },
        }),
    ],
  ])("rejects issuance for a %s", async (_label, buildPilot) => {
    const fake = fakeDb(issuanceSeed(buildPilot()));
    await expect(
      issueWarmReconnectPreferenceCapabilities(issueInput(), fake.db)
    ).rejects.toThrow(/launched pilot approval/);
    expect(
      [...fake.records.keys()].filter((path) => path.startsWith("crm_preference_tokens/"))
    ).toHaveLength(0);
  });

  it("saves affirmative topic choices append-only and is idempotent on replay", async () => {
    const fake = fakeDb({
      [tokenPath(preferenceToken)]: tokenDocument("preferences"),
      [`crm_contact_points/${contactPointId}`]: contactDocument(),
    });
    const mutation = {
      action: "save_preferences" as const,
      token: preferenceToken,
      requestId: "request-1",
      topics: {
        rosser_gallery: true,
        rt_solutions: false,
      },
    };

    const first = await processWarmReconnectPreferenceMutation(mutation, {
      db: fake.db,
      observedNowMs: Date.parse("2026-08-12T12:00:00.000Z"),
    });
    const firstWriteCount = fake.writes.length;
    const replay = await processWarmReconnectPreferenceMutation(mutation, {
      db: fake.db,
      observedNowMs: Date.parse("2026-08-12T12:00:01.000Z"),
    });

    expect(first).toMatchObject({ available: true, globallyUnsubscribed: false });
    expect(replay).toMatchObject({ available: true, globallyUnsubscribed: false });
    expect(fake.writes).toHaveLength(firstWriteCount);
    expect(
      [...fake.records.keys()].filter((path) => path.startsWith("crm_permission_events/"))
    ).toHaveLength(1);
    expect(fake.records.get(`crm_contact_points/${contactPointId}`)).toMatchObject({
      defaultPermissionState: "unknown",
    });
  });

  it("fails closed when one request id is replayed with different topic content", async () => {
    const fake = fakeDb({
      [tokenPath(preferenceToken)]: tokenDocument("preferences"),
      [`crm_contact_points/${contactPointId}`]: contactDocument(),
    });
    const first = {
      action: "save_preferences" as const,
      token: preferenceToken,
      requestId: "request-same",
      topics: {
        rosser_gallery: true,
        rt_solutions: false,
      },
    };
    await processWarmReconnectPreferenceMutation(first, { db: fake.db });
    const writeCount = fake.writes.length;
    const changed = await processWarmReconnectPreferenceMutation(
      {
        ...first,
        topics: {
          rosser_gallery: false,
          rt_solutions: true,
        },
      },
      { db: fake.db }
    );

    expect(changed).toMatchObject({ available: false, canUpdatePreferences: false });
    expect(fake.writes).toHaveLength(writeCount);
    expect(
      [...fake.records.keys()].filter((path) => path.startsWith("crm_permission_events/"))
    ).toHaveLength(1);
  });

  it("records each later RT to Gallery to RT choice as append-only chronology", async () => {
    const fake = fakeDb({
      [tokenPath(preferenceToken)]: tokenDocument("preferences"),
      [`crm_contact_points/${contactPointId}`]: contactDocument(),
    });
    const rtOnly = {
      rosser_gallery: false,
      rt_solutions: true,
    };
    const galleryOnly = {
      rosser_gallery: true,
      rt_solutions: false,
    };

    for (const [requestId, topics] of [
      ["request-rt-1", rtOnly],
      ["request-gallery", galleryOnly],
      ["request-rt-2", rtOnly],
    ] as const) {
      await processWarmReconnectPreferenceMutation(
        {
          action: "save_preferences",
          token: preferenceToken,
          requestId,
          topics,
        },
        {
          db: fake.db,
          observedNowMs: Date.parse("2026-08-12T12:00:00.000Z"),
        }
      );
    }

    const preferenceState = [...fake.records.values()].find(
      (record) => record.globallyUnsubscribed === false && record.topics
    );
    expect(preferenceState).toMatchObject({ topics: rtOnly });
    expect(
      [...fake.records.keys()].filter((path) => path.startsWith("crm_permission_events/"))
    ).toHaveLength(3);
  });

  it("never lets an expired token or sticky suppression create a new opt-in", async () => {
    const expired = fakeDb({
      [tokenPath(preferenceToken)]: tokenDocument(
        "preferences",
        Date.parse("2026-08-11T00:00:00.000Z")
      ),
      [`crm_contact_points/${contactPointId}`]: contactDocument(),
    });
    const mutation = {
      action: "save_preferences" as const,
      token: preferenceToken,
      requestId: "request-expired",
      topics: {
        rosser_gallery: true,
        rt_solutions: false,
      },
    };
    const result = await processWarmReconnectPreferenceMutation(mutation, {
      db: expired.db,
      observedNowMs: Date.parse("2026-08-12T00:00:00.000Z"),
    });
    expect(result).toMatchObject({ available: true, expired: true, canUpdatePreferences: false });
    expect(expired.records.get(`crm_contact_points/${contactPointId}`)).toMatchObject({
      defaultPermissionState: "unknown",
    });
    expect([...expired.records.keys()].some((path) => path.startsWith("crm_permission_events/"))).toBe(false);

    const inspectWrongScope = await processWarmReconnectPreferenceMutation(
      { action: "inspect", token: unsubscribeToken },
      {
        db: fakeDb({
          [tokenPath(unsubscribeToken)]: tokenDocument("unsubscribe_only"),
          [`crm_contact_points/${contactPointId}`]: contactDocument(),
        }).db,
      }
    );
    expect(inspectWrongScope.available).toBe(false);
  });

  it("atomically records a sticky global suppression, append-only event, and legacy DNC mirror", async () => {
    const fake = fakeDb({
      [tokenPath(unsubscribeToken)]: tokenDocument(
        "unsubscribe_only",
        Date.parse("2026-08-01T00:00:00.000Z")
      ),
      [`crm_contact_points/${contactPointId}`]: contactDocument(),
    });

    const first = await globallyUnsubscribeWarmReconnectCapability(unsubscribeToken, {
      requiredScope: "unsubscribe_only",
      db: fake.db,
      observedNowMs: Date.parse("2026-08-12T00:00:00.000Z"),
    });
    const firstWriteCount = fake.writes.length;
    const replay = await globallyUnsubscribeWarmReconnectCapability(unsubscribeToken, {
      requiredScope: "unsubscribe_only",
      db: fake.db,
      observedNowMs: Date.parse("2026-08-12T00:01:00.000Z"),
    });

    expect(first).toMatchObject({
      available: true,
      expired: true,
      globallyUnsubscribed: true,
    });
    expect(replay).toMatchObject({ globallyUnsubscribed: true });
    expect(fake.writes).toHaveLength(firstWriteCount);
    expect(
      [...fake.records.keys()].filter((path) => path.startsWith("crm_permission_events/"))
    ).toHaveLength(1);
    expect(
      [...fake.records.values()].find((record) => record.state === "suppressed")
    ).toMatchObject({ scope: "global", contactPointId });
    expect(
      [...fake.records.entries()].find(([path]) =>
        path.startsWith(`lead_run_org_dnc/${legacyDncOrgId}/entries/`)
      )?.[1]
    ).toMatchObject({
      type: "email",
      normalized: "example@example.com",
      createdBy: "recipient_preference_center",
    });
    expect(fake.records.get(`crm_contact_points/${contactPointId}`)).toMatchObject({
      defaultPermissionState: "opted_out",
    });
  });

  it("returns generic and writes nothing when a contact address drifts after issuance", async () => {
    const fake = fakeDb({
      [tokenPath(unsubscribeToken)]: tokenDocument("unsubscribe_only"),
      [`crm_contact_points/${contactPointId}`]: {
        ...contactDocument(),
        value: "replacement@example.com",
        normalizedValue: "replacement@example.com",
      },
    });
    const before = fake.writes.length;
    const result = await globallyUnsubscribeWarmReconnectCapability(unsubscribeToken, {
      requiredScope: "unsubscribe_only",
      db: fake.db,
    });
    expect(result).toMatchObject({ available: false, globallyUnsubscribed: false });
    expect(fake.writes).toHaveLength(before);
  });

  it("shows only business choices and preserves historical art consent and events when choices change", async () => {
    const historicalTopics = { marcus_rosser_art: true, rosser_gallery: false, rt_solutions: false };
    const historicalEvent = { eventType: "preferences_updated", topics: { ...historicalTopics }, permissionState: "topic_opted_in" };
    const fake = fakeDb({
      [tokenPath(preferenceToken)]: tokenDocument("preferences"),
      [`crm_contact_points/${contactPointId}`]: contactDocument(),
      [preferenceStatePath()]: { topics: { ...historicalTopics }, globallyUnsubscribed: false },
      "crm_permission_events/historical-art-choice": historicalEvent,
    });
    const beforeInspect = [...fake.records.entries()];
    const inspected = await processWarmReconnectPreferenceMutation(
      { action: "inspect", token: preferenceToken }, { db: fake.db }
    );
    expect(inspected.topics).toEqual({ rosser_gallery: false, rt_solutions: false });
    expect([...fake.records.entries()]).toEqual(beforeInspect);
    expect(fake.writes).toHaveLength(0);

    const saved = await processWarmReconnectPreferenceMutation({
      action: "save_preferences", token: preferenceToken, requestId: "business-choice",
      topics: { rosser_gallery: true, rt_solutions: true },
    }, { db: fake.db });
    expect(saved.topics).toEqual({ rosser_gallery: true, rt_solutions: true });
    expect(fake.records.get(preferenceStatePath())).toMatchObject({
      topics: { marcus_rosser_art: true, rosser_gallery: true, rt_solutions: true },
    });
    expect(fake.records.get("crm_permission_events/historical-art-choice")).toEqual(historicalEvent);
    const newEvent = fake.writes.find(write => write.path.startsWith("crm_permission_events/"));
    expect(newEvent?.data.topics).toEqual({ rosser_gallery: true, rt_solutions: true });
    expect(fake.writes.find(write => write.path === preferenceStatePath())?.data.topics)
      .toEqual({ rosser_gallery: true, rt_solutions: true });
    expect(fake.records.get(`crm_contact_points/${contactPointId}`)?.defaultPermissionState).toBe("unknown");
  });

  it.each([true, false])("rejects new personal-art choices even when the retired value is %s", async (retiredValue) => {
    const fake = fakeDb({
      [tokenPath(preferenceToken)]: tokenDocument("preferences"),
      [`crm_contact_points/${contactPointId}`]: contactDocument(),
    });
    const topics = { rosser_gallery: true, rt_solutions: false, marcus_rosser_art: retiredValue };
    const result = await processWarmReconnectPreferenceMutation({
      action: "save_preferences", token: preferenceToken, requestId: "retired-topic", topics,
    }, { db: fake.db });
    expect(result).toMatchObject({ available: false, canUpdatePreferences: false });
    expect(fake.writes).toHaveLength(0);
  });

  it("keeps global unsubscribe sticky while retaining historical personal-art evidence", async () => {
    const fake = fakeDb({
      [tokenPath(preferenceToken)]: tokenDocument("preferences"),
      [`crm_contact_points/${contactPointId}`]: contactDocument(),
      [preferenceStatePath()]: { topics: { marcus_rosser_art: true, rosser_gallery: true, rt_solutions: false }, globallyUnsubscribed: false },
    });
    const unsubscribed = await globallyUnsubscribeWarmReconnectCapability(preferenceToken, { db: fake.db });
    expect(unsubscribed).toMatchObject({ globallyUnsubscribed: true, topics: { rosser_gallery: false, rt_solutions: false } });
    expect(fake.records.get(preferenceStatePath())).toMatchObject({ globallyUnsubscribed: true, topics: { marcus_rosser_art: true } });
    const writesAfterUnsubscribe = fake.writes.length;
    const result = await processWarmReconnectPreferenceMutation({
      action: "save_preferences", token: preferenceToken, requestId: "after-opt-out",
      topics: { rosser_gallery: true, rt_solutions: true },
    }, { db: fake.db });
    expect(result).toMatchObject({ globallyUnsubscribed: true, canUpdatePreferences: false });
    expect(fake.writes).toHaveLength(writesAfterUnsubscribe);
    expect(fake.records.get(`crm_contact_points/${contactPointId}`)?.defaultPermissionState).toBe("opted_out");
  });

  it("honors a historical global unsubscribe state even without a suppression document", async () => {
    const fake = fakeDb({
      [tokenPath(preferenceToken)]: tokenDocument("preferences"),
      [`crm_contact_points/${contactPointId}`]: contactDocument(),
      [preferenceStatePath()]: { topics: { marcus_rosser_art: true }, globallyUnsubscribed: true },
    });
    const result = await processWarmReconnectPreferenceMutation({
      action: "save_preferences", token: preferenceToken, requestId: "legacy-opt-out",
      topics: { rosser_gallery: true, rt_solutions: false },
    }, { db: fake.db });
    expect(result).toMatchObject({ globallyUnsubscribed: true, canUpdatePreferences: false });
    expect(fake.writes).toHaveLength(0);
  });
});
