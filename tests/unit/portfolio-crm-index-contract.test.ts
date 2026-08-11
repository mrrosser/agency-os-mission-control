import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type IndexConfig = {
  indexes: Array<{
    collectionGroup: string;
    queryScope: string;
    fields: Array<{ fieldPath: string; order?: string }>;
  }>;
};

function loadIndexConfig(): IndexConfig {
  const source = readFileSync(join(process.cwd(), "firestore.indexes.json"), "utf8");
  const withoutLineComments = source.replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(withoutLineComments) as IndexConfig;
}

describe("portfolio CRM Firestore index contract", () => {
  it("declares every workspace-scoped descending freshness index", () => {
    const config = loadIndexConfig();
    const requiredCollections = ["crm_people", "crm_contact_points", "crm_source_records"];

    for (const collectionGroup of requiredCollections) {
      expect(config.indexes).toContainEqual({
        collectionGroup,
        queryScope: "COLLECTION",
        fields: [
          { fieldPath: "workspaceId", order: "ASCENDING" },
          { fieldPath: "updatedAt", order: "DESCENDING" },
          { fieldPath: "__name__", order: "DESCENDING" },
        ],
      });
    }
  });

  it("preserves the existing live workspace-scoped leads composite", () => {
    const config = loadIndexConfig();

    expect(config.indexes).toContainEqual({
      collectionGroup: "leads",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "userId", order: "ASCENDING" },
        { fieldPath: "workspaceId", order: "ASCENDING" },
        { fieldPath: "createdAt", order: "DESCENDING" },
        { fieldPath: "__name__", order: "DESCENDING" },
      ],
    });
  });
});
