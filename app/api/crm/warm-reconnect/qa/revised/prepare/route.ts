import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseBoundedWarmReconnectJson } from "@/lib/crm/warm-reconnect-activation";
import { prepareWarmReconnectQa, readWarmReconnectQaForOwner } from "@/lib/crm/warm-reconnect-qa";
import { isWarmReconnectQaRecipient } from "@/lib/crm/warm-reconnect-qa-recipient";
import { authorizeWarmReconnectQaOwner, secureWarmReconnectQaJson } from "@/lib/crm/warm-reconnect-qa-route";
import { WARM_RECONNECT_QA_REVISED_TEST_ID } from "@/lib/crm/warm-reconnect-qa-version";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const schema = z.object({
  recipient: z.string().trim().toLowerCase().email().refine(isWarmReconnectQaRecipient),
  testOnly: z.literal(true),
}).strict();

export const GET = withApiHandler(async (context) => {
  const uid = await authorizeWarmReconnectQaOwner(context);
  return secureWarmReconnectQaJson(await readWarmReconnectQaForOwner(uid, undefined, WARM_RECONNECT_QA_REVISED_TEST_ID));
}, { route: "crm.warm_reconnect.qa.revised.prepare.get", persistServerErrors: false });

export const POST = withApiHandler(async (context) => {
  const uid = await authorizeWarmReconnectQaOwner(context);
  const body = await parseBoundedWarmReconnectJson(context.request, schema, 1024);
  return secureWarmReconnectQaJson(await prepareWarmReconnectQa({ uid, recipient: body.recipient, log: context.log, testId: WARM_RECONNECT_QA_REVISED_TEST_ID }));
}, { route: "crm.warm_reconnect.qa.revised.prepare.post", persistServerErrors: false });
