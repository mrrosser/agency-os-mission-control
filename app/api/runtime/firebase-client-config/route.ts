import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import {
  buildFirebaseClientConfigScript,
  findMissingFirebaseClientConfig,
} from "@/lib/firebase-client-config";
import { getRuntimeFirebaseClientConfig } from "@/lib/firebase-runtime-config";

export const dynamic = "force-dynamic";

export const GET = withApiHandler(
  async ({ log }) => {
    const config = getRuntimeFirebaseClientConfig();
    const missingKeys = findMissingFirebaseClientConfig(config);

    log.info("firebase.client_config", {
      state: missingKeys.length === 0 ? "ok" : "incomplete",
      missingKeys,
    });

    const payload = buildFirebaseClientConfigScript({ injected: config });
    return new NextResponse(payload, {
      status: missingKeys.length === 0 ? 200 : 503,
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  },
  { route: "runtime-firebase-client-config" }
);
