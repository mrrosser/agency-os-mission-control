import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseBoundedWarmReconnectJson } from "@/lib/crm/warm-reconnect-activation";
import { sendWarmReconnectQa } from "@/lib/crm/warm-reconnect-qa";
import { isWarmReconnectQaRecipient } from "@/lib/crm/warm-reconnect-qa-recipient";
import { authorizeWarmReconnectQaOwner, secureWarmReconnectQaJson } from "@/lib/crm/warm-reconnect-qa-route";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const schema = z.object({
  recipient: z.string().trim().toLowerCase().email().refine(isWarmReconnectQaRecipient),
  artifactFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  confirmSendOneTest: z.literal(true),
}).strict();

export const POST = withApiHandler(async (context) => {
  const uid = await authorizeWarmReconnectQaOwner(context);
  const body = await parseBoundedWarmReconnectJson(context.request, schema, 1024);
  return secureWarmReconnectQaJson(await sendWarmReconnectQa({ uid, ...body }));
}, { route: "crm.warm_reconnect.qa.send.post", persistServerErrors: false });
