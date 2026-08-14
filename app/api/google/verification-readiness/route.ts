import { NextResponse } from "next/server";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { buildVerificationReadinessReport } from "@/lib/google/verification-readiness";

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].length > 0) {
      throw new ApiError(400, "Query parameters are not supported.");
    }

    const report = await buildVerificationReadinessReport();
    const response = NextResponse.json(report);
    response.headers.set("cache-control", "private, no-store, max-age=0");
    response.headers.set("pragma", "no-cache");

    log.info("google.verification_readiness.generated", {
      uid: user.uid,
      status: report.status,
      origin: report.baseUrl,
    });

    return response;
  },
  { route: "google.verification_readiness.get" }
);

