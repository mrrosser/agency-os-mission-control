import { describe, expect, it } from "vitest";
import {
  crmBusinessUnitForIntake,
  INTAKE_OWNER_NOTIFICATION_EMAIL,
  readRosserGalleryIntakeConfig,
} from "@/lib/crm/rosser-gallery-intake-config";

const TOKEN = "ingest-token-with-at-least-thirty-two-characters";
const HMAC = "customer-id-secret-with-at-least-thirty-two-characters";

function environment(): Record<string, string> {
  return {
    CRM_INGEST_TOKEN: TOKEN,
    ROSSER_GALLERY_CRM_CUSTOMER_ID_HMAC_SECRET: HMAC,
    ROSSER_GALLERY_CRM_OWNER_UID: "owner-uid",
    ROSSER_GALLERY_CRM_WORKSPACE_ID: "workspace-id",
    ROSSER_GALLERY_CRM_BUSINESS_UNIT: "rosser_nft_gallery",
  };
}

describe("Rosser Gallery intake configuration", () => {
  it("pins both business units to the server-owned owner route and bounds retries", () => {
    const configured = environment();
    configured.CRM_INTAKE_NOTIFICATION_MAX_ATTEMPTS = "7";
    const config = readRosserGalleryIntakeConfig(configured);

    expect(config.notificationOwnerEmails).toEqual({
      rosser_gallery: INTAKE_OWNER_NOTIFICATION_EMAIL,
      rt_solutions: INTAKE_OWNER_NOTIFICATION_EMAIL,
    });
    expect(config.notificationMaxAttempts).toBe(7);

    configured.CRM_INTAKE_NOTIFICATION_MAX_ATTEMPTS = "21";
    expect(() => readRosserGalleryIntakeConfig(configured)).toThrowError(
      expect.objectContaining({ status: 503 })
    );
  });

  it("maps public business units to existing CRM values without caller routing", () => {
    expect(crmBusinessUnitForIntake("rosser_gallery")).toBe("rosser_nft_gallery");
    expect(crmBusinessUnitForIntake("rt_solutions")).toBe("rt_solutions");
  });
});
