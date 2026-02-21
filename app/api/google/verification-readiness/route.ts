import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { buildVerificationReadinessReport } from "@/lib/google/verification-readiness";

export const GET = withApiHandler(
  async ({ request, log }) => {
    await requireFirebaseAuth(request, log);
    const url = new URL(request.url);
    const baseUrl = (url.searchParams.get("baseUrl") || request.nextUrl?.origin || "").trim();
    const report = await buildVerificationReadinessReport(baseUrl);
    return NextResponse.json(report);
  },
  { route: "google.verification_readiness.get" }
);

