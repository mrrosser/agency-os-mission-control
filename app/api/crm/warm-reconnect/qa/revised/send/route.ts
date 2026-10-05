import { z } from "zod";
import { withApiHandler } from "@/lib/api/handler";
import { parseBoundedWarmReconnectJson } from "@/lib/crm/warm-reconnect-activation";
import { sendWarmReconnectQa } from "@/lib/crm/warm-reconnect-qa";
import { isWarmReconnectQaRecipient } from "@/lib/crm/warm-reconnect-qa-recipient";
import { authorizeWarmReconnectQaOwner, secureWarmReconnectQaJson } from "@/lib/crm/warm-reconnect-qa-route";
import { WARM_RECONNECT_QA_REVISED_TEST_ID, warmReconnectQaVersion } from "@/lib/crm/warm-reconnect-qa-version";

export const dynamic = "force-dynamic";
export const revalidate = 0;
const schema = z.object({
  recipient: z.string().trim().toLowerCase().email().refine(isWarmReconnectQaRecipient),
  artifactFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  confirmSendOneTest: z.literal(true),
  // A confirmation of this fixed version, never an arbitrary ID selector.
  reviewedTestId: z.literal(WARM_RECONNECT_QA_REVISED_TEST_ID),
  reviewedDesignVersion: z.literal(warmReconnectQaVersion(WARM_RECONNECT_QA_REVISED_TEST_ID).designVersion),
}).strict();

export const POST = withApiHandler(async (context) => {
  const uid = await authorizeWarmReconnectQaOwner(context);
  const { recipient, artifactFingerprint, confirmSendOneTest } = await parseBoundedWarmReconnectJson(context.request, schema, 1024);
  return secureWarmReconnectQaJson(await sendWarmReconnectQa({ uid, recipient, artifactFingerprint, confirmSendOneTest, testId: WARM_RECONNECT_QA_REVISED_TEST_ID }));
}, { route: "crm.warm_reconnect.qa.revised.send.post", persistServerErrors: false });
