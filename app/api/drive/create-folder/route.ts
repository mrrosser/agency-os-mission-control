import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { createClientFolder } from "@/lib/google/drive";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";

const bodySchema = z.object({
  clientName: z.string().min(1),
  parentFolderId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export const POST = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const accessToken = await getAccessTokenForUser(user.uid, log);
    const idempotencyKey = getIdempotencyKey(request, body);

    const result = await withIdempotency(
      { uid: user.uid, route: "drive.create-folder", key: idempotencyKey, log },
      () => createClientFolder(accessToken, body.clientName, body.parentFolderId, log)
    );

    return NextResponse.json({
      success: true,
      replayed: result.replayed,
      ...result.data,
    });
  },
  { route: "drive.create-folder" }
);
