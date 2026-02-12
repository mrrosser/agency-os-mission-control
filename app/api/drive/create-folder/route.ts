import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";
import { createClientFolder } from "@/lib/google/drive";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { recordLeadActionReceipt } from "@/lib/lead-runs/receipts";

const bodySchema = z.object({
  clientName: z.string().min(1),
  parentFolderId: z.string().optional(),
  idempotencyKey: z.string().optional(),
  dryRun: z.boolean().optional(),
  runId: z.string().min(1).max(128).optional(),
  leadDocId: z.string().min(1).max(120).optional(),
  receiptActionId: z.string().min(1).max(120).optional(),
});

export const POST = withApiHandler(
  async ({ request, log, correlationId }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const idempotencyKey = getIdempotencyKey(request, body);

    if (body.dryRun) {
      const folderId = `dryrun_${correlationId.slice(0, 8)}`;
      const payload = {
        success: true,
        replayed: false,
        dryRun: true,
        mainFolder: {
          id: folderId,
          name: body.clientName,
          webViewLink: `https://drive.google.com/drive/folders/${folderId}`,
        },
        subfolders: {} as Record<string, unknown>,
      };

      if (body.runId && body.leadDocId) {
        await recordLeadActionReceipt(
          {
            runId: body.runId,
            leadDocId: body.leadDocId,
            actionId: body.receiptActionId || "drive.create-folder",
            uid: user.uid,
            correlationId,
            status: "simulated",
            dryRun: true,
            replayed: false,
            idempotencyKey,
            data: {
              folderId,
              webViewLink: payload.mainFolder.webViewLink,
            },
          },
          log
        );
      }

      return NextResponse.json(payload);
    }

    const accessToken = await getAccessTokenForUser(user.uid, log);
    const result = await withIdempotency(
      { uid: user.uid, route: "drive.create-folder", key: idempotencyKey, log },
      () => createClientFolder(accessToken, body.clientName, body.parentFolderId, log)
    );

    if (body.runId && body.leadDocId) {
      await recordLeadActionReceipt(
        {
          runId: body.runId,
          leadDocId: body.leadDocId,
          actionId: body.receiptActionId || "drive.create-folder",
          uid: user.uid,
          correlationId,
          status: "complete",
          dryRun: false,
          replayed: result.replayed,
          idempotencyKey,
          data: {
            folderId: result.data?.mainFolder?.id,
            webViewLink: result.data?.mainFolder?.webViewLink,
          },
        },
        log
      );
    }

    return NextResponse.json({
      success: true,
      replayed: result.replayed,
      dryRun: false,
      ...result.data,
    });
  },
  { route: "drive.create-folder" }
);
