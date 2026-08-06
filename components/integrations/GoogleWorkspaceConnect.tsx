"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders, readApiJson } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { AfroGlyph } from "@/components/branding/AfroGlyph";
import {
  GOOGLE_BUSINESS_PROFILES,
  type GoogleBusinessProfile,
  type GoogleCapabilities,
} from "@/lib/google/business-profiles";

type ScopePreset = "core" | "drive" | "calendar" | "gmail" | "full";
type ProfileState = "connected" | "not_connected" | "reconnect_required" | "unavailable";

type GoogleProfileStatus = GoogleBusinessProfile & {
  connected: boolean;
  profileMapped: boolean;
  state: ProfileState;
  scopes: string | null;
  capabilities: GoogleCapabilities;
};

interface GoogleStatusResponse {
  connected?: boolean;
  legacy?: { connected?: boolean };
  profiles?: Array<Partial<GoogleProfileStatus>>;
  error?: string;
}

const EMPTY_CAPABILITIES: GoogleCapabilities = {
  drive: false,
  gmail: false,
  calendar: false,
};

function disconnectedProfile(profile: GoogleBusinessProfile): GoogleProfileStatus {
  return {
    ...profile,
    connected: false,
    profileMapped: false,
    state: "not_connected",
    scopes: null,
    capabilities: { ...EMPTY_CAPABILITIES },
  };
}

function normalizeProfileStatuses(
  values: GoogleStatusResponse["profiles"]
): GoogleProfileStatus[] {
  return GOOGLE_BUSINESS_PROFILES.map((definition) => {
    const value = values?.find(
      (candidate) =>
        candidate.businessId === definition.businessId &&
        candidate.profileId === definition.profileId
    );
    if (!value) return disconnectedProfile(definition);

    const state: ProfileState = [
      "connected",
      "not_connected",
      "reconnect_required",
      "unavailable",
    ].includes(String(value.state))
      ? (value.state as ProfileState)
      : "unavailable";
    const connected = state === "connected" && value.connected === true;

    return {
      ...definition,
      connected,
      profileMapped: value.profileMapped === true,
      state,
      scopes: typeof value.scopes === "string" ? value.scopes : null,
      capabilities: {
        drive: connected && value.capabilities?.drive === true,
        gmail: connected && value.capabilities?.gmail === true,
        calendar: connected && value.capabilities?.calendar === true,
      },
    };
  });
}

function statusLabel(profile: GoogleProfileStatus): string {
  if (profile.connected) return "Connected";
  if (profile.state === "reconnect_required") return "Reconnect required";
  if (profile.state === "unavailable") return "Status unavailable";
  return "Not connected";
}

function reportClientError(message: string, meta: Record<string, unknown>) {
  try {
    window.__mcReportTelemetryError?.({
      kind: "client",
      message,
      route: window.location.pathname,
      meta,
    });
  } catch {
    // Best-effort telemetry must never block the UI.
  }
}

export function GoogleWorkspaceConnect() {
  const { user } = useAuth();
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingProfileId, setLoadingProfileId] = useState<string | null>(null);
  const [legacyConnected, setLegacyConnected] = useState(false);
  const [profiles, setProfiles] = useState<GoogleProfileStatus[]>(() =>
    GOOGLE_BUSINESS_PROFILES.map(disconnectedProfile)
  );

  const connectedCount = useMemo(
    () => profiles.filter((profile) => profile.connected).length,
    [profiles]
  );

  const loadStatus = useCallback(async () => {
    if (!user) {
      setLoadingStatus(false);
      return;
    }
    setLoadingStatus(true);
    try {
      const headers = await buildAuthHeaders(user);
      const response = await fetch("/api/google/status", { headers });
      const result = await readApiJson<GoogleStatusResponse>(response);
      if (!response.ok) {
        throw new Error(result?.error || "Failed to check Google connection");
      }

      setProfiles(normalizeProfileStatuses(result.profiles));
      setLegacyConnected(
        result.legacy?.connected === true ||
          (!Array.isArray(result.profiles) && result.connected === true)
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setProfiles(GOOGLE_BUSINESS_PROFILES.map(disconnectedProfile));
      toast.error("Failed to check Google connection", { description: message });
      reportClientError(message, { source: "google_workspace.load_status" });
    } finally {
      setLoadingStatus(false);
    }
  }, [user]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleConnect = async (
    profile: GoogleProfileStatus,
    scopePreset: ScopePreset
  ) => {
    if (!user) return;
    setLoadingProfileId(profile.profileId);
    try {
      const headers = await buildAuthHeaders(user, {
        idempotencyKey: crypto.randomUUID(),
      });
      const response = await fetch("/api/google/connect", {
        method: "POST",
        headers,
        body: JSON.stringify({
          returnTo: "/dashboard/integrations",
          scopePreset,
          businessId: profile.businessId,
          profileId: profile.profileId,
        }),
      });

      const result = await readApiJson<{
        authUrl?: string;
        businessId?: string;
        profileId?: string;
        error?: string;
      }>(response);
      if (!response.ok) {
        throw new Error(result.error || "Failed to start Google OAuth");
      }
      if (
        result.businessId !== profile.businessId ||
        result.profileId !== profile.profileId
      ) {
        throw new Error("Google OAuth returned the wrong organization profile");
      }
      if (!result.authUrl) {
        throw new Error("Google OAuth did not return an authorization URL");
      }

      const authUrl = new URL(result.authUrl);
      if (authUrl.origin !== "https://accounts.google.com") {
        throw new Error("Google OAuth returned an invalid authorization URL");
      }
      window.location.assign(authUrl.toString());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`${profile.label} Google connection failed`, { description: message });
      reportClientError(message, {
        source: "google_workspace.connect",
        businessId: profile.businessId,
        profileId: profile.profileId,
      });
      setLoadingProfileId(null);
    }
  };

  return (
    <Card className="border-zinc-800 bg-zinc-950">
      <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
        <CardTitle className="flex items-center gap-2 text-white">
          <AfroGlyph variant="integrations" className="h-4 w-4 text-cyan-300" />
          Google Workspace
        </CardTitle>
        <span className="text-xs text-zinc-400" aria-live="polite">
          {loadingStatus ? "Checking connections…" : `${connectedCount} of 2 organizations connected`}
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-zinc-400">
          Connect each organization independently so Gmail, Drive, and Calendar use the correct
          account for that team.
        </p>

        {legacyConnected && connectedCount < GOOGLE_BUSINESS_PROFILES.length && (
          <div className="flex gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-100/90">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              A legacy Google connection is still available for older tools. Connect both
              organization profiles below before relying on organization-specific automation.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {profiles.map((profile) => {
            const profileLoading = loadingProfileId === profile.profileId;
            const missingCapabilities = profile.connected
              ? (Object.entries(profile.capabilities) as Array<
                  [keyof GoogleCapabilities, boolean]
                >).filter(([, enabled]) => !enabled)
              : [];

            return (
              <section
                key={profile.profileId}
                className="space-y-4 rounded-xl border border-zinc-800 bg-black/40 p-4"
                aria-labelledby={`google-profile-${profile.profileId}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3
                      id={`google-profile-${profile.profileId}`}
                      className="font-semibold text-white"
                    >
                      {profile.label}
                    </h3>
                    <p className="mt-1 text-xs text-zinc-500">Profile: {profile.profileId}</p>
                  </div>
                  <span
                    className={`flex items-center gap-1 text-xs ${
                      profile.connected
                        ? "text-emerald-400"
                        : profile.state === "unavailable"
                          ? "text-amber-300"
                          : "text-zinc-400"
                    }`}
                  >
                    {profileLoading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : profile.connected ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      <XCircle className="h-3 w-3" />
                    )}
                    {profileLoading ? "Opening Google…" : statusLabel(profile)}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  {(Object.entries(profile.capabilities) as Array<
                    [keyof GoogleCapabilities, boolean]
                  >).map(([capability, enabled]) => (
                    <span
                      key={capability}
                      className={`rounded-full border px-2 py-1 capitalize ${
                        enabled
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                          : "border-zinc-700 bg-zinc-900 text-zinc-300"
                      }`}
                    >
                      {capability} {enabled ? "enabled" : "missing"}
                    </span>
                  ))}
                </div>

                {!profile.connected ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button
                      onClick={() => handleConnect(profile, "core")}
                      disabled={loadingStatus || Boolean(loadingProfileId)}
                      className="bg-blue-600 text-white hover:bg-blue-500"
                    >
                      Connect Drive + Calendar
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => handleConnect(profile, "full")}
                      disabled={loadingStatus || Boolean(loadingProfileId)}
                      className="border-zinc-700 text-zinc-200 hover:bg-zinc-900"
                    >
                      Connect Full + Gmail
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {missingCapabilities.length > 0 && (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {missingCapabilities.map(([capability]) => (
                          <Button
                            key={capability}
                            size="sm"
                            onClick={() => handleConnect(profile, capability)}
                            disabled={Boolean(loadingProfileId)}
                            className="bg-blue-600 text-white hover:bg-blue-500"
                          >
                            Enable {capability}
                          </Button>
                        ))}
                      </div>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleConnect(profile, "full")}
                      disabled={Boolean(loadingProfileId)}
                      className="border-zinc-700 text-zinc-300 hover:text-white"
                    >
                      Reconnect or change account
                    </Button>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <p className="text-xs text-zinc-500">
          Start with Drive + Calendar to reduce verification friction. Add Gmail only where
          outreach workflows need it. Connection does not send email or create calendar events.
        </p>
      </CardContent>
    </Card>
  );
}
