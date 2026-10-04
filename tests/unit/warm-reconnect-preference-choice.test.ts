import { describe, expect, it } from "vitest";
import {
  parseWarmReconnectPreferenceFragment,
  isWarmReconnectQaFragment,
  warmReconnectChoiceTopics,
  warmReconnectChoiceUrl,
} from "@/lib/crm/warm-reconnect-preference-choice";

const token = "p".repeat(43);
const url = `https://leadflow-review.web.app/preferences#token=${token}`;

describe("warm reconnect preference display hints", () => {
  it("preserves the explicit QA marker without changing the chosen topics", () => {
    const selected = warmReconnectChoiceUrl(`${url}&mode=qa`, "both");
    expect(parseWarmReconnectPreferenceFragment(new URL(selected).hash)).toEqual({ token, choice: "both" });
    expect(isWarmReconnectQaFragment(new URL(selected).hash)).toBe(true);
    expect(isWarmReconnectQaFragment(new URL(url).hash)).toBe(false);
    expect(parseWarmReconnectPreferenceFragment(`#token=${token}&mode=qa&mode=qa`)).toEqual({ token: null, choice: null });
    expect(parseWarmReconnectPreferenceFragment(`#token=${token}&mode=other`)).toEqual({ token: null, choice: null });
  });
  it.each([
    ["rosser_gallery", { rosser_gallery: true, rt_solutions: false }],
    ["rt_solutions", { rosser_gallery: false, rt_solutions: true }],
    ["both", { rosser_gallery: true, rt_solutions: true }],
  ] as const)("keeps %s and the token entirely in the fragment", (choice, topics) => {
    const selected = new URL(warmReconnectChoiceUrl(url, choice));
    expect(selected.origin + selected.pathname + selected.search).toBe("https://leadflow-review.web.app/preferences");
    expect(parseWarmReconnectPreferenceFragment(selected.hash)).toEqual({ token, choice });
    expect(warmReconnectChoiceTopics(choice)).toEqual(topics);
  });

  it("retains unselected canonical and legacy token links", () => {
    expect(parseWarmReconnectPreferenceFragment(`#token=${token}`)).toEqual({ token, choice: null });
    expect(parseWarmReconnectPreferenceFragment(token)).toEqual({ token, choice: null });
    expect(parseWarmReconnectPreferenceFragment(`#token=${token}&choice=unknown`)).toEqual({ token, choice: null });
  });

  it.each([
    "", "short", `token=${token}&token=${token}`, `token=${token}&choice=both&choice=rosser_gallery`,
    `token=${token}&email=someone@example.com`,
  ])("rejects ambiguous or invalid capability fragments: %s", (fragment) => {
    expect(parseWarmReconnectPreferenceFragment(fragment)).toEqual({ token: null, choice: null });
  });
});
