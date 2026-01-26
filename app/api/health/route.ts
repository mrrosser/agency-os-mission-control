import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";

export const GET = withApiHandler(
  async ({ log }) => {
    log.info("health.check");
    return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
  },
  { route: "health" }
);
