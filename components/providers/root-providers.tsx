"use client";

import { usePathname } from "next/navigation";
import { Toaster } from "sonner";
import { BetaFeedback } from "@/components/feedback/BetaFeedback";
import { AuthProvider } from "@/components/providers/auth-provider";
import ErrorBoundary from "@/components/providers/error-boundary";
import { TelemetryReporter } from "@/components/providers/telemetry-reporter";

function isPreferenceCapabilityPath(pathname: string): boolean {
  return pathname === "/preferences" || pathname === "/preferences/";
}

export function RootProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (isPreferenceCapabilityPath(pathname)) {
    return <>{children}</>;
  }

  return (
    <AuthProvider>
      <TelemetryReporter />
      <ErrorBoundary>
        {children}
        <Toaster position="top-right" theme="dark" />
        <BetaFeedback />
      </ErrorBoundary>
    </AuthProvider>
  );
}
