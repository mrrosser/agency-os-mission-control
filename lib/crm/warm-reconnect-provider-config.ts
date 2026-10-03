import "server-only";

export const WARM_RECONNECT_PROVIDER_SEND_FLAG =
  "WARM_RECONNECT_PROVIDER_SEND_ENABLED" as const;

/** Read the same runtime capability for execution and owner-facing status. */
export function isWarmReconnectProviderSendEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const value = env[WARM_RECONNECT_PROVIDER_SEND_FLAG];
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}
