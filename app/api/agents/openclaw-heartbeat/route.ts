import { NextResponse } from "next/server";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import {
  OpenClawHeartbeatEnvelopeSchema,
  authorizeOpenClawHeartbeat,
  recordOpenClawHeartbeat,
} from "@/lib/agents/openclaw-heartbeat";

export const runtime = "nodejs";

export const POST = withApiHandler(
  async ({ request, correlationId, log }) => {
    const identity = await authorizeOpenClawHeartbeat(request, log);
    const envelope = await parseJson(request, OpenClawHeartbeatEnvelopeSchema);
    const result = await recordOpenClawHeartbeat({
      envelope,
      identity,
      requestCorrelationId: correlationId,
      log,
    });

    return NextResponse.json({
      ok: true,
      runtime_id: result.runtimeId,
      heartbeat_id: envelope.heartbeat_id,
      replayed: result.replayed,
      correlation_id: correlationId,
    });
  },
  { route: "agents.openclaw-heartbeat" }
);
