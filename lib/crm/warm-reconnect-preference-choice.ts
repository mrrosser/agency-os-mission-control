import type { WarmReconnectTopics } from "@/lib/crm/warm-reconnect-preferences";

/** A choice is only a display hint. The existing POST is the consent boundary. */
export const WARM_RECONNECT_CHOICES = [
  { id: "rosser_gallery", label: "Rosser Gallery" },
  { id: "rt_solutions", label: "RT.Solutions" },
  { id: "both", label: "Both" },
] as const;

export type WarmReconnectChoice = (typeof WARM_RECONNECT_CHOICES)[number]["id"];

export function isWarmReconnectQaFragment(fragment: string): boolean {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  return params.get("mode") === "qa" && params.getAll("mode").length === 1;
}

export function warmReconnectChoiceTopics(choice: WarmReconnectChoice): WarmReconnectTopics {
  return {
    rosser_gallery: choice === "rosser_gallery" || choice === "both",
    rt_solutions: choice === "rt_solutions" || choice === "both",
  };
}

export function parseWarmReconnectPreferenceFragment(fragment: string): {
  token: string | null;
  choice: WarmReconnectChoice | null;
} {
  const raw = fragment.replace(/^#/, "");
  const params = new URLSearchParams(raw);
  const structured = raw.startsWith("token=");
  const token = structured ? params.get("token") : raw;
  if (
    !token || !/^[A-Za-z0-9_-]{43,128}$/.test(token) ||
    (structured && (params.getAll("token").length !== 1 || params.getAll("choice").length > 1 ||
      params.getAll("mode").length > 1 || (params.has("mode") && params.get("mode") !== "qa") ||
      [...params.keys()].some((key) => key !== "token" && key !== "choice" && key !== "mode")))
  ) return { token: null, choice: null };
  const choice = WARM_RECONNECT_CHOICES.find((option) => option.id === params.get("choice"))?.id ?? null;
  return { token, choice };
}

export function warmReconnectChoiceUrl(preferencesUrl: string, choice: WarmReconnectChoice): string {
  const url = new URL(preferencesUrl);
  const params = new URLSearchParams(url.hash.slice(1));
  params.set("choice", choice);
  url.hash = params.toString();
  return url.toString();
}
