import type { Metadata } from "next";
import { WarmReconnectPreferences } from "@/components/crm/warm-reconnect-preferences";

export const metadata: Metadata = {
  title: "Email Preferences | Marcus Rosser",
  description: "Choose which Marcus Rosser updates you would like to receive.",
  referrer: "no-referrer",
  robots: { index: false, follow: false, nocache: true },
};

export default function PreferencesPage() {
  return (
    <>
      <meta
        httpEquiv="Content-Security-Policy"
        content="default-src 'self'; connect-src 'self'; img-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'"
      />
      <WarmReconnectPreferences />
    </>
  );
}
