import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler, ApiError } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { resolveLeadRunOrgId } from "@/lib/lead-runs/quotas";
import {
  deleteDncEntry,
  listDncEntries,
  normalizeDncValue,
  upsertDncEntry,
  type DncEntryType,
} from "@/lib/outreach/dnc";

const upsertSchema = z.object({
  type: z.enum(["email", "phone", "domain"]),
  value: z.string().trim().min(1).max(320),
  reason: z.string().trim().max(500).optional(),
});

const deleteSchema = z.object({
  entryId: z.string().trim().min(1).max(64),
});

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const orgId = await resolveLeadRunOrgId(user.uid, log);
    const entries = await listDncEntries(orgId);
    return NextResponse.json({ orgId, entries });
  },
  { route: "outreach.dnc.list" }
);

export const POST = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, upsertSchema);
    const user = await requireFirebaseAuth(request, log);
    const orgId = await resolveLeadRunOrgId(user.uid, log);

    const normalized = normalizeDncValue(body.type as DncEntryType, body.value);
    if (!normalized) {
      throw new ApiError(400, "Invalid DNC value");
    }

    const entry = await upsertDncEntry({
      orgId,
      uid: user.uid,
      type: body.type as DncEntryType,
      value: body.value,
      reason: body.reason ?? null,
    });

    return NextResponse.json({ orgId, entry });
  },
  { route: "outreach.dnc.upsert" }
);

export const DELETE = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, deleteSchema);
    const user = await requireFirebaseAuth(request, log);
    const orgId = await resolveLeadRunOrgId(user.uid, log);

    await deleteDncEntry(orgId, body.entryId);
    return NextResponse.json({ ok: true });
  },
  { route: "outreach.dnc.delete" }
);

