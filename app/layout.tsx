import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { RootProviders } from "@/components/providers/root-providers";
import { buildFirebaseClientConfigScript } from "@/lib/firebase-client-config";
import { getRuntimeFirebaseClientConfig } from "@/lib/firebase-runtime-config";

// Firebase Hosting provides public config at runtime. Never freeze an empty
// bootstrap script into a statically prerendered login or dashboard page.
export const dynamic = "force-dynamic";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const firebaseClientConfigScript = buildFirebaseClientConfigScript({
    injected: getRuntimeFirebaseClientConfig(),
  });

  return (
    <html lang="en" className="dark">
      <head>
        <script
          id="firebase-client-config"
          dangerouslySetInnerHTML={{ __html: firebaseClientConfigScript }}
        />
        {process.env.NODE_ENV !== "production" && process.env.FIGMA_CAPTURE_ENABLED === "1" ? (
          <script src="https://mcp.figma.com/mcp/html-to-design/capture.js" async />
        ) : null}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-black text-foreground bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.3),rgba(255,255,255,0))]`}
      >
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  );
}
