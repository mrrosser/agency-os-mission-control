"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders, readApiJson } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { CheckCircle2, XCircle } from "lucide-react";
import { AfroGlyph } from "@/components/branding/AfroGlyph";

type ScopePreset = "core" | "drive" | "calendar" | "gmail" | "full";

type GoogleCapabilities = {
  drive: boolean;
  gmail: boolean;
  calendar: boolean;
};

export function GoogleWorkspaceConnect() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [capabilities, setCapabilities] = useState<GoogleCapabilities>({
    drive: false,
    gmail: false,
    calendar: false,
  });

  const loadStatus = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const headers = await buildAuthHeaders(user);
      const response = await fetch("/api/google/status", { headers });
      const result = await readApiJson<{
        connected?: boolean;
        capabilities?: Partial<GoogleCapabilities>;
        error?: string;
      }>(response);
      if (!response.ok) {
        throw new Error(result?.error || "Failed to check Google connection");
      }
      setConnected(Boolean(result?.connected));
      setCapabilities({
        drive: Boolean(result?.capabilities?.drive),
        gmail: Boolean(result?.capabilities?.gmail),
        calendar: Boolean(result?.capabilities?.calendar),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error("Failed to check Google connection", {
        description: message,
      });

      // Best-effort client telemetry for caught UI errors.
      try {
        window.__mcReportTelemetryError?.({
          kind: "client",
          message,
          route: window.location.pathname,
          meta: { source: "google_workspace.load_status" },
        });
      } catch {
        // ignore
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleConnect = async (scopePreset: ScopePreset) => {
    if (!user) return;
    setLoading(true);
    try {
      const headers = await buildAuthHeaders(user, {
        idempotencyKey: crypto.randomUUID(),
      });
      const response = await fetch("/api/google/connect", {
        method: "POST",
        headers,
        body: JSON.stringify({ returnTo: "/dashboard/integrations", scopePreset }),
      });

      const result = await readApiJson<{ authUrl?: string; error?: string }>(response);
      if (!response.ok) {
        throw new Error(result.error || "Failed to start Google OAuth");
      }

      if (result.authUrl) {
        window.location.href = result.authUrl;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error("Google connection failed", {
        description: message,
      });

      // Best-effort client telemetry for caught UI errors.
      try {
        window.__mcReportTelemetryError?.({
          kind: "client",
          message,
          route: window.location.pathname,
          meta: { source: "google_workspace.connect" },
        });
      } catch {
        // ignore
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const headers = await buildAuthHeaders(user, {
        idempotencyKey: crypto.randomUUID(),
      });
      const response = await fetch("/api/google/disconnect", {
        method: "POST",
        headers,
      });
      if (!response.ok) {
        const result = await readApiJson<{ error?: string }>(response);
        throw new Error(result?.error || "Failed to disconnect");
      }
      setConnected(false);
      toast.success("Google Workspace disconnected");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error("Failed to disconnect", {
        description: message,
      });

      // Best-effort client telemetry for caught UI errors.
      try {
        window.__mcReportTelemetryError?.({
          kind: "client",
          message,
          route: window.location.pathname,
          meta: { source: "google_workspace.disconnect" },
        });
      } catch {
        // ignore
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-zinc-950 border-zinc-800">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-white flex items-center gap-2">
          <AfroGlyph variant="integrations" className="h-4 w-4 text-cyan-300" />
          Google Workspace
        </CardTitle>
        {connected ? (
          <span className="text-xs text-green-500 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Connected
          </span>
        ) : (
          <span className="text-xs text-zinc-500 flex items-center gap-1">
            <XCircle className="h-3 w-3" /> Not connected
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-zinc-400">
          Connect Gmail, Drive, and Calendar so Mission Control can orchestrate your outreach.
        </p>

        {connected && (
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={`rounded-full border px-2 py-1 ${capabilities.drive ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-zinc-700 bg-zinc-900 text-zinc-300"}`}>
              Drive {capabilities.drive ? "enabled" : "missing"}
            </span>
            <span className={`rounded-full border px-2 py-1 ${capabilities.calendar ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-zinc-700 bg-zinc-900 text-zinc-300"}`}>
              Calendar {capabilities.calendar ? "enabled" : "missing"}
            </span>
            <span className={`rounded-full border px-2 py-1 ${capabilities.gmail ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-zinc-700 bg-zinc-900 text-zinc-300"}`}>
              Gmail {capabilities.gmail ? "enabled" : "missing"}
            </span>
          </div>
        )}

        {connected ? (
          <>
            {(!capabilities.drive || !capabilities.calendar || !capabilities.gmail) && (
              <div className="grid grid-cols-1 gap-2">
                {!capabilities.drive && (
                  <Button
                    onClick={() => handleConnect("drive")}
                    disabled={loading}
                    className="bg-blue-600 hover:bg-blue-500 text-white"
                  >
                    Enable Drive
                  </Button>
                )}
                {!capabilities.calendar && (
                  <Button
                    onClick={() => handleConnect("calendar")}
                    disabled={loading}
                    className="bg-blue-600 hover:bg-blue-500 text-white"
                  >
                    Enable Calendar
                  </Button>
                )}
                {!capabilities.gmail && (
                  <Button
                    onClick={() => handleConnect("gmail")}
                    disabled={loading}
                    className="bg-blue-600 hover:bg-blue-500 text-white"
                  >
                    Enable Gmail
                  </Button>
                )}
              </div>
            )}

            <Button
              variant="outline"
              onClick={handleDisconnect}
              disabled={loading}
              className="border-zinc-700 text-zinc-300 hover:text-white"
            >
              Disconnect Google
            </Button>
          </>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            <Button
              onClick={() => handleConnect("core")}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-500 text-white"
            >
              Connect Google (Drive + Calendar)
            </Button>
            <Button
              variant="outline"
              onClick={() => handleConnect("full")}
              disabled={loading}
              className="border-zinc-700 text-zinc-200 hover:bg-zinc-900"
            >
              Connect Full (includes Gmail)
            </Button>
            <p className="text-xs text-zinc-500">
              Tip: start with Drive + Calendar to reduce verification friction, then enable Gmail when needed.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
