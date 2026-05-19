import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import { buildPromptGuardrailResult, createSkillRegistryAdapter } from "../../lib/agents/prompt-guardrail";

const fixturePath = join(process.cwd(), "tests", "fixtures", "prompt_guardrail_golden_set.json");
const cases = JSON.parse(readFileSync(fixturePath, "utf8")) as Array<{
  name: string;
  raw_prompt: string;
  inputs: Array<{ name: string; value: string }>;
  required_input_names: string[];
  expected_confidence: "high" | "medium" | "low";
  expected_ask_back: boolean;
  expected_ambiguities: string[];
  consequential?: boolean;
}>;

describe("prompt guardrail golden set", () => {
  it("keeps confidence and ask-back behavior aligned", () => {
    const registry = createSkillRegistryAdapter([join(process.cwd(), "skills")]);

    for (const entry of cases) {
      const result = buildPromptGuardrailResult({
        rawPrompt: entry.raw_prompt,
        correlationId: `golden-${entry.name}`,
        registry,
        goal: "Validate canonical prompt parity.",
        taskType: "email_draft",
        inputs: entry.inputs,
        constraints: ["Plain text only."],
        desiredOutput: "Email body only.",
        candidateSkills: [],
        baseSkills: [],
        requiredInputNames: entry.required_input_names,
        consequential: Boolean(entry.consequential),
        styleModules: [],
      });

      expect(result.envelope.confidence).toBe(entry.expected_confidence);
      expect(result.envelope.ask_back_required).toBe(entry.expected_ask_back);
      expect(result.envelope.ambiguities).toEqual(expect.arrayContaining(entry.expected_ambiguities));
    }
  });
});
