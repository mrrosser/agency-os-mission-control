import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { getSecretStatus, setUserSecrets } from "@/lib/api/secrets";

const bodySchema = z.object({
  apiKeys: z
    .object({
      openaiKey: z.string().trim().min(1).optional(),
      twilioSid: z.string().trim().min(1).optional(),
      twilioToken: z.string().trim().min(1).optional(),
      twilioPhoneNumber: z.string().trim().min(1).optional(),
      elevenLabsKey: z.string().trim().min(1).optional(),
      heyGenKey: z.string().trim().min(1).optional(),
      googlePlacesKey: z.string().trim().min(1).optional(),
      firecrawlKey: z.string().trim().min(1).optional(),
      googlePickerApiKey: z.string().trim().min(1).optional(),
    })
    .optional(),
  idempotencyKey: z.string().optional(),
});

export const GET = withApiHandler(
  async ({ request, log }) => {
    const user = await requireFirebaseAuth(request, log);
    const status = await getSecretStatus(user.uid);
    return NextResponse.json({ status });
  },
  { route: "secrets.status" }
);

export const POST = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const idempotencyKey = getIdempotencyKey(request, body);

    if (!body.apiKeys || Object.keys(body.apiKeys).length === 0) {
      throw new ApiError(400, "apiKeys payload is required");
    }

    const result = await withIdempotency(
      { uid: user.uid, route: "secrets.update", key: idempotencyKey, log },
      async () => {
        await setUserSecrets(user.uid, body.apiKeys || {});
        const status = await getSecretStatus(user.uid);
        return { status };
      }
    );

    return NextResponse.json({
      success: true,
      replayed: result.replayed,
      ...result.data,
    });
  },
  { route: "secrets.update" }
);
