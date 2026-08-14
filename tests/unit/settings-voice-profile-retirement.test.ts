import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("active voice profile settings", () => {
  it("offers only Rosser Gallery and RT.Solutions organization profiles", () => {
    const source = readFileSync(
      join(process.cwd(), "app/dashboard/settings/page.tsx"),
      "utf8"
    );

    expect(source).toContain("Rosser Gallery Voice ID");
    expect(source).toContain("RT.Solutions Voice ID");
    expect(source).not.toMatch(/AICF Voice|aicfVoiceId|aicfModelId|\baicf:\s*\{/);
  });
});
