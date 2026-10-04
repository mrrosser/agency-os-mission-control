import "server-only";

import { createHash } from "node:crypto";

// Pin the privately authorized destination without publishing the personal address.
// No environment setting or caller-provided digest can widen this one-test allowlist.
const AUTHORIZED_RECIPIENT_SHA256 = "205b7bbb67040c95668236d1593a3d4079e27d0fef6deaa267a5dde268c0cb9c";

export function isWarmReconnectQaRecipient(value: string): boolean {
  if (typeof value !== "string") return false;
  const canonical = value.trim().toLowerCase();
  if (canonical.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(canonical)) return false;
  return createHash("sha256").update(canonical, "utf8").digest("hex") === AUTHORIZED_RECIPIENT_SHA256;
}
