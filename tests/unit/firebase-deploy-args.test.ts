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

  it("preserves hosting channel deploy commands", () => {
    expect(
      normalizeFirebaseDeployArgs([
        "hosting:channel:deploy",
        "main-123",
        "--project",
        "leadflow-review",
        "--expires",
        "7d",
      ])
    ).toEqual([
      "hosting:channel:deploy",
      "main-123",
      "--project",
      "leadflow-review",
      "--expires",
      "7d",
    ]);
  });

  it("preserves hosting clone promotion commands", () => {
    expect(
      normalizeFirebaseDeployArgs([
        "hosting:clone",
        "leadflow-review:main-123",
        "leadflow-review:live",
        "--project",
        "leadflow-review",
      ])
    ).toEqual([
      "hosting:clone",
      "leadflow-review:main-123",
      "leadflow-review:live",
      "--project",
      "leadflow-review",
    ]);
  });
});
