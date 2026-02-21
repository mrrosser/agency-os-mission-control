import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { buildRuntimePreflightReport } from "@/lib/runtime/preflight";

export const GET = withApiHandler(
  async ({ request, log }) => {
    await requireFirebaseAuth(request, log);
    const report = buildRuntimePreflightReport();
    return NextResponse.json(report);
  },
  { route: "runtime.preflight.get" }
);

