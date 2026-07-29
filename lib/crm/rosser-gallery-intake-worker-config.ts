import "server-only";

import { createHash, timingSafeEqual } from "crypto";
import { z } from "zod";
import { ApiError } from "@/lib/api/handler";

type Environment = Record<string, string | undefined>;

const workerConfigSchema = z
  .object({
    gmailUserId: z.string().trim().min(1).max(256),
    workerToken: z.string().min(32),
  })
  .strict();

export type RosserGalleryIntakeWorkerConfig = z.infer<typeof workerConfigSchema>;

export function readRosserGalleryIntakeWorkerConfig(
  environment: Environment = process.env
): RosserGalleryIntakeWorkerConfig {
  const parsed = workerConfigSchema.safeParse({
    gmailUserId: environment.GALLERY_INTAKE_GMAIL_USER_ID,
    workerToken: environment.GALLERY_INTAKE_NOTIFICATION_WORKER_TOKEN,
  });
  if (!parsed.success) {
    throw new ApiError(503, "Gallery intake notification worker is not configured");
  }
  return parsed.data;
}

function tokenDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function requireRosserGalleryIntakeWorkerToken(
  authorizationHeader: string | null,
  config: RosserGalleryIntakeWorkerConfig
): void {
  const match = authorizationHeader?.match(/^Bearer ([^\s]+)$/);
  const presentedToken = match?.[1];
  if (
    !presentedToken ||
    !timingSafeEqual(tokenDigest(presentedToken), tokenDigest(config.workerToken))
  ) {
    throw new ApiError(403, "Forbidden");
  }
}
