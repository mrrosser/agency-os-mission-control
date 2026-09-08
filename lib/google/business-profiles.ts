export const GOOGLE_BUSINESS_PROFILES = [
  {
    businessId: "rt_solutions",
    profileId: "rt_solutions_work",
    label: "RT.Solutions",
  },
  {
    businessId: "rosser_nft_gallery",
    profileId: "rosser_gallery_work",
    label: "Rosser Gallery",
  },
] as const;

// Sending is an explicit purpose, never the business's general work/default profile.
export const ROSSER_GALLERY_SENDING_PROFILE = {
  businessId: "rosser_nft_gallery",
  profileId: "rosser_gallery_send",
  label: "Gallery sending",
} as const;
export const ROSSER_GALLERY_SENDING_EMAIL = "mrosser@rossergallery.com";

export function isRosserGallerySendingProfile(profileId: string | null | undefined): boolean {
  return profileId === ROSSER_GALLERY_SENDING_PROFILE.profileId;
}

export function assertGoogleProfileConnectionPolicy(input: {
  profileId: string;
  scopePreset: string;
  accountEmail?: string;
}): void {
  if (!isRosserGallerySendingProfile(input.profileId)) return;
  if (input.scopePreset !== "gmail_send") {
    throw new Error("Gallery sending requires the dedicated gmail_send permission preset.");
  }
  if (
    input.accountEmail !== undefined &&
    input.accountEmail.trim().toLowerCase() !== ROSSER_GALLERY_SENDING_EMAIL
  ) {
    throw new Error(`Gallery sending requires the Google account ${ROSSER_GALLERY_SENDING_EMAIL}.`);
  }
}

export type GoogleBusinessProfile =
  | (typeof GOOGLE_BUSINESS_PROFILES)[number]
  | typeof ROSSER_GALLERY_SENDING_PROFILE;
export type GoogleBusinessId = GoogleBusinessProfile["businessId"];
export type GoogleProfileId = GoogleBusinessProfile["profileId"];

export interface GoogleCapabilities {
  drive: boolean;
  gmail: boolean;
  calendar: boolean;
}

const PROFILE_BY_BUSINESS = new Map<string, GoogleBusinessProfile>(
  GOOGLE_BUSINESS_PROFILES.map((profile) => [profile.businessId, profile])
);
const PROFILE_BY_ID = new Map<string, GoogleBusinessProfile>(
  [...GOOGLE_BUSINESS_PROFILES, ROSSER_GALLERY_SENDING_PROFILE].map((profile) => [profile.profileId, profile])
);

export class GoogleBusinessProfileContextError extends Error {
  constructor(message = "Unknown or mismatched Google business profile") {
    super(message);
    this.name = "GoogleBusinessProfileContextError";
  }
}

function normalizeContextValue(value: string | null | undefined): string | null {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || null;
}

export function resolveGoogleBusinessProfileContext(input: {
  businessId?: string | null;
  profileId?: string | null;
}): GoogleBusinessProfile | null {
  const businessId = normalizeContextValue(input.businessId);
  const profileId = normalizeContextValue(input.profileId);

  if (!businessId && !profileId) return null;

  const byBusiness = businessId ? PROFILE_BY_BUSINESS.get(businessId) : undefined;
  const byProfile = profileId ? PROFILE_BY_ID.get(profileId) : undefined;

  if ((businessId && !byBusiness) || (profileId && !byProfile)) {
    throw new GoogleBusinessProfileContextError();
  }

  const resolved = byProfile || byBusiness;
  if (!resolved) {
    throw new GoogleBusinessProfileContextError();
  }

  if (
    (businessId && resolved.businessId !== businessId) ||
    (profileId && resolved.profileId !== profileId)
  ) {
    throw new GoogleBusinessProfileContextError();
  }

  return resolved;
}

export function capabilitiesFromGoogleScopes(scopeString: string | null | undefined): GoogleCapabilities {
  const scopes = String(scopeString || "")
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    drive: scopes.some((scope) => scope.includes("/auth/drive")),
    gmail: scopes.some((scope) => scope.includes("/auth/gmail")),
    calendar: scopes.some((scope) => scope.includes("/auth/calendar")),
  };
}

export function hasGoogleGmailSendScope(
  scopeString: string | null | undefined
): boolean {
  return String(scopeString || "")
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .includes("https://www.googleapis.com/auth/gmail.send");
}
