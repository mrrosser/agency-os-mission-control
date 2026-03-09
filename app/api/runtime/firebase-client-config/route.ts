import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import {
  buildFirebaseClientConfigScript,
  findMissingFirebaseClientConfig,
  resolveFirebaseClientConfig,
} from "@/lib/firebase-client-config";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(
  async ({ log }) => {
    const config = resolveFirebaseClientConfig({
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
    const missingKeys = findMissingFirebaseClientConfig(config);

    log.info("firebase.client_config", {
      state: missingKeys.length === 0 ? "ok" : "incomplete",
      missingKeys,
    });

    const payload = buildFirebaseClientConfigScript({ injected: config });
    return new NextResponse(payload, {
      status: 200,
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  },
  { route: "runtime-firebase-client-config" }
);
