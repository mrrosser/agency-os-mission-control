import "server-only";

import { createHash, timingSafeEqual } from "crypto";
import { z } from "zod";
import { ApiError } from "@/lib/api/handler";

const configSchema = z
  .object({
    ingestToken: z.string().min(32),
    ownerUid: z.string().trim().min(1).max(256),
    workspaceId: z.string().trim().min(1).max(256),
    businessUnit: z.literal("rosser_nft_gallery"),
    customerIdHmacSecret: z.string().min(32),
  })
  .strict();

export type RosserGalleryCrmConfig = z.infer<typeof configSchema>;

type Environment = Record<string, string | undefined>;

export function readRosserGalleryCrmConfig(
  environment: Environment = process.env
): RosserGalleryCrmConfig {
  if (
    environment.PAPERCLIP_API_BASE_URL?.trim() ||
    environment.PAPERCLIP_SYSTEM_URL?.trim() ||
    environment.PAPERCLIP_MCP_SERVER_URL?.trim()
  ) {
    throw new ApiError(
      503,
      "Rosser Gallery CRM ingest requires an approved Paperclip canonical-write path"
    );
  }

  const parsed = configSchema.safeParse({
    ingestToken: environment.CRM_INGEST_TOKEN,
    ownerUid: environment.ROSSER_GALLERY_CRM_OWNER_UID,
    workspaceId: environment.ROSSER_GALLERY_CRM_WORKSPACE_ID,
    businessUnit: environment.ROSSER_GALLERY_CRM_BUSINESS_UNIT,
    customerIdHmacSecret: environment.ROSSER_GALLERY_CRM_CUSTOMER_ID_HMAC_SECRET,
  });

  if (!parsed.success) {
    throw new ApiError(503, "Rosser Gallery CRM ingest is not configured");
  }

  return parsed.data;
}

function tokenDigest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function requireRosserGalleryServiceToken(
  authorizationHeader: string | null,
  config: RosserGalleryCrmConfig
): void {
  const match = authorizationHeader?.match(/^Bearer ([^\s]+)$/);
  const presentedToken = match?.[1];
  if (!presentedToken) {
    throw new ApiError(403, "Forbidden");
  }

  if (!timingSafeEqual(tokenDigest(presentedToken), tokenDigest(config.ingestToken))) {
    throw new ApiError(403, "Forbidden");
  }
}
