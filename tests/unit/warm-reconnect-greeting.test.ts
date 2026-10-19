import { describe, expect, it } from "vitest";
import { resolveWarmReconnectGreetingName } from "@/lib/crm/warm-reconnect-greeting";

describe("warm reconnect greeting selection", () => {
  it.each([
    null, undefined, "", "  ", "Contact", "contact", "Unknown contact", "Unnamed",
    "Dr Taylor Example", "Dr. Morgan Example", "Ms. Jordan Example", "Sir Avery Example",
    "Example, Taylor", "Screen Printing", "screen   printing services",
    "Team Example", "Example Workshop LLC", "Example Studio Inc.",
  ])("uses the neutral template fallback for uncertain label %j", (name) => {
    expect(resolveWarmReconnectGreetingName(name)).toBe("there");
  });

  it.each([
    ["alex Example", "Alex"],
    ["  Taylor   Example  ", "Taylor"],
    ["Anne-Marie Example", "Anne-Marie"],
    ["O'Casey Example", "O'Casey"],
    ["Élodie Example", "Élodie"],
    ["李 Example", "李"],
    ["Sam Example w @Studio", "Sam"],
    ["Morgan Example, Ph.D.", "Morgan"],
    ["Dad", "Dad"],
    ["J Example", "J"],
    ["A,Example", "A,Example"],
    ["<Alex> Example", "Alex"],
    ["a".repeat(90), `A${"a".repeat(79)}`],
  ])("preserves the existing greeting for %j", (name, expected) => {
    expect(resolveWarmReconnectGreetingName(name)).toBe(expected);
  });
});
