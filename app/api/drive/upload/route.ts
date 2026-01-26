import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { uploadFile } from "@/lib/google/drive";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";

const bodySchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  fileContent: z.string().min(1),
  folderId: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export const POST = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const accessToken = await getAccessTokenForUser(user.uid, log);
    const idempotencyKey = getIdempotencyKey(request, body);

    const result = await withIdempotency(
      { uid: user.uid, route: "drive.upload", key: idempotencyKey, log },
      () =>
        uploadFile(
          accessToken,
          body.fileName,
          body.mimeType,
          body.fileContent,
          body.folderId,
          log
        )
    );

    return NextResponse.json({
      success: true,
      file: result.data,
      replayed: result.replayed,
    });
  },
  { route: "drive.upload" }
);
