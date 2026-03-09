import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { listApprovalQueueForUser } from "@/lib/lead-runs/approval-queue";

const querySchema = z.object({
  emailLimit: z.coerce.number().int().min(1).max(100).optional(),
  calendarLimit: z.coerce.number().int().min(1).max(100).optional(),
});

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const requestUrl = request.nextUrl || new URL(request.url);
    const parsed = querySchema.parse({
      emailLimit: requestUrl.searchParams.get("emailLimit") || undefined,
      calendarLimit: requestUrl.searchParams.get("calendarLimit") || undefined,
    });

    const queue = await listApprovalQueueForUser(user.uid, parsed);
    return NextResponse.json(queue);
  },
  { route: "dashboard.approval-queue.get" }
);
