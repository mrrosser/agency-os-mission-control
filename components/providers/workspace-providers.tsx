"use client";

import { Toaster } from "sonner";
import { BetaFeedback } from "@/components/feedback/BetaFeedback";
import { AuthProvider } from "@/components/providers/auth-provider";
import ErrorBoundary from "@/components/providers/error-boundary";
import { TelemetryReporter } from "@/components/providers/telemetry-reporter";

export function WorkspaceProviders({ children }: { children: React.ReactNode }) {
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
