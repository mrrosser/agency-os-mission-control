import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/providers/auth-provider";
import ErrorBoundary from "@/components/providers/error-boundary";
import { TelemetryReporter } from "@/components/providers/telemetry-reporter";
import { Toaster } from "sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Mission Control | Agency OS",
  description: "The Operating System for your Agency",
};

import { BetaFeedback } from "@/components/feedback/BetaFeedback";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-black text-foreground bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.3),rgba(255,255,255,0))]`}
      >
        <AuthProvider>
          <TelemetryReporter />
          <ErrorBoundary>
            {children}
            <Toaster position="top-right" theme="dark" />
            <BetaFeedback />
          </ErrorBoundary>
        </AuthProvider>
      </body>
    </html>
  );
}
