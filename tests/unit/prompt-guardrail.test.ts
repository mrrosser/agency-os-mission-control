import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  buildPromptGuardrailInstructionBlock,
  buildPromptGuardrailResult,
  createSkillRegistryAdapter,
} from "../../lib/agents/prompt-guardrail";

function readRuntimeConfig() {
  const fullPath = join(
    process.cwd(),
    "please-review",
    "from-root",
    "config-templates",
    "email-triage.runtime.v3.json"
  );
  return JSON.parse(readFileSync(fullPath, "utf8")) as Record<string, unknown>;
}

describe("prompt guardrail", () => {
  it("loads local skills through the adapter and builds a structured envelope", () => {
    const registry = createSkillRegistryAdapter([join(process.cwd(), "skills")]);
    const runtime = readRuntimeConfig();
    const promptGuardrail = ((runtime.aiDrafting as Record<string, unknown>).promptGuardrail ??
      {}) as Record<string, unknown>;
    const routeResourceMap = (promptGuardrail.routeResourceMap ?? {}) as Record<string, string>;

    const styleResources = [
      {
        label: "route:rt_solutions",
        skillName: "lead-comms-email-route-voices",
        resourcePath: String(routeResourceMap.rt_solutions),
      },
    ];

    const guardrail = buildPromptGuardrailResult({
      rawPrompt:
        "Draft a reply for RT Solutions. Subject: district automation pilot. Reply recipient: district@example.com. Keep the output to the email body only.",
      correlationId: "cid-test-1",
      registry,
      goal: "Draft a concise business reply that continues the active thread.",
      taskType: "email_draft",
      inputs: [
        { name: "routeKey", value: "rt_solutions" },
        { name: "replyEmail", value: "district@example.com" },
        { name: "subject", value: "district automation pilot" },
        { name: "threadContext", value: "present" },
      ],
      constraints: ["Plain text only.", "Do not invent facts."],
      desiredOutput: "Email body only.",
      baseSkills: ((promptGuardrail.baseSkills as string[]) ?? []).map((entry) => String(entry)),
      candidateSkills: [],
      requiredInputNames: ((promptGuardrail.requiredInputNames as string[]) ?? []).map((entry) =>
        String(entry)
      ),
      styleModules: styleResources.map((entry) => entry.label),
    });

    expect(guardrail.envelope.task_type).toBe("email_draft");
    expect(guardrail.envelope.confidence).toBe("high");
    expect(guardrail.selected_skills).toEqual(
      expect.arrayContaining([
        "lead-comms-email-thread-guardrails",
        "lead-comms-email-shared-voice",
        "lead-comms-email-route-voices",
      ])
    );
    expect(guardrail.style_modules).toContain("route:rt_solutions");

    const addendum = buildPromptGuardrailInstructionBlock({
      guardrail,
      registry,
      styleResources,
    });
    expect(addendum).toMatch(/RT Solutions voice/i);
    expect(addendum).toMatch(/Lead Comms Email Thread Guardrails/i);
  });

  it("marks low confidence when required thread context is missing", () => {
    const registry = createSkillRegistryAdapter([join(process.cwd(), "skills")]);
    const guardrail = buildPromptGuardrailResult({
      rawPrompt: "Reply to this quickly.",
      correlationId: "cid-test-2",
      registry,
      goal: "Draft a concise business reply that continues the active thread.",
      taskType: "email_draft",
      inputs: [
        { name: "routeKey", value: "rt_solutions" },
        { name: "replyEmail", value: "district@example.com" },
      ],
      constraints: ["Plain text only."],
      desiredOutput: "Email body only.",
      baseSkills: ["lead-comms-email-thread-guardrails"],
      candidateSkills: [],
      requiredInputNames: ["routeKey", "replyEmail", "subject", "threadContext"],
      styleModules: [],
    });

    expect(guardrail.envelope.confidence).toBe("low");
    expect(guardrail.envelope.ask_back_required).toBe(true);
    expect(guardrail.envelope.ambiguities).toEqual(
      expect.arrayContaining([
        "Missing required input: subject.",
        "Missing required input: threadContext.",
      ])
    );
  });
});
