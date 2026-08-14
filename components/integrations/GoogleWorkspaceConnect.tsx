"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders, readApiJson } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Loader2, Unplug, XCircle } from "lucide-react";
import { AfroGlyph } from "@/components/branding/AfroGlyph";
import {
  GOOGLE_BUSINESS_PROFILES,
  type GoogleBusinessProfile,
  type GoogleCapabilities,
} from "@/lib/google/business-profiles";
import { createLatestRequestGate } from "@/components/integrations/google-status-request-gate";

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
  defaultProfileId?: string | null;
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
  const statusRequestGate = useRef(createLatestRequestGate()).current;
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingProfileId, setLoadingProfileId] = useState<string | null>(null);
  const [loadingOperation, setLoadingOperation] = useState<
    "connect" | "disconnect" | "default" | null
  >(null);
  const [disconnectProfile, setDisconnectProfile] = useState<GoogleProfileStatus | null>(null);
  const [defaultProfileId, setDefaultProfileId] = useState<string | null>(null);
  const [legacyConnected, setLegacyConnected] = useState(false);
  const [profiles, setProfiles] = useState<GoogleProfileStatus[]>(() =>
    GOOGLE_BUSINESS_PROFILES.map(disconnectedProfile)
  );

  const connectedCount = useMemo(
    () => profiles.filter((profile) => profile.connected).length,
    [profiles]
  );

  const resetConnectionStatus = useCallback(() => {
    setProfiles(GOOGLE_BUSINESS_PROFILES.map(disconnectedProfile));
    setDefaultProfileId(null);
    setLegacyConnected(false);
    setDisconnectProfile(null);
    setLoadingProfileId(null);
    setLoadingOperation(null);
  }, []);

  const loadStatus = useCallback(async () => {
    const requestId = statusRequestGate.begin();
    if (!user) {
      resetConnectionStatus();
      if (statusRequestGate.isCurrent(requestId)) setLoadingStatus(false);
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
      if (!statusRequestGate.isCurrent(requestId)) return;

      const nextProfiles = normalizeProfileStatuses(result.profiles);
      setProfiles(nextProfiles);
      setDefaultProfileId(
        typeof result.defaultProfileId === "string" &&
          nextProfiles.some(
            (profile) =>
              profile.profileId === result.defaultProfileId && profile.connected
          )
          ? result.defaultProfileId
          : null
      );
      setLegacyConnected(
        result.legacy?.connected === true ||
          (!Array.isArray(result.profiles) && result.connected === true)
      );
    } catch (error: unknown) {
      if (!statusRequestGate.isCurrent(requestId)) return;
      const message = error instanceof Error ? error.message : String(error);
      resetConnectionStatus();
      toast.error("Failed to check Google connection", { description: message });
      reportClientError(message, { source: "google_workspace.load_status" });
    } finally {
      if (statusRequestGate.isCurrent(requestId)) setLoadingStatus(false);
    }
  }, [resetConnectionStatus, statusRequestGate, user]);

  useEffect(() => {
    void loadStatus();
    return () => statusRequestGate.invalidate();
  }, [loadStatus, statusRequestGate]);

  const handleConnect = async (
    profile: GoogleProfileStatus,
    scopePreset: ScopePreset
  ) => {
    if (!user) return;
    setLoadingProfileId(profile.profileId);
    setLoadingOperation("connect");
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
      setLoadingOperation(null);
    }
  };

  const handleDisconnect = async (profile: GoogleProfileStatus) => {
    if (!user) return;
    setLoadingProfileId(profile.profileId);
    setLoadingOperation("disconnect");
    try {
      const headers = await buildAuthHeaders(user, {
        idempotencyKey: crypto.randomUUID(),
      });
      const response = await fetch("/api/google/disconnect", {
        method: "POST",
        headers,
        body: JSON.stringify({
          businessId: profile.businessId,
          profileId: profile.profileId,
        }),
      });
      const result = await readApiJson<{
        success?: boolean;
        businessId?: string;
        profileId?: string;
        disconnectScope?: string;
        providerRevocationAttempted?: boolean;
        error?: string;
      }>(response);
      if (!response.ok) {
        throw new Error(result.error || "Failed to disconnect Google profile");
      }
      if (
        result.success !== true ||
        result.businessId !== profile.businessId ||
        result.profileId !== profile.profileId ||
        result.disconnectScope !== "local_profile_only" ||
        result.providerRevocationAttempted !== false
      ) {
        throw new Error("Google disconnect returned the wrong organization profile");
      }

      setDisconnectProfile(null);
      toast.success(`${profile.label} Google account disconnected`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`${profile.label} Google disconnect failed`, { description: message });
      reportClientError(message, {
        source: "google_workspace.disconnect",
        businessId: profile.businessId,
        profileId: profile.profileId,
      });
    } finally {
      await loadStatus();
      setLoadingProfileId(null);
      setLoadingOperation(null);
    }
  };

  const handleDefaultProfile = async (profile: GoogleProfileStatus) => {
    if (!user || !profile.connected) return;
    setLoadingProfileId(profile.profileId);
    setLoadingOperation("default");
    try {
      const headers = await buildAuthHeaders(user, {
        idempotencyKey: crypto.randomUUID(),
      });
      const response = await fetch("/api/google/default-profile", {
        method: "POST",
        headers,
        body: JSON.stringify({
          businessId: profile.businessId,
          profileId: profile.profileId,
        }),
      });
      const result = await readApiJson<{
        success?: boolean;
        businessId?: string;
        profileId?: string;
        error?: string;
      }>(response);
      if (
        !response.ok ||
        result.success !== true ||
        result.businessId !== profile.businessId ||
        result.profileId !== profile.profileId
      ) {
        throw new Error(result.error || "Failed to select the default Google profile");
      }
      setDefaultProfileId(profile.profileId);
      toast.success(`${profile.label} will be used by general Google tools`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Could not select ${profile.label}`, { description: message });
      reportClientError(message, {
        source: "google_workspace.default_profile",
        businessId: profile.businessId,
        profileId: profile.profileId,
      });
    } finally {
      setLoadingProfileId(null);
      setLoadingOperation(null);
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

        {connectedCount > 0 && !defaultProfileId && (
          <div className="flex gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 text-xs text-cyan-100/90">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Choose one connected organization as the explicit default for general Drive,
              Calendar, and Gmail screens. Organization-bound automations keep using their
              exact assigned profile.
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
                    {profileLoading
                      ? loadingOperation === "disconnect"
                        ? "Disconnecting…"
                        : loadingOperation === "default"
                          ? "Selecting…"
                        : "Opening Google…"
                      : statusLabel(profile)}
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
                    {profile.profileMapped && (
                      <Button
                        variant="outline"
                        onClick={() => setDisconnectProfile(profile)}
                        disabled={loadingStatus || Boolean(loadingProfileId)}
                        className="border-red-500/30 text-red-200 hover:bg-red-500/10 hover:text-red-100 sm:col-span-2"
                      >
                        <Unplug className="mr-1 h-3.5 w-3.5" />
                        Disconnect {profile.label}
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {defaultProfileId === profile.profileId ? (
                      <p className="rounded-md border border-cyan-500/20 bg-cyan-500/5 px-3 py-2 text-xs text-cyan-100">
                        Default for general Drive, Calendar, and Gmail tools.
                      </p>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleDefaultProfile(profile)}
                        disabled={Boolean(loadingProfileId)}
                        className="border-cyan-500/30 text-cyan-100 hover:bg-cyan-500/10"
                      >
                        Use for general Google tools
                      </Button>
                    )}
                    {missingCapabilities.length > 0 && (
                      <p className="text-xs text-amber-200/80">
                        This profile has a limited grant. Reconnecting replaces its current
                        permissions; it does not add permissions silently.
                      </p>
                    )}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleConnect(profile, "core")}
                        disabled={Boolean(loadingProfileId)}
                        className="border-zinc-700 text-zinc-300 hover:text-white"
                      >
                        Replace with Drive + Calendar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleConnect(profile, "full")}
                        disabled={Boolean(loadingProfileId)}
                        className="border-zinc-700 text-zinc-300 hover:text-white"
                      >
                        Replace with Full + Gmail
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDisconnectProfile(profile)}
                      disabled={Boolean(loadingProfileId)}
                      className="border-red-500/30 text-red-200 hover:bg-red-500/10 hover:text-red-100"
                    >
                      <Unplug className="mr-1 h-3.5 w-3.5" />
                      Disconnect {profile.label}
                    </Button>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <Dialog
          open={Boolean(disconnectProfile)}
          onOpenChange={(open) => {
            if (!open && loadingOperation !== "disconnect") setDisconnectProfile(null);
          }}
        >
          <DialogContent className="border-zinc-800 bg-zinc-950 text-white">
            <DialogHeader>
              <DialogTitle>Disconnect {disconnectProfile?.label}?</DialogTitle>
              <DialogDescription className="text-zinc-400">
                This removes only the Google credential assigned to the {disconnectProfile?.profileId}
                profile. The other organization&apos;s Google connection will not be changed, and this
                does not revoke the Google account&apos;s project-wide grant.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => setDisconnectProfile(null)}
                disabled={loadingOperation === "disconnect"}
                className="border-zinc-700 text-zinc-200 hover:bg-zinc-900"
              >
                Keep connected
              </Button>
              <Button
                variant="destructive"
                onClick={() => disconnectProfile && void handleDisconnect(disconnectProfile)}
                disabled={!disconnectProfile || loadingOperation === "disconnect"}
              >
                {loadingOperation === "disconnect" && (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                )}
                Confirm disconnect
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <p className="text-xs text-zinc-500">
          Start with Drive + Calendar to reduce verification friction. Add Gmail only where
          outreach workflows need it. Connection does not send email or create calendar events.
        </p>
      </CardContent>
    </Card>
  );
}
