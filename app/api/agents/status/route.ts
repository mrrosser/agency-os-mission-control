import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAgentSpaceStatus, setAgentSpaceStatus } from "@/lib/agent-status";

const bodySchema = z.object({
  spaceId: z.string().min(1),
  agentId: z.string().min(1),
  source: z.string().optional(),
  messageId: z.string().optional(),
});

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const spaces = await getAgentSpaceStatus(user.uid, log);
    return NextResponse.json({ spaces });
  },
  { route: "agents.status" }
);

export const POST = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const body = await parseJson(request, bodySchema);
    await setAgentSpaceStatus(
      user.uid,
      body.spaceId,
      body.agentId,
      body.source,
      body.messageId,
      log
    );
    return NextResponse.json({ ok: true });
  },
  { route: "agents.status.update" }
);
