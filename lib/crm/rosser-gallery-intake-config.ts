import "server-only";

import { z } from "zod";
import { ApiError } from "@/lib/api/handler";
import {
  readRosserGalleryCrmConfig,
  type RosserGalleryCrmConfig,
} from "@/lib/crm/rosser-gallery-crm-config";
import type { RosserGalleryIntakeLeadV1 } from "@/lib/crm/rosser-gallery-intake-contract";

type Environment = Record<string, string | undefined>;

const notificationConfigSchema = z
  .object({
    notificationMaxAttempts: z.coerce.number().int().min(1).max(20).default(5),
  })
  .strict();

export const INTAKE_OWNER_NOTIFICATION_EMAIL = "mrosser@rossergallery.com";

export interface RosserGalleryIntakeConfig extends RosserGalleryCrmConfig {
  notificationOwnerEmails: Record<
    RosserGalleryIntakeLeadV1["businessUnit"],
    string
  >;
  notificationMaxAttempts: number;
}

export function readRosserGalleryIntakeConfig(
  environment: Environment = process.env
): RosserGalleryIntakeConfig {
  const crm = readRosserGalleryCrmConfig(environment);
  const notifications = notificationConfigSchema.safeParse({
    notificationMaxAttempts:
      environment.CRM_INTAKE_NOTIFICATION_MAX_ATTEMPTS || "5",
  });
  if (!notifications.success) {
    throw new ApiError(503, "Rosser Gallery intake notifications are not configured");
  }

  return {
    ...crm,
    notificationOwnerEmails: {
      rosser_gallery: INTAKE_OWNER_NOTIFICATION_EMAIL,
      rt_solutions: INTAKE_OWNER_NOTIFICATION_EMAIL,
    },
    notificationMaxAttempts: notifications.data.notificationMaxAttempts,
  };
}

export function crmBusinessUnitForIntake(
  businessUnit: RosserGalleryIntakeLeadV1["businessUnit"]
): "rosser_nft_gallery" | "rt_solutions" {
  return businessUnit === "rosser_gallery"
    ? "rosser_nft_gallery"
    : "rt_solutions";
}
