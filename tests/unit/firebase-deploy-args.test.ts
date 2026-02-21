import { describe, expect, it } from "vitest";
import { normalizeFirebaseDeployArgs } from "@/scripts/firebase-deploy-args.mjs";

describe("normalizeFirebaseDeployArgs", () => {
  it("returns default deploy args when no args are provided", () => {
    expect(normalizeFirebaseDeployArgs([])).toEqual(["deploy", "--only", "hosting"]);
  });

  it("maps a lone project id to deploy args", () => {
    expect(normalizeFirebaseDeployArgs(["leadflow-review"])).toEqual([
      "deploy",
      "--only",
      "hosting",
      "--project",
      "leadflow-review",
    ]);
  });

  it("maps deploy + project shorthand to canonical args", () => {
    expect(normalizeFirebaseDeployArgs(["deploy", "leadflow-review"])).toEqual([
      "deploy",
      "--only",
      "hosting",
      "--project",
      "leadflow-review",
    ]);
  });

  it("keeps explicit --project args unchanged", () => {
    expect(
      normalizeFirebaseDeployArgs(["deploy", "--only", "hosting", "--project", "leadflow-review"])
    ).toEqual(["deploy", "--only", "hosting", "--project", "leadflow-review"]);
  });
});

