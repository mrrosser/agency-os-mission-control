import "server-only";

import type { Logger } from "@/lib/logging";
import { WARM_RECONNECT_EXECUTION_POLICY } from "@/lib/crm/warm-reconnect-activation";
import {
  encodeWarmReconnectMimeForGmail,
} from "@/lib/google/gmail-campaign";
import { buildWarmReconnectCampaignDeliveryMime, type WarmReconnectCampaignDeliveryMessage } from "@/lib/google/gmail-campaign-design";
import { callGoogleAPI } from "@/lib/google/tokens";

export async function sendWarmReconnectCampaignEmail(
  accessToken: string,
  input: WarmReconnectCampaignDeliveryMessage,
  log?: Logger
): Promise<{ id: string; threadId: string }> {
  const mime = buildWarmReconnectCampaignDeliveryMime(input);
  return callGoogleAPI<{ id: string; threadId: string }>(
    WARM_RECONNECT_EXECUTION_POLICY.providerEndpoint,
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({ raw: encodeWarmReconnectMimeForGmail(mime) }),
    },
    log
  );
}
