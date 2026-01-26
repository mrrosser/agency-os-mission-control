"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { buildAuthHeaders } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Plug, CheckCircle2, XCircle } from "lucide-react";

export function GoogleWorkspaceConnect() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);

  const loadStatus = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const headers = await buildAuthHeaders(user);
      const response = await fetch("/api/google/status", { headers });
      const result = await response.json();
      setConnected(Boolean(result.connected));
    } catch (error: any) {
      toast.error("Failed to check Google connection", {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, [user]);

  const handleConnect = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const headers = await buildAuthHeaders(user, {
        idempotencyKey: crypto.randomUUID(),
      });
      const response = await fetch("/api/google/connect", {
        method: "POST",
        headers,
        body: JSON.stringify({ returnTo: "/dashboard/integrations" }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to start Google OAuth");
      }

      if (result.authUrl) {
        window.location.href = result.authUrl;
      }
    } catch (error: any) {
      toast.error("Google connection failed", {
        description: error.message,
      });
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
        const result = await response.json();
        throw new Error(result.error || "Failed to disconnect");
      }
      setConnected(false);
      toast.success("Google Workspace disconnected");
    } catch (error: any) {
      toast.error("Failed to disconnect", {
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-zinc-950 border-zinc-800">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-white flex items-center gap-2">
          <Plug className="h-4 w-4 text-blue-500" />
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
        {connected ? (
          <Button
            variant="outline"
            onClick={handleDisconnect}
            disabled={loading}
            className="border-zinc-700 text-zinc-300 hover:text-white"
          >
            Disconnect Google
          </Button>
        ) : (
          <Button
            onClick={handleConnect}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-500 text-white"
          >
            Connect Google
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
