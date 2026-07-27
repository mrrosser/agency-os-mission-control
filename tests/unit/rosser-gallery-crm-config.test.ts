import { describe, expect, it } from "vitest";
import {
  readRosserGalleryCrmConfig,
  requireRosserGalleryServiceToken,
} from "@/lib/crm/rosser-gallery-crm-config";

const TOKEN = "ingest-token-with-at-least-thirty-two-characters";

function configuredEnvironment(): Record<string, string> {
  return {
    CRM_INGEST_TOKEN: TOKEN,
    ROSSER_GALLERY_CRM_OWNER_UID: "owner-uid",
    ROSSER_GALLERY_CRM_WORKSPACE_ID: "rosser-gallery-workspace",
    ROSSER_GALLERY_CRM_BUSINESS_UNIT: "rosser_nft_gallery",
    ROSSER_GALLERY_CRM_CUSTOMER_ID_HMAC_SECRET:
      "customer-id-secret-with-at-least-thirty-two-characters",
  };
}

describe("Rosser Gallery CRM ingest configuration", () => {
  it("fails closed when required server configuration is missing", () => {
    expect(() => readRosserGalleryCrmConfig({})).toThrowError(
      expect.objectContaining({ status: 503 })
    );
  });

  it("rejects any business-unit override", () => {
    expect(() =>
      readRosserGalleryCrmConfig({
        ...configuredEnvironment(),
        ROSSER_GALLERY_CRM_BUSINESS_UNIT: "rt_solutions",
      })
    ).toThrowError(expect.objectContaining({ status: 503 }));
  });

  it("fails closed if Paperclip becomes the canonical CRM without an approved mirror", () => {
    expect(() =>
      readRosserGalleryCrmConfig({
        ...configuredEnvironment(),
        PAPERCLIP_API_BASE_URL: "https://paperclip.example",
      })
    ).toThrowError(expect.objectContaining({ status: 503 }));
  });

  it("accepts only the configured bearer token", () => {
    const config = readRosserGalleryCrmConfig(configuredEnvironment());

    expect(() => requireRosserGalleryServiceToken(null, config)).toThrowError(
      expect.objectContaining({ status: 403 })
    );
    expect(() =>
      requireRosserGalleryServiceToken("Bearer incorrect-token", config)
    ).toThrowError(expect.objectContaining({ status: 403 }));
    expect(() =>
      requireRosserGalleryServiceToken(`Bearer ${TOKEN}`, config)
    ).not.toThrow();
  });
});
