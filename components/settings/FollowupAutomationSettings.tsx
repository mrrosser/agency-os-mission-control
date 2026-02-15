"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildAuthHeaders, getResponseCorrelationId, readApiJson } from "@/lib/api/client";

type FollowupsOrgSettings = {
  autoEnabled: boolean;
  maxTasksPerInvocation: number;
  drainDelaySeconds: number;
};

export function FollowupAutomationSettings() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<FollowupsOrgSettings | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const headers = await buildAuthHeaders(user);
      const res = await fetch("/api/outreach/followups/settings", { method: "GET", headers });
      const payload = await readApiJson<{ settings?: FollowupsOrgSettings; error?: string }>(res);
      if (!res.ok) {
        const cid = getResponseCorrelationId(res);
        throw new Error(payload?.error || `Failed to load follow-up settings${cid ? ` cid=${cid}` : ""}`);
      }
      setSettings(payload.settings || null);
    } catch (e: unknown) {
      toast.error("Failed to load follow-up automation settings", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!user || !settings) return;
    setSaving(true);
    try {
      const headers = await buildAuthHeaders(user, { idempotencyKey: crypto.randomUUID() });
      const res = await fetch("/api/outreach/followups/settings", {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          autoEnabled: settings.autoEnabled,
          maxTasksPerInvocation: settings.maxTasksPerInvocation,
          drainDelaySeconds: settings.drainDelaySeconds,
        }),
      });
      const payload = await readApiJson<{ settings?: FollowupsOrgSettings; error?: string }>(res);
      if (!res.ok) {
        const cid = getResponseCorrelationId(res);
        throw new Error(payload?.error || `Failed to save follow-up settings${cid ? ` cid=${cid}` : ""}`);
      }
      setSettings(payload.settings || settings);
      toast.success("Follow-up automation settings saved");
    } catch (e: unknown) {
      toast.error("Failed to save follow-up automation settings", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="bg-zinc-950 border-zinc-800 shadow-lg">
      <CardHeader>
        <CardTitle>Follow-up Automation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-zinc-400">
          When enabled, due follow-up drafts are processed automatically via the server worker (draft-first; no sends).
        </p>

        {loading || !settings ? (
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Checkbox
                checked={settings.autoEnabled}
                onCheckedChange={(checked) =>
                  setSettings((prev) => (prev ? { ...prev, autoEnabled: Boolean(checked) } : prev))
                }
              />
              <Label className="text-zinc-200">Enable automatic follow-up drafts</Label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-zinc-300">Max tasks per worker tick</Label>
                <Input
                  inputMode="numeric"
                  className="bg-zinc-900 border-zinc-700"
                  value={String(settings.maxTasksPerInvocation)}
                  onChange={(e) =>
                    setSettings((prev) =>
                      prev ? { ...prev, maxTasksPerInvocation: Number.parseInt(e.target.value || "0", 10) || 1 } : prev
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <Label className="text-zinc-300">Drain delay (seconds)</Label>
                <Input
                  inputMode="numeric"
                  className="bg-zinc-900 border-zinc-700"
                  value={String(settings.drainDelaySeconds)}
                  onChange={(e) =>
                    setSettings((prev) =>
                      prev ? { ...prev, drainDelaySeconds: Number.parseInt(e.target.value || "0", 10) || 0 } : prev
                    )
                  }
                />
              </div>
            </div>

            <Button
              type="button"
              onClick={save}
              disabled={!user || saving}
              className="w-full bg-zinc-100 text-black hover:bg-zinc-200"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Follow-up Automation
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

