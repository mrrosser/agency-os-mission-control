export type FirstScanTourStepKey = "identity" | "api_keys" | "google" | "run_scan";

export interface FirstScanTourSignals {
  hasIdentity: boolean;
  googleConnected: boolean;
  googleCapabilities: { drive: boolean; calendar: boolean; gmail: boolean };
  secretStatus: {
    googlePlacesKey: "secret" | "env" | "missing";
    firecrawlKey: "secret" | "env" | "missing";
  };
}

export interface FirstScanTourStep {
  key: FirstScanTourStepKey;
  title: string;
  description: string;
  done: boolean;
  href?: string;
  ctaLabel?: string;
}

export function buildFirstScanTourSteps(signals: FirstScanTourSignals): FirstScanTourStep[] {
  const hasPlaces = signals.secretStatus.googlePlacesKey !== "missing";
  const hasFirecrawl = signals.secretStatus.firecrawlKey !== "missing";

  return [
    {
      key: "identity",
      title: "Set your Identity (Offer)",
      description:
        "Tell the agent what you sell and how you want outreach written (business name, offer, value prop).",
      done: signals.hasIdentity,
      href: "/dashboard/identity",
      ctaLabel: "Open Identity",
    },
    {
      key: "api_keys",
      title: "Add Lead Sourcing Keys",
      description:
        `Add Google Places (required for fresh leads)${hasFirecrawl ? "" : " and Firecrawl (recommended for enrichment)"}.`,
      done: hasPlaces,
      href: "/dashboard/settings",
      ctaLabel: "Open API Vault",
    },
    {
      key: "google",
      title: "Connect Google Workspace (Optional)",
      description:
        "Connect Drive + Calendar (and optionally Gmail) to enable Knowledge Base browsing, scheduling, and outreach automations.",
      done: signals.googleConnected && signals.googleCapabilities.drive && signals.googleCapabilities.calendar,
      href: "/dashboard/integrations",
      ctaLabel: "Open Integrations",
    },
    {
      key: "run_scan",
      title: "Run your First Scan",
      description:
        "Go to Operations and fill: Lead Query (or Industry), Location, Lead Limit, Minimum Score — then click Run.",
      done: false,
      href: "/dashboard/operations",
      ctaLabel: "Open Operations",
    },
  ];
}

export function firstIncompleteStepIndex(steps: FirstScanTourStep[]): number {
  const index = steps.findIndex((step) => !step.done && step.key !== "run_scan");
  return index === -1 ? 0 : index;
}

