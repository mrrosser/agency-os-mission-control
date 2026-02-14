import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler, ApiError } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { parseJson } from "@/lib/api/validation";
import {
  acknowledgeLeadRunAlert,
  escalateOpenLeadRunAlerts,
  listLeadRunAlerts,
  resolveLeadRunOrgId,
} from "@/lib/lead-runs/quotas";

const bodySchema = z.object({
  action: z.literal("acknowledge"),
  alertId: z.string().min(1).max(160),
  note: z.string().min(1).max(500).optional(),
});

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const orgId = await resolveLeadRunOrgId(user.uid, log);

    const requestUrl =
      "nextUrl" in request && request.nextUrl ? request.nextUrl : new URL(request.url);
    const limitRaw = requestUrl.searchParams.get("limit");
    const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : 10;
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 25)) : 10;

    await escalateOpenLeadRunAlerts({ orgId, limit, log });
    const alerts = await listLeadRunAlerts(orgId, limit);
    return NextResponse.json({ alerts });
  },
  { route: "lead-runs.alerts.list" }
);

export const POST = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const body = await parseJson(request, bodySchema);
    if (body.action !== "acknowledge") {
      throw new ApiError(400, "Unsupported action");
    }

    const orgId = await resolveLeadRunOrgId(user.uid, log);
    await acknowledgeLeadRunAlert({
      orgId,
      alertId: body.alertId,
      uid: user.uid,
      note: body.note,
      log,
    });
    return NextResponse.json({ ok: true });
  },
  { route: "lead-runs.alerts.ack" }
);
