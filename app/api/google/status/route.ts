import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, withApiHandler } from "@/lib/api/handler";
import { requireFirebaseAuth } from "@/lib/api/auth";
import {
  GOOGLE_BUSINESS_PROFILES,
  GoogleBusinessProfileContextError,
  capabilitiesFromGoogleScopes,
  resolveGoogleBusinessProfileContext,
  type GoogleBusinessProfile,
  type GoogleCapabilities,
} from "@/lib/google/business-profiles";
import {
  getGoogleAccountRegistryMode,
  getGoogleDefaultProfileId,
  resolveGoogleAccountTokens,
} from "@/lib/google/account-token-store";
import { getStoredGoogleTokens } from "@/lib/google/oauth";

const querySchema = z
  .object({
    businessId: z.string().trim().min(1).max(64).optional(),
    profileId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

type GoogleProfileConnectionState =
  | "connected"
  | "not_connected"
  | "reconnect_required"
  | "unavailable";

interface GoogleProfileStatus {
  businessId: GoogleBusinessProfile["businessId"];
  profileId: GoogleBusinessProfile["profileId"];
  label: GoogleBusinessProfile["label"];
  connected: boolean;
  profileMapped: boolean;
  state: GoogleProfileConnectionState;
  scopes: string | null;
  capabilities: GoogleCapabilities;
}

const EMPTY_CAPABILITIES: GoogleCapabilities = {
  drive: false,
  gmail: false,
  calendar: false,
};

async function loadProfileStatus(
  uid: string,
  profile: GoogleBusinessProfile
): Promise<GoogleProfileStatus> {
  const resolution = await resolveGoogleAccountTokens(uid, profile.profileId);
  const tokens = resolution.record?.tokens || null;
  const connected = Boolean(tokens?.refreshToken || tokens?.accessToken);
  const state: GoogleProfileConnectionState = connected
    ? "connected"
    : resolution.profileMapped
      ? "reconnect_required"
      : "not_connected";

  return {
    ...profile,
    connected,
    profileMapped: resolution.profileMapped,
    state,
    scopes: tokens?.scope || null,
    capabilities: capabilitiesFromGoogleScopes(tokens?.scope),
  };
}

export const GET = withApiHandler(async ({ request, correlationId, log }) => {
  const user = await requireFirebaseAuth(request, log);
  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  if (!parsedQuery.success) {
    throw new ApiError(400, "Invalid Google status query", {
      issues: parsedQuery.error.issues,
    });
  }

  let selection: GoogleBusinessProfile | null;
  try {
    selection = resolveGoogleBusinessProfileContext(parsedQuery.data);
  } catch (error) {
    if (error instanceof GoogleBusinessProfileContextError) {
      throw new ApiError(400, error.message);
    }
    throw error;
  }

  const requestedProfiles = selection ? [selection] : [...GOOGLE_BUSINESS_PROFILES];
  const [legacyTokens, defaultProfileId, registryMode, profiles] = await Promise.all([
    getStoredGoogleTokens(user.uid),
    getGoogleDefaultProfileId(user.uid),
    getGoogleAccountRegistryMode(user.uid),
    Promise.all(
      requestedProfiles.map(async (profile): Promise<GoogleProfileStatus> => {
        try {
          return await loadProfileStatus(user.uid, profile);
        } catch {
          log.warn("google.status.profile_unavailable", {
            uid: user.uid,
            businessId: profile.businessId,
            profileId: profile.profileId,
            errorCategory: "credential_vault_unavailable",
          });
          return {
            ...profile,
            connected: false,
            profileMapped: false,
            state: "unavailable",
            scopes: null,
            capabilities: { ...EMPTY_CAPABILITIES },
          };
        }
      })
    ),
  ]);

  const legacyScopes = legacyTokens?.scope || null;
  const legacyConnected = Boolean(legacyTokens?.refreshToken || legacyTokens?.accessToken);
  const legacyCapabilities = capabilitiesFromGoogleScopes(legacyScopes);
  const connectedProfiles = profiles.filter((profile) => profile.connected);
  const defaultProfile = defaultProfileId
    ? profiles.find((profile) => profile.profileId === defaultProfileId) || null
    : null;
  const selectedProfile = selection ? profiles[0] || null : defaultProfile;
  const hasSchemaV2Registry = registryMode === "schema_v2";
  const mayUseLegacy = !selection && !hasSchemaV2Registry;
  const usableLegacyConnected = mayUseLegacy && legacyConnected;
  const connected = selectedProfile
    ? selectedProfile.connected
    : mayUseLegacy && legacyConnected;
  const capabilities = selectedProfile
    ? selectedProfile.capabilities
    : mayUseLegacy
      ? legacyCapabilities
      : { ...EMPTY_CAPABILITIES };
  const scopes = selectedProfile
    ? selectedProfile.scopes
    : mayUseLegacy
      ? legacyScopes
      : null;
  const storageMode = selection
    ? connected
      ? "schema_v2"
      : "none"
    : hasSchemaV2Registry
      ? defaultProfileId
        ? "schema_v2"
        : "schema_v2_needs_default"
      : mayUseLegacy && legacyConnected
        ? "legacy"
        : "none";

  log.info("google.status.loaded", {
    uid: user.uid,
    selectedBusinessId: selection?.businessId || null,
    selectedProfileId: selection?.profileId || null,
    connectedProfiles: connectedProfiles.length,
    defaultProfileId,
    requestedProfiles: profiles.length,
    legacyConnected,
    registryMode,
    storageMode,
    correlationId,
  });

  return NextResponse.json({
    connected,
    scopes,
    capabilities,
    storageMode,
    defaultProfileId,
    legacy: {
      connected: usableLegacyConnected,
      scopes: usableLegacyConnected ? legacyScopes : null,
      capabilities: usableLegacyConnected
        ? legacyCapabilities
        : { ...EMPTY_CAPABILITIES },
    },
    selection,
    profile: selectedProfile,
    profiles,
  });
}, { route: "google.status" });
