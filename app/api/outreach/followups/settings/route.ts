import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { resolveLeadRunOrgId } from "@/lib/lead-runs/quotas";
import { getFollowupsOrgSettings, patchFollowupsOrgSettings } from "@/lib/outreach/followups-settings";

const patchSchema = z.object({
  autoEnabled: z.boolean().optional(),
  maxTasksPerInvocation: z.coerce.number().int().min(1).max(25).optional(),
  drainDelaySeconds: z.coerce.number().int().min(0).max(3600).optional(),
});

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const orgId = await resolveLeadRunOrgId(user.uid, log);
    const settings = await getFollowupsOrgSettings(orgId, log);
    return NextResponse.json({ orgId, settings });
  },
  { route: "outreach.followups.settings.get" }
);

export const PATCH = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, patchSchema);
    const user = await requireFirebaseAuth(request, log);
    const orgId = await resolveLeadRunOrgId(user.uid, log);
    const settings = await patchFollowupsOrgSettings({ orgId, patch: body, log });
    return NextResponse.json({ orgId, settings });
  },
  { route: "outreach.followups.settings.patch" }
);

