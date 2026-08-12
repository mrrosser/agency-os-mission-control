import "server-only";

import type { Logger } from "@/lib/logging";
import { WARM_RECONNECT_EXECUTION_POLICY } from "@/lib/crm/warm-reconnect-activation";
import {
  buildWarmReconnectCampaignMime,
  encodeWarmReconnectMimeForGmail,
  type WarmReconnectCampaignMessage,
} from "@/lib/google/gmail-campaign";
import { callGoogleAPI } from "@/lib/google/tokens";

export async function sendWarmReconnectCampaignEmail(
  accessToken: string,
  input: WarmReconnectCampaignMessage,
  log?: Logger
): Promise<{ id: string; threadId: string }> {
  const mime = buildWarmReconnectCampaignMime(input);
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
