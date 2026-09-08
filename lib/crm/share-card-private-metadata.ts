import type { ShareCardBrand } from "@/lib/crm/share-cards";

/** Workspace-only operational notes. Never import from public pages or actions. */
export const SHARE_CARD_PRIVATE_SYNC_STATUS: Readonly<Record<ShareCardBrand, string>> = {
  "rosser-gallery": "The live form captures gallery newsletter choices. Current submission-to-CRM receipts still need verification; this card does not establish sync readiness.",
  "rt-solutions": "The live inquiry form saves to Netlify. Its automatic internal CRM bridge is not built yet. Sending an inquiry is not an RT Solutions newsletter opt-in.",
};
