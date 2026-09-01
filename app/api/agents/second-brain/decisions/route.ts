import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { assertSecondBrainOperatorUid, authorizeSecondBrainService } from "@/lib/second-brain-auth";
import { listSecondBrainDecisions } from "@/lib/second-brain";

export const runtime = "nodejs";

export const GET = withApiHandler(
  async ({ request, log, correlationId }) => {
    await authorizeSecondBrainService({ request, log, route: "agents.second-brain.decisions" });
    const searchParams = new URL(request.url).searchParams;
    const uid = searchParams.get("uid")?.trim() || "";
    const cursor = searchParams.get("cursor")?.trim() || undefined;
    const after = searchParams.get("after")?.trim() || undefined;
    const limit = Number(searchParams.get("limit") || 25);
    if (!uid) return NextResponse.json({ error: "uid is required", correlationId }, { status: 400 });
    const operatorUid = assertSecondBrainOperatorUid(uid);
    const result = await listSecondBrainDecisions({ uid: operatorUid, cursor, after, limit });
    return NextResponse.json({ ...result, correlationId });
  },
  { route: "agents.second-brain.decisions" }
);
