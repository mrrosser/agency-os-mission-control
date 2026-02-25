import { describe, expect, it } from "vitest";
import { normalizeEmailBodyForDelivery } from "@/lib/google/gmail";

describe("normalizeEmailBodyForDelivery", () => {
  it("converts escaped newline sequences to real line breaks", () => {
    const input =
      "Quick note:\\n\\nIf you can reply with:\\n- org + goals\\n- current stack/systems\\n\\nBest,\\nMarcus";
    const normalized = normalizeEmailBodyForDelivery(input);

    expect(normalized.includes("\\n")).toBe(false);
    expect(normalized.split("\n").length).toBeGreaterThan(4);
    expect(normalized).toContain("Quick note:");
    expect(normalized).toContain("Best,\nMarcus");
  });

  it("keeps already formatted email bodies intact", () => {
    const input = "Quick note:\n\nLine one.\nLine two.\n\nBest,\nMarcus";
    const normalized = normalizeEmailBodyForDelivery(input);

    expect(normalized).toBe(input);
  });

  it("does not rewrite single escaped path fragments", () => {
    const input = "Asset path: C:\\new-folder\\site";
    const normalized = normalizeEmailBodyForDelivery(input);

    expect(normalized).toBe(input);
  });
});
