import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/providers/auth-provider";
import ErrorBoundary from "@/components/providers/error-boundary";
import { TelemetryReporter } from "@/components/providers/telemetry-reporter";
import { Toaster } from "sonner";
import { buildFirebaseClientConfigScript } from "@/lib/firebase-client-config";

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
  verification: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
    : undefined,
};

import { BetaFeedback } from "@/components/feedback/BetaFeedback";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const firebaseClientConfigScript = buildFirebaseClientConfigScript({
    env: {
      NEXT_PUBLIC_FIREBASE_API_KEY: process.env["NEXT_PUBLIC_FIREBASE_API_KEY"],
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN"],
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env["NEXT_PUBLIC_FIREBASE_PROJECT_ID"],
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env["NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET"],
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env["NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"],
      NEXT_PUBLIC_FIREBASE_APP_ID: process.env["NEXT_PUBLIC_FIREBASE_APP_ID"],
    },
    defaultsJson: process.env["__FIREBASE_DEFAULTS__"],
  });

  return (
    <html lang="en" className="dark">
      <head>
        <script
          id="firebase-client-config"
          dangerouslySetInnerHTML={{ __html: firebaseClientConfigScript }}
        />
      </head>
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
