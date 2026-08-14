import { describe, expect, it } from "vitest";
import {
  AICF_RETIREMENT_OPERATION_ID,
  assertProtectedDocumentsUnchanged,
  buildRetirementPlan,
  computeRetirementAggregate,
  decodeFirestoreFields,
  type FirestoreRestDocument,
  type FirestoreValue,
} from "@/lib/operations/aicf-firestore-retirement";

function encodeValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return { integerValue: String(value) };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (value && typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([key, child]) => [
            key,
            encodeValue(child),
          ])
        ),
      },
    };
  }
  throw new Error("Unsupported fixture value");
}

function encodeFields(value: Record<string, unknown>): Record<string, FirestoreValue> {
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, encodeValue(child)])
  );
}

function document(
  collectionId: "lead_run_templates" | "social_drafts",
  index: number,
  fields: Record<string, unknown>
): FirestoreRestDocument {
  return {
    name:
      `projects/leadflow-review/databases/(default)/documents/identities/user-hash-${index}/` +
      `${collectionId}/doc-${index}`,
    fields: encodeFields(fields),
    updateTime: `2026-08-14T00:00:${String(index).padStart(2, "0")}.000000Z`,
  };
}

function productionFixture() {
  const templateDocuments = Array.from({ length: 4 }, (_, index) =>
    document("lead_run_templates", index, {
      name: `Historical AICF ${index}`,
      params: { businessUnit: "ai_cofoundry", query: `query-${index}` },
      outreach: { businessKey: index % 2 === 0 ? "aicf" : "legacy" },
      active: false,
      customField: { preserve: true, sequence: index },
    })
  );
  const pending = Array.from({ length: 9 }, (_, index) =>
    document("social_drafts", 10 + index, {
      businessKey: "aicf",
      status: index % 2 === 0 ? "pending_approval" : "draft",
      caption: `private-caption-${index}`,
      media: [{ type: "image", url: `https://private.invalid/${index}` }],
      approval: {
        tokenHash: `private-token-hash-${index}`,
        decision: null,
        decidedAt: null,
        requestedAt: "2026-01-01T00:00:00.000Z",
      },
      dispatch: {
        status: null,
        queueDocId: null,
        queuedAt: null,
        externalTool: null,
      },
      source: "historical",
    })
  );
  const approvedDispatched = Array.from({ length: 3 }, (_, index) =>
    document("social_drafts", 30 + index, {
      businessKey: "aicf",
      status: "approved",
      caption: `approved-caption-${index}`,
      approval: { decision: "approve", decidedAt: "2026-01-02T00:00:00.000Z" },
      dispatch: {
        status: "dispatched",
        queueDocId: `queue-${index}`,
        queuedAt: "2026-01-02T00:01:00.000Z",
        externalTool: "SMAuto",
      },
    })
  );
  const rejected = Array.from({ length: 3 }, (_, index) =>
    document("social_drafts", 40 + index, {
      businessKey: "aicf",
      status: "rejected",
      caption: `rejected-caption-${index}`,
      approval: { decision: "reject", decidedAt: "2026-01-03T00:00:00.000Z" },
      dispatch: {
        status: null,
        queueDocId: null,
        queuedAt: null,
        externalTool: null,
      },
    })
  );
  return {
    templateDocuments,
    socialDraftDocuments: [...pending, ...approvedDispatched, ...rejected],
  };
}

describe("AICF Firestore operational retirement", () => {
  it("pins the exact 4/9 target set and protects six final historical drafts", () => {
    const fixture = productionFixture();
    const aggregate = computeRetirementAggregate(fixture);

    expect(aggregate.templates).toEqual({
      aicfMatching: 4,
      targetUnarchivedUnretired: 4,
      alreadyArchivedOrRetired: 0,
      activeTrueAmongTargets: 0,
    });
    expect(aggregate.socialDrafts).toEqual({
      aicfTotal: 15,
      targetGenuinelyPending: 9,
      finalApprovedDispatched: 3,
      rejected: 3,
      excludedOther: 0,
      retiredByOperation: 0,
    });

    const plan = buildRetirementPlan({
      projectId: "leadflow-review",
      ...fixture,
      timestamp: "2026-08-14T01:00:00.000Z",
      correlationId: "correlation-one",
    });

    expect(plan.targets).toHaveLength(13);
    expect(plan.targets.filter((target) => target.kind === "lead_run_template")).toHaveLength(4);
    expect(plan.targets.filter((target) => target.kind === "social_draft")).toHaveLength(9);
    expect(plan.protectedDocuments).toHaveLength(6);
    expect(plan.targets.some((target) => plan.protectedDocuments.some(
      (protectedDocument) => protectedDocument.name === target.source.name
    ))).toBe(false);
  });

  it("preserves every existing field while adding only retirement decisions", () => {
    const fixture = productionFixture();
    const plan = buildRetirementPlan({
      projectId: "leadflow-review",
      ...fixture,
      timestamp: "2026-08-14T01:00:00.000Z",
      correlationId: "correlation-two",
    });

    const template = plan.targets.find((target) => target.kind === "lead_run_template");
    const draft = plan.targets.find((target) => target.kind === "social_draft");
    expect(template).toBeDefined();
    expect(draft).toBeDefined();

    const originalTemplate = decodeFirestoreFields(template?.source.fields);
    const updatedTemplate = decodeFirestoreFields(template?.updatedFields);
    expect(updatedTemplate.name).toBe(originalTemplate.name);
    expect(updatedTemplate.params).toEqual(originalTemplate.params);
    expect(updatedTemplate.customField).toEqual(originalTemplate.customField);
    expect(updatedTemplate).toMatchObject({ archived: true, active: false, retired: true });
    expect(updatedTemplate.operationalRetirement).toMatchObject({
      operationKey: AICF_RETIREMENT_OPERATION_ID,
      decision: "retire_template",
    });

    const originalDraft = decodeFirestoreFields(draft?.source.fields);
    const updatedDraft = decodeFirestoreFields(draft?.updatedFields);
    expect(updatedDraft.caption).toBe(originalDraft.caption);
    expect(updatedDraft.media).toEqual(originalDraft.media);
    expect(updatedDraft.dispatch).toEqual(originalDraft.dispatch);
    expect((updatedDraft.approval as Record<string, unknown>).tokenHash).toBe(
      (originalDraft.approval as Record<string, unknown>).tokenHash
    );
    expect(updatedDraft).toMatchObject({ status: "rejected", retired: true });
    expect(updatedDraft.operationalRetirement).toMatchObject({
      operationKey: AICF_RETIREMENT_OPERATION_ID,
      decision: "reject_pending_draft",
      queueAction: "none",
      providerAction: "none",
    });
  });

  it("keeps the confirmation hash stable across operator time and correlation IDs", () => {
    const fixture = productionFixture();
    const first = buildRetirementPlan({
      projectId: "leadflow-review",
      ...fixture,
      timestamp: "2026-08-14T01:00:00.000Z",
      correlationId: "correlation-one",
    });
    const second = buildRetirementPlan({
      projectId: "leadflow-review",
      ...fixture,
      timestamp: "2026-08-14T02:00:00.000Z",
      correlationId: "correlation-two",
    });

    expect(first.planHash).toBe(second.planHash);
    expect(first.expectedTargetContentHash).not.toBe(second.expectedTargetContentHash);
  });

  it("fails closed when the production aggregate or protected history changes", () => {
    const fixture = productionFixture();
    const drifted = structuredClone(fixture);
    drifted.socialDraftDocuments[0].fields = encodeFields({
      businessKey: "aicf",
      status: "approved",
      approval: { decision: "approve" },
      dispatch: { status: null },
    });
    expect(() =>
      buildRetirementPlan({
        projectId: "leadflow-review",
        ...drifted,
        timestamp: "2026-08-14T01:00:00.000Z",
        correlationId: "correlation-three",
      })
    ).toThrow("Production AICF aggregate changed");

    const plan = buildRetirementPlan({
      projectId: "leadflow-review",
      ...fixture,
      timestamp: "2026-08-14T01:00:00.000Z",
      correlationId: "correlation-four",
    });
    const changedHistory = structuredClone(fixture);
    changedHistory.socialDraftDocuments[9].fields = {
      ...(changedHistory.socialDraftDocuments[9].fields || {}),
      unexpectedMutation: { booleanValue: true },
    };
    expect(() =>
      assertProtectedDocumentsUnchanged({
        protectedDocuments: plan.protectedDocuments,
        ...changedHistory,
      })
    ).toThrow("protected final AICF record changed");
  });
});
