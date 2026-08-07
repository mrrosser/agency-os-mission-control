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
import { resolveGoogleAccountTokens } from "@/lib/google/account-token-store";
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

function mergeCapabilities(values: GoogleCapabilities[]): GoogleCapabilities {
  return values.reduce<GoogleCapabilities>(
    (merged, current) => ({
      drive: merged.drive || current.drive,
      gmail: merged.gmail || current.gmail,
      calendar: merged.calendar || current.calendar,
    }),
    { ...EMPTY_CAPABILITIES }
  );
}

function mergeScopes(values: Array<string | null>): string | null {
  const scopes = new Set<string>();
  for (const value of values) {
    for (const scope of String(value || "").split(/\s+/)) {
      if (scope) scopes.add(scope);
    }
  }
  return scopes.size > 0 ? Array.from(scopes).sort().join(" ") : null;
}

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
  const [legacyTokens, profiles] = await Promise.all([
    getStoredGoogleTokens(user.uid),
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
  const connected = selection
    ? Boolean(profiles[0]?.connected)
    : legacyConnected || connectedProfiles.length > 0;
  const capabilities = mergeCapabilities([
    ...(selection || !legacyConnected ? [] : [legacyCapabilities]),
    ...connectedProfiles.map((profile) => profile.capabilities),
  ]);
  const scopes = mergeScopes([
    ...(selection || !legacyConnected ? [] : [legacyScopes]),
    ...connectedProfiles.map((profile) => profile.scopes),
  ]);
  const hasSchemaV2Connection = connectedProfiles.length > 0;
  const storageMode = selection
    ? connected
      ? "schema_v2"
      : "none"
    : hasSchemaV2Connection && legacyConnected
      ? "mixed"
      : hasSchemaV2Connection
        ? "schema_v2"
        : legacyConnected
          ? "legacy"
          : "none";

  log.info("google.status.loaded", {
    uid: user.uid,
    selectedBusinessId: selection?.businessId || null,
    selectedProfileId: selection?.profileId || null,
    connectedProfiles: connectedProfiles.length,
    requestedProfiles: profiles.length,
    legacyConnected,
    storageMode,
    correlationId,
  });

  return NextResponse.json({
    connected,
    scopes,
    capabilities,
    storageMode,
    legacy: {
      connected: legacyConnected,
      scopes: legacyScopes,
      capabilities: legacyCapabilities,
    },
    selection,
    profile: selection ? profiles[0] || null : null,
    profiles,
  });
}, { route: "google.status" });
